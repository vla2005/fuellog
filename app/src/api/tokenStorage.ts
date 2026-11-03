import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { BiometricSession, TokenResponse } from './types';

export const REFRESH_TOKEN_KEY = 'fuellog.auth.refresh_token.v1';
export const BIOMETRIC_REFRESH_TOKEN_KEY = 'fuellog.biometric.refresh_token.v1';
export const BIOMETRIC_PENDING_REVOCATIONS_KEY = 'fuellog.biometric.pending_revocations.v1';
export const MAX_PENDING_BIOMETRIC_REVOCATIONS = 32;
export const BIOMETRIC_AES_KEY_STORAGE = 'fuellog.biometric.aes_key.v1';
export const BIOMETRIC_KEYCHAIN_SERVICE = 'fuellog_biometric_service';
const ACTIVE_VEHICLE_KEY_PREFIX = 'fuellog.vehicle.active.v1.';

export interface PlainRefreshEnvelope {
  version: 1;
  mode: 'plain';
  refreshToken: string;
}

export interface BiometricRefreshEnvelope {
  version: 1;
  mode: 'biometric';
  combined: string; // Base64 [IV + Ciphertext + Tag]
  sessionId?: string;
}

export type TokenEnvelope = PlainRefreshEnvelope | BiometricRefreshEnvelope;

let inMemoryAccessToken: string | null = null;
let currentSessionEpoch = 0;
let inMemoryBiometricKey: AESEncryptionKey | null = null;
let inMemoryBiometricKeyEpoch: number | null = null;
let biometricGeneration = 0;
let inMemoryBiometricKeyGeneration: number | null = null;
let unlockedBiometricEnvelope: string | null = null;

let mutationQueue: Promise<unknown> = Promise.resolve();

function runWithStorageLock<T>(task: () => Promise<T>): Promise<T> {
  const run = async () => {
    return await task();
  };
  const chained = mutationQueue.then(run, run);
  mutationQueue = chained.then(() => {}, () => {});
  return chained;
}

async function cleanupBiometricKeyIfOwned(expectedEpoch: number, expectedGeneration: number): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }
  await runWithStorageLock(async () => {
    if (currentSessionEpoch !== expectedEpoch || biometricGeneration !== expectedGeneration) {
      return;
    }
    await SecureStore.deleteItemAsync(BIOMETRIC_AES_KEY_STORAGE, {
      keychainService: BIOMETRIC_KEYCHAIN_SERVICE,
    }).catch(() => {});
  });
}

/**
 * Interpreta o valor armazenado, suportando envelope versionado e formato legado simples.
 */
export function parseTokenEnvelope(raw: string): TokenEnvelope {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1) {
      if (parsed.mode === 'plain' && typeof parsed.refreshToken === 'string') {
        return parsed as PlainRefreshEnvelope;
      }
      if (parsed.mode === 'biometric' && typeof parsed.combined === 'string') {
        return parsed as BiometricRefreshEnvelope;
      }
    }
  } catch {
    // Formato legado em texto puro
  }
  return {
    version: 1,
    mode: 'plain',
    refreshToken: raw,
  };
}

/**
 * Epoca de sessão monotônica para invalidar respostas ou restores assíncronos
 * que começaram antes de um logout ou troca de usuário.
 */
export function getSessionEpoch(): number {
  return currentSessionEpoch;
}

export function bumpSessionEpoch(): number {
  currentSessionEpoch += 1;
  biometricGeneration += 1;
  inMemoryAccessToken = null;
  inMemoryBiometricKey = null;
  inMemoryBiometricKeyEpoch = null;
  inMemoryBiometricKeyGeneration = null;
  unlockedBiometricEnvelope = null;
  return currentSessionEpoch;
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

export function isBiometricSessionUnlocked(): boolean {
  return inMemoryBiometricKey !== null && inMemoryBiometricKeyEpoch === currentSessionEpoch &&
    inMemoryBiometricKeyGeneration === biometricGeneration;
}

async function readRawStorage(storageKey = REFRESH_TOKEN_KEY, ignoreFailure = true): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage.getItem(storageKey);
      }
      return null;
    }
    return await SecureStore.getItemAsync(storageKey);
  } catch (err) {
    if (!ignoreFailure) throw err;
    return null;
  }
}

async function writeRawStorage(value: string | null, storageKey = REFRESH_TOKEN_KEY): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      throw new Error('Armazenamento de sessão indisponível no navegador.');
    }
    if (value !== null) {
      window.sessionStorage.setItem(storageKey, value);
    } else {
      window.sessionStorage.removeItem(storageKey);
    }
    return;
  }

  if (value !== null) {
    await SecureStore.setItemAsync(storageKey, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } else {
    await SecureStore.deleteItemAsync(storageKey);
  }
}

/**
 * Identifica o tipo de sessão persistida:
 * - 'none': sem credencial salva
 * - 'plain': sessão tradicional em texto claro
 * - 'biometric': credencial legada que exige migração após o primeiro desbloqueio
 */
export async function getStoredSessionType(): Promise<'none' | 'plain' | 'biometric'> {
  const raw = await readRawStorage();
  if (!raw) {
    return 'none';
  }
  const envelope = parseTokenEnvelope(raw);
  return envelope.mode;
}

export async function getBiometricSessionId(): Promise<string | null> {
  const raw = await readRawStorage(BIOMETRIC_REFRESH_TOKEN_KEY, false);
  if (!raw) return null;
  const envelope = parseTokenEnvelope(raw);
  return envelope.mode === 'biometric' ? envelope.sessionId ?? null : null;
}

export async function getPendingBiometricSessionIds(): Promise<string[]> {
  const raw = await readRawStorage(BIOMETRIC_PENDING_REVOCATIONS_KEY, false);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > MAX_PENDING_BIOMETRIC_REVOCATIONS ||
      parsed.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error('Registro de revogações biométricas inválido.');
  }
  return [...new Set(parsed as string[])];
}

async function addPendingBiometricSessionId(sessionId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    throw new Error('Identificador de sessão biométrica inválido.');
  }
  const pending = await getPendingBiometricSessionIds();
  if (pending.includes(sessionId)) return;
  if (pending.length >= MAX_PENDING_BIOMETRIC_REVOCATIONS) {
    throw new Error('Há 32 revogações biométricas pendentes. Entre nas contas anteriores para concluí-las antes de ativar novamente.');
  }
  await writeRawStorage(JSON.stringify([...pending, sessionId]), BIOMETRIC_PENDING_REVOCATIONS_KEY);
}

export async function queueBiometricSessionRevocation(sessionId: string, expectedEpoch: number): Promise<void> {
  return runWithStorageLock(async () => {
    if (currentSessionEpoch !== expectedEpoch) throw new Error('Sessão alterada antes da revogação biométrica.');
    await addPendingBiometricSessionId(sessionId);
  });
}

export async function completeBiometricSessionRevocation(sessionId: string, expectedEpoch: number): Promise<void> {
  return runWithStorageLock(async () => {
    if (currentSessionEpoch !== expectedEpoch) return;
    const pending = await getPendingBiometricSessionIds();
    if (currentSessionEpoch !== expectedEpoch) return;
    const remaining = pending.filter(id => id !== sessionId);
    await writeRawStorage(remaining.length ? JSON.stringify(remaining) : null, BIOMETRIC_PENDING_REVOCATIONS_KEY);
  });
}

/**
 * Retorna o refresh token atual da sessão.
 * Sessões atuais restauram automaticamente. O envelope biométrico legado continua
 * exigindo desbloqueio até ser migrado; a credencial lembrada separada nunca é retornada aqui.
 */
export async function getRefreshToken(): Promise<string | null> {
  try {
    const raw = await readRawStorage();
    if (!raw) {
      return null;
    }
    const envelope = parseTokenEnvelope(raw);
    if (envelope.mode === 'plain') {
      return envelope.refreshToken;
    }

    // Sessão biométrica
    if (!isBiometricSessionUnlocked()) {
      // Bloqueada: nenhuma chave protegida é lida silenciosamente aqui
      return null;
    }

    const sealed = AESSealedData.fromCombined(envelope.combined);
    const decryptedBytes = await aesDecryptAsync(sealed, inMemoryBiometricKey!, {
      output: 'bytes',
    });
    return new TextDecoder().decode(decryptedBytes);
  } catch {
    return null;
  }
}

export async function setRefreshToken(token: string | null): Promise<void> {
  await runWithStorageLock(() => writeRawStorage(token === null ? null : JSON.stringify({
    version: 1, mode: 'plain', refreshToken: token,
  })));
}

async function removeBiometricCredential(alreadyRevoked = false): Promise<void> {
  if (!alreadyRevoked) {
    const sessionId = await getBiometricSessionId();
    if (sessionId) await addPendingBiometricSessionId(sessionId);
  }
  biometricGeneration += 1;
  inMemoryBiometricKey = null;
  inMemoryBiometricKeyEpoch = null;
  inMemoryBiometricKeyGeneration = null;
  unlockedBiometricEnvelope = null;
  let storageError: unknown = null;
  try { await writeRawStorage(null, BIOMETRIC_REFRESH_TOKEN_KEY); } catch (err) { storageError = err; }
  if (Platform.OS !== 'web') {
    try {
      await SecureStore.deleteItemAsync(BIOMETRIC_AES_KEY_STORAGE, {
        keychainService: BIOMETRIC_KEYCHAIN_SERVICE,
      });
    } catch (err) { storageError ??= err; }
  }
  if (storageError) throw storageError;
}

export async function saveTokenPairAtomically(
  accessToken: string,
  refreshToken: string,
  expectedEpoch?: number,
  options?: { clearBiometrics?: boolean },
): Promise<void> {
  const epochAtStart = expectedEpoch ?? currentSessionEpoch;
  if (currentSessionEpoch !== epochAtStart) {
    throw new Error('Sessão alterada antes de persistir credenciais.');
  }

  return runWithStorageLock(async () => {
    if (currentSessionEpoch !== epochAtStart) {
      throw new Error('Sessão alterada antes de persistir credenciais.');
    }

    // Login por senha não pode herdar a credencial lembrada de outra conta.
    if (options?.clearBiometrics) await removeBiometricCredential();

    if (currentSessionEpoch !== epochAtStart) {
      throw new Error('Sessão alterada antes da gravação das credenciais.');
    }

    await writeRawStorage(JSON.stringify({ version: 1, mode: 'plain', refreshToken }));

    if (currentSessionEpoch !== epochAtStart) {
      throw new Error('Sessão alterada ou encerrada durante a persistência de credenciais.');
    }

    inMemoryAccessToken = accessToken;
  });
}

export async function saveBiometricLoginAtomically(
  biometric: BiometricSession,
  session: Pick<TokenResponse, 'access_token' | 'refresh_token'>,
  expectedEpoch: number,
): Promise<void> {
  const expectedEnvelope = unlockedBiometricEnvelope;
  const expectedGeneration = biometricGeneration;
  const key = inMemoryBiometricKey;
  if (!key || !expectedEnvelope || !isBiometricSessionUnlocked()) {
    throw new Error('Credencial biométrica não está desbloqueada.');
  }
  const expectedCredential = parseTokenEnvelope(expectedEnvelope);
  if (expectedCredential.mode !== 'biometric' || expectedCredential.sessionId !== biometric.session_id) {
    throw new Error('Credencial biométrica alterada durante o login.');
  }
  return runWithStorageLock(async () => {
    if (currentSessionEpoch !== expectedEpoch || biometricGeneration !== expectedGeneration ||
        await readRawStorage(BIOMETRIC_REFRESH_TOKEN_KEY) !== expectedEnvelope) {
      throw new Error('Sessão alterada durante o login biométrico.');
    }
    const previousActive = await readRawStorage();
    const sealed = await aesEncryptAsync(new TextEncoder().encode(biometric.refresh_token), key);
    const envelope = JSON.stringify({
      version: 1, mode: 'biometric', combined: await sealed.combined('base64'),
      sessionId: biometric.session_id,
    });
    if (currentSessionEpoch !== expectedEpoch || biometricGeneration !== expectedGeneration) throw new Error('Sessão alterada durante a cifragem.');
    // Persistir B primeiro permite tentar novamente se a gravação de C falhar.
    await writeRawStorage(envelope, BIOMETRIC_REFRESH_TOKEN_KEY);
    if (currentSessionEpoch !== expectedEpoch || biometricGeneration !== expectedGeneration) throw new Error('Sessão alterada durante a persistência.');
    unlockedBiometricEnvelope = envelope;
    await writeRawStorage(JSON.stringify({ version: 1, mode: 'plain', refreshToken: session.refresh_token }));
    if (currentSessionEpoch !== expectedEpoch || biometricGeneration !== expectedGeneration) {
      await writeRawStorage(previousActive);
      throw new Error('Sessão alterada durante a persistência.');
    }
    inMemoryAccessToken = session.access_token;
  });
}

export type UnlockBiometricResult =
  | { success: true; refreshToken: string; legacy?: boolean }
  | { success: false; canceled: boolean; invalidated: boolean; error: string };

/**
 * Desbloqueia a sessão biométrica lendo a chave AES protegida por SecureStore.requireAuthentication.
 * Em caso de sucesso, mantém a chave em memória para persistir a credencial lembrada rotacionada.
 * Recheca epoch após cada await crítico (prompt, import e decrypt) para evitar corridas com logout/troca de conta.
 */
export async function unlockBiometricSession(
  promptMessage?: string,
): Promise<UnlockBiometricResult> {
  const epochAtStart = currentSessionEpoch;
  const generationAtStart = biometricGeneration;

  if (Platform.OS === 'web') {
    return {
      success: false,
      canceled: false,
      invalidated: false,
      error: 'Biometria não suportada no navegador.',
    };
  }

  const remembered = await readRawStorage(BIOMETRIC_REFRESH_TOKEN_KEY);
  const raw = remembered ?? await readRawStorage();
  if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
    return { success: false, canceled: false, invalidated: false, error: 'Sessão alterada.' };
  }
  if (!raw) {
    return {
      success: false,
      canceled: false,
      invalidated: false,
      error: 'Nenhuma credencial encontrada no dispositivo.',
    };
  }

  const envelope = parseTokenEnvelope(raw);
  if (envelope.mode !== 'biometric') {
    return {
      success: false,
      canceled: false,
      invalidated: false,
      error: 'Esta sessão não utiliza proteção biométrica.',
    };
  }

  let base64Key: string | null = null;
  try {
    base64Key = await SecureStore.getItemAsync(BIOMETRIC_AES_KEY_STORAGE, {
      keychainService: BIOMETRIC_KEYCHAIN_SERVICE,
      requireAuthentication: true,
      authenticationPrompt:
        promptMessage ?? 'Confirme sua biometria para entrar no FuelLog',
    });
  } catch (err: unknown) {
    if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
      return { success: false, canceled: false, invalidated: false, error: 'Sessão alterada.' };
    }
    const msg = err instanceof Error ? err.message : String(err);
    const isCanceled =
      /cancel|dismiss|user\s*canceled|user\s*cancelled|cancelei/i.test(msg);
    const isLockout = /lockout|locked\s*out|bloque/i.test(msg);
    if (isCanceled || isLockout) {
      return {
        success: false,
        canceled: true,
        invalidated: false,
        error: isLockout
          ? 'Biometria temporariamente bloqueada por muitas tentativas. Entre com sua senha ou aguarde.'
          : 'Autenticação biométrica cancelada.',
      };
    }
    return {
      success: false,
      canceled: false,
      invalidated: true,
      error: 'Chave biométrica inválida ou alterada no sistema.',
    };
  }

  // Guarda de época pós-prompt
  if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
    return {
      success: false,
      canceled: false,
      invalidated: false,
      error: 'Sessão alterada durante autenticação biométrica.',
    };
  }

  if (!base64Key) {
    // Chave invalidada por alteração biométrica no sistema
    await disableBiometricSession(epochAtStart).catch(() => {});
    return {
      success: false,
      canceled: false,
      invalidated: true,
      error:
        'Os dados biométricos do aparelho foram alterados. Entre com seu e-mail e senha para reativar.',
    };
  }

  try {
    const key = await AESEncryptionKey.import(base64Key, 'base64');

    // Guarda de época pós-import
    if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
      return {
        success: false,
        canceled: false,
        invalidated: false,
        error: 'Sessão alterada durante importação da chave biométrica.',
      };
    }

    const sealed = AESSealedData.fromCombined(envelope.combined);
    const decryptedBytes = await aesDecryptAsync(sealed, key, { output: 'bytes' });

    // Guarda de época pós-decrypt
    if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
      return {
        success: false,
        canceled: false,
        invalidated: false,
        error: 'Sessão alterada durante decifragem da credencial.',
      };
    }

    const refreshToken = new TextDecoder().decode(decryptedBytes);
    inMemoryBiometricKey = key;
    inMemoryBiometricKeyEpoch = epochAtStart;
    inMemoryBiometricKeyGeneration = generationAtStart;
    unlockedBiometricEnvelope = remembered;
    return { success: true, refreshToken, legacy: !remembered };
  } catch (err: unknown) {
    if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
      return { success: false, canceled: false, invalidated: false, error: 'Sessão alterada.' };
    }
    const msg = err instanceof Error ? err.message : 'Falha ao decifrar credencial.';
    return {
      success: false,
      canceled: false,
      invalidated: true,
      error: msg,
    };
  }
}

/**
 * Protege a credencial biométrica recebida do servidor, separada da sessão ativa:
 * - Gera chave AES aleatória de 256 bits
 * - Persiste com requireAuthentication no keychainService próprio com WHEN_UNLOCKED_THIS_DEVICE_ONLY
 * - Exige prova biométrica real lendo a chave recém-criada com requireAuthentication antes do commit
 * - Cifra somente a credencial lembrada com AES-GCM e armazena seu envelope separado
 * - Mantém a chave em memória para a sessão ativa
 * - Recheca a época rigorosamente dentro de lock serializado; nenhuma finalização antiga pode apagar nem sobrescrever a nova sessão.
 */
export async function enableBiometricSession(
  credential: BiometricSession,
  expectedEpoch?: number,
  promptMessage?: string,
): Promise<{ success: boolean; canceled: boolean; error?: string }> {
  const epochAtStart = expectedEpoch ?? currentSessionEpoch;
  const legacyKey = isBiometricSessionUnlocked() && unlockedBiometricEnvelope === null ? inMemoryBiometricKey : null;
  if (currentSessionEpoch !== epochAtStart) {
    throw new Error('Sessão alterada antes de habilitar a biometria.');
  }
  const generationAtStart = ++biometricGeneration;

  if (Platform.OS === 'web') {
    return {
      success: false,
      canceled: false,
      error: 'Biometria não suportada no navegador.',
    };
  }

  const refreshToken = credential.refresh_token;
  if (!refreshToken || !credential.session_id) {
    return {
      success: false,
      canceled: false,
      error: 'Credencial biométrica inválida.',
    };
  }

  if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
    throw new Error('Sessão alterada antes da geração da chave.');
  }

  // A migração reutiliza a chave já confirmada no único prompt do legado.
  if (legacyKey) {
    const sealed = await aesEncryptAsync(new TextEncoder().encode(refreshToken), legacyKey);
    const envelope = JSON.stringify({ version: 1, mode: 'biometric',
      combined: await sealed.combined('base64'), sessionId: credential.session_id });
    return runWithStorageLock(async () => {
      if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
        return { success: false, canceled: false, error: 'Sessão alterada durante a migração.' };
      }
      await writeRawStorage(envelope, BIOMETRIC_REFRESH_TOKEN_KEY);
      if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
        return { success: false, canceled: false, error: 'Sessão alterada durante a migração.' };
      }
      unlockedBiometricEnvelope = envelope;
      inMemoryBiometricKeyGeneration = generationAtStart;
      return { success: true, canceled: false };
    });
  }

  // Gera chave AES-256 aleatória
  const key = await AESEncryptionKey.generate(256);
  const base64Key = await key.encoded('base64');

  if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
    throw new Error('Sessão alterada antes da gravação da chave.');
  }

  // Grava no SecureStore com requireAuthentication e WHEN_UNLOCKED_THIS_DEVICE_ONLY sob posse serializada
  let writeKeyOk = false;
  try {
    writeKeyOk = await runWithStorageLock(async () => {
      if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
        return false;
      }
      await SecureStore.setItemAsync(BIOMETRIC_AES_KEY_STORAGE, base64Key, {
        keychainService: BIOMETRIC_KEYCHAIN_SERVICE,
        requireAuthentication: true,
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        authenticationPrompt:
          promptMessage ?? 'Confirme sua biometria para ativar o acesso rápido no FuelLog',
      });
      return true;
    });
  } catch (err: unknown) {
    await cleanupBiometricKeyIfOwned(epochAtStart, generationAtStart);
    const msg = err instanceof Error ? err.message : String(err);
    const isCanceled =
      /cancel|dismiss|user\s*canceled|user\s*cancelled|cancelei/i.test(msg);
    return {
      success: false,
      canceled: isCanceled,
      error: isCanceled ? 'Ativação cancelada pelo usuário.' : msg,
    };
  }

  // Recheca epoch imediatamente após a gravação da chave
  if (!writeKeyOk || currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
    await cleanupBiometricKeyIfOwned(epochAtStart, generationAtStart);
    return {
      success: false,
      canceled: false,
      error: 'Sessão alterada durante ativação da biometria.',
    };
  }

  // Prova biométrica real: lê a chave recém-criada com requireAuthentication
  let readBackKey: string | null = null;
  try {
    readBackKey = await SecureStore.getItemAsync(BIOMETRIC_AES_KEY_STORAGE, {
      keychainService: BIOMETRIC_KEYCHAIN_SERVICE,
      requireAuthentication: true,
      authenticationPrompt:
        promptMessage ?? 'Confirme sua biometria para ativar o acesso rápido no FuelLog',
    });
  } catch (err: unknown) {
    await cleanupBiometricKeyIfOwned(epochAtStart, generationAtStart);
    const msg = err instanceof Error ? err.message : String(err);
    const isCanceled =
      /cancel|dismiss|user\s*canceled|user\s*cancelled|cancelei/i.test(msg);
    return {
      success: false,
      canceled: isCanceled,
      error: isCanceled ? 'Ativação cancelada pelo usuário.' : msg,
    };
  }

  if (readBackKey !== base64Key) {
    await cleanupBiometricKeyIfOwned(epochAtStart, generationAtStart);
    return {
      success: false,
      canceled: false,
      error: 'Falha na validação biométrica da chave.',
    };
  }

  if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
    await cleanupBiometricKeyIfOwned(epochAtStart, generationAtStart);
    return {
      success: false,
      canceled: false,
      error: 'Sessão alterada durante ativação da biometria.',
    };
  }

  // Cifra o refresh token com AES-GCM
  const sealed = await aesEncryptAsync(new TextEncoder().encode(refreshToken), key);

  // Recheca epoch após a cifragem; se a época mudou, não remove chave alheia
  if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
    await cleanupBiometricKeyIfOwned(epochAtStart, generationAtStart);
    return {
      success: false,
      canceled: false,
      error: 'Sessão alterada durante a cifragem do refresh token.',
    };
  }

  const combined = await sealed.combined('base64');
  const envelope: BiometricRefreshEnvelope = {
    version: 1,
    mode: 'biometric',
    combined,
    sessionId: credential.session_id,
  };

  return runWithStorageLock(async () => {
    if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
      return {
        success: false,
        canceled: false,
        error: 'Sessão alterada durante a persistência da credencial biométrica.',
      };
    }

    await writeRawStorage(JSON.stringify(envelope), BIOMETRIC_REFRESH_TOKEN_KEY);

    if (currentSessionEpoch !== epochAtStart || biometricGeneration !== generationAtStart) {
      return {
        success: false,
        canceled: false,
        error: 'Sessão alterada durante a persistência da credencial biométrica.',
      };
    }

    unlockedBiometricEnvelope = JSON.stringify(envelope);
    inMemoryBiometricKey = key;
    inMemoryBiometricKeyEpoch = epochAtStart;
    inMemoryBiometricKeyGeneration = generationAtStart;
    return { success: true, canceled: false };
  });
}

/** Remove somente a credencial lembrada; preserva a sessão ativa. */
export async function disableBiometricSession(expectedEpoch?: number, alreadyRevoked = false): Promise<void> {
  const epochAtStart = expectedEpoch ?? currentSessionEpoch;
  if (currentSessionEpoch !== epochAtStart) return;
  biometricGeneration += 1;
  return runWithStorageLock(async () => {
    if (currentSessionEpoch !== epochAtStart) return;
    await removeBiometricCredential(alreadyRevoked);
  });
}

/** Logout preserva biometria e invalida respostas da sessão ativa. */
export async function clearActiveSession(expectedEpoch?: number): Promise<void> {
  if (expectedEpoch !== undefined && currentSessionEpoch !== expectedEpoch) return;
  bumpSessionEpoch();
  return runWithStorageLock(async () => {
    await writeRawStorage(null);
  });
}

/** Limpeza terminal e troca de senha removem ambas as credenciais. */
export async function clearStoredTokens(): Promise<void> {
  bumpSessionEpoch();
  return runWithStorageLock(async () => {
    let storageError: unknown = null;
    try { await writeRawStorage(null); } catch (err) { storageError = err; }
    try { await removeBiometricCredential(); } catch (err) { storageError ??= err; }
    if (storageError) throw storageError;
  });
}

export function getScopedVehicleStorageKey(userId: string): string {
  return `${ACTIVE_VEHICLE_KEY_PREFIX}${userId}`;
}
