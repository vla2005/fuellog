import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const REFRESH_TOKEN_KEY = 'fuellog.auth.refresh_token.v1';
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
}

export type TokenEnvelope = PlainRefreshEnvelope | BiometricRefreshEnvelope;

let inMemoryAccessToken: string | null = null;
let currentSessionEpoch = 0;
let inMemoryBiometricKey: AESEncryptionKey | null = null;
let inMemoryBiometricKeyEpoch: number | null = null;

let mutationQueue: Promise<unknown> = Promise.resolve();

function runWithStorageLock<T>(task: () => Promise<T>): Promise<T> {
  const run = async () => {
    return await task();
  };
  const chained = mutationQueue.then(run, run);
  mutationQueue = chained.then(() => {}, () => {});
  return chained;
}

async function cleanupBiometricKeyIfOwned(expectedEpoch: number): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }
  await runWithStorageLock(async () => {
    if (currentSessionEpoch !== expectedEpoch) {
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
  inMemoryAccessToken = null;
  inMemoryBiometricKey = null;
  inMemoryBiometricKeyEpoch = null;
  return currentSessionEpoch;
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

export function isBiometricSessionUnlocked(): boolean {
  return inMemoryBiometricKey !== null && inMemoryBiometricKeyEpoch === currentSessionEpoch;
}

async function readRawStorage(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
      }
      return null;
    }
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function writeRawStorage(value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      throw new Error('Armazenamento de sessão indisponível no navegador.');
    }
    if (value !== null) {
      window.sessionStorage.setItem(REFRESH_TOKEN_KEY, value);
    } else {
      window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    }
    return;
  }

  if (value !== null) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } else {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  }
}

/**
 * Identifica o tipo de sessão persistida:
 * - 'none': sem credencial salva
 * - 'plain': sessão tradicional em texto claro
 * - 'biometric': sessão protegida por chave biométrica
 */
export async function getStoredSessionType(): Promise<'none' | 'plain' | 'biometric'> {
  const raw = await readRawStorage();
  if (!raw) {
    return 'none';
  }
  const envelope = parseTokenEnvelope(raw);
  return envelope.mode;
}

/**
 * Retorna o refresh token atual da sessão.
 * Se a sessão for biométrica e estiver bloqueada (sem chave em memória), retorna null,
 * impedindo restaurações silenciosas ou chamadas de API antes da ação biométrica do usuário.
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
  if (token === null) {
    await writeRawStorage(null);
    return;
  }

  let envelope: TokenEnvelope;
  if (isBiometricSessionUnlocked() && Platform.OS !== 'web') {
    const sealed = await aesEncryptAsync(
      new TextEncoder().encode(token),
      inMemoryBiometricKey!,
    );
    const combined = await sealed.combined('base64');
    envelope = {
      version: 1,
      mode: 'biometric',
      combined,
    };
  } else {
    envelope = {
      version: 1,
      mode: 'plain',
      refreshToken: token,
    };
  }
  await writeRawStorage(JSON.stringify(envelope));
}

export async function saveTokenPairAtomically(
  accessToken: string,
  refreshToken: string,
  expectedEpoch?: number,
): Promise<void> {
  const epochAtStart = expectedEpoch ?? currentSessionEpoch;
  if (currentSessionEpoch !== epochAtStart) {
    throw new Error('Sessão alterada antes de persistir credenciais.');
  }

  return runWithStorageLock(async () => {
    if (currentSessionEpoch !== epochAtStart) {
      throw new Error('Sessão alterada antes de persistir credenciais.');
    }

    let envelope: TokenEnvelope;
    if (isBiometricSessionUnlocked() && Platform.OS !== 'web') {
      const sealed = await aesEncryptAsync(
        new TextEncoder().encode(refreshToken),
        inMemoryBiometricKey!,
      );
      if (currentSessionEpoch !== epochAtStart) {
        throw new Error('Sessão alterada durante a cifragem das credenciais.');
      }
      const combined = await sealed.combined('base64');
      envelope = {
        version: 1,
        mode: 'biometric',
        combined,
      };
    } else {
      envelope = {
        version: 1,
        mode: 'plain',
        refreshToken,
      };
      // Substitui a credencial sem herdar chave ou opt-in biométrico de outra conta
      if (Platform.OS !== 'web') {
        await SecureStore.deleteItemAsync(BIOMETRIC_AES_KEY_STORAGE, {
          keychainService: BIOMETRIC_KEYCHAIN_SERVICE,
        }).catch(() => {});
      }
    }

    if (currentSessionEpoch !== epochAtStart) {
      throw new Error('Sessão alterada antes da gravação das credenciais.');
    }

    await writeRawStorage(JSON.stringify(envelope));

    if (currentSessionEpoch !== epochAtStart) {
      throw new Error('Sessão alterada ou encerrada durante a persistência de credenciais.');
    }

    inMemoryAccessToken = accessToken;
  });
}

export type UnlockBiometricResult =
  | { success: true; refreshToken: string }
  | { success: false; canceled: boolean; invalidated: boolean; error: string };

/**
 * Desbloqueia a sessão biométrica lendo a chave AES protegida por SecureStore.requireAuthentication.
 * Em caso de sucesso, mantém a chave em memória para futuras rotações automáticas sem novo prompt.
 * Recheca epoch após cada await crítico (prompt, import e decrypt) para evitar corridas com logout/troca de conta.
 */
export async function unlockBiometricSession(
  promptMessage?: string,
): Promise<UnlockBiometricResult> {
  const epochAtStart = currentSessionEpoch;

  if (Platform.OS === 'web') {
    return {
      success: false,
      canceled: false,
      invalidated: false,
      error: 'Biometria não suportada no navegador.',
    };
  }

  const raw = await readRawStorage();
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
  if (currentSessionEpoch !== epochAtStart) {
    return {
      success: false,
      canceled: false,
      invalidated: false,
      error: 'Sessão alterada durante autenticação biométrica.',
    };
  }

  if (!base64Key) {
    // Chave invalidada por alteração biométrica no sistema
    await clearStoredTokens().catch(() => {});
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
    if (currentSessionEpoch !== epochAtStart) {
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
    if (currentSessionEpoch !== epochAtStart) {
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
    return { success: true, refreshToken };
  } catch (err: unknown) {
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
 * Ativa a biometria para a sessão atual:
 * - Gera chave AES aleatória de 256 bits
 * - Persiste com requireAuthentication no keychainService próprio com WHEN_UNLOCKED_THIS_DEVICE_ONLY
 * - Exige prova biométrica real lendo a chave recém-criada com requireAuthentication antes do commit
 * - Cifra o refresh token com AES-GCM e armazena o envelope
 * - Mantém a chave em memória para a sessão ativa
 * - Recheca a época rigorosamente dentro de lock serializado; nenhuma finalização antiga pode apagar nem sobrescrever a nova sessão.
 */
export async function enableBiometricSession(
  expectedEpoch?: number,
  promptMessage?: string,
): Promise<{ success: boolean; canceled: boolean; error?: string }> {
  const epochAtStart = expectedEpoch ?? currentSessionEpoch;
  if (currentSessionEpoch !== epochAtStart) {
    throw new Error('Sessão alterada antes de habilitar a biometria.');
  }

  if (Platform.OS === 'web') {
    return {
      success: false,
      canceled: false,
      error: 'Biometria não suportada no navegador.',
    };
  }

  // Obter o refresh token existente
  const raw = await readRawStorage();
  if (currentSessionEpoch !== epochAtStart) {
    throw new Error('Sessão alterada durante leitura do refresh token.');
  }

  let refreshToken: string | null = null;
  if (raw) {
    const env = parseTokenEnvelope(raw);
    if (env.mode === 'plain') {
      refreshToken = env.refreshToken;
    } else if (isBiometricSessionUnlocked()) {
      const sealed = AESSealedData.fromCombined(env.combined);
      const dec = await aesDecryptAsync(sealed, inMemoryBiometricKey!, { output: 'bytes' });
      refreshToken = new TextDecoder().decode(dec);
    }
  }

  if (!refreshToken) {
    return {
      success: false,
      canceled: false,
      error: 'Nenhuma sessão ativa encontrada para proteger.',
    };
  }

  if (currentSessionEpoch !== epochAtStart) {
    throw new Error('Sessão alterada antes da geração da chave.');
  }

  // Gera chave AES-256 aleatória
  const key = await AESEncryptionKey.generate(256);
  const base64Key = await key.encoded('base64');

  if (currentSessionEpoch !== epochAtStart) {
    throw new Error('Sessão alterada antes da gravação da chave.');
  }

  // Grava no SecureStore com requireAuthentication e WHEN_UNLOCKED_THIS_DEVICE_ONLY sob posse serializada
  let writeKeyOk = false;
  try {
    writeKeyOk = await runWithStorageLock(async () => {
      if (currentSessionEpoch !== epochAtStart) {
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
    await cleanupBiometricKeyIfOwned(epochAtStart);
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
  if (!writeKeyOk || currentSessionEpoch !== epochAtStart) {
    await cleanupBiometricKeyIfOwned(epochAtStart);
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
    await cleanupBiometricKeyIfOwned(epochAtStart);
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
    await cleanupBiometricKeyIfOwned(epochAtStart);
    return {
      success: false,
      canceled: false,
      error: 'Falha na validação biométrica da chave.',
    };
  }

  if (currentSessionEpoch !== epochAtStart) {
    await cleanupBiometricKeyIfOwned(epochAtStart);
    return {
      success: false,
      canceled: false,
      error: 'Sessão alterada durante ativação da biometria.',
    };
  }

  // Cifra o refresh token com AES-GCM
  const sealed = await aesEncryptAsync(new TextEncoder().encode(refreshToken), key);

  // Recheca epoch após a cifragem; se a época mudou, não remove chave alheia
  if (currentSessionEpoch !== epochAtStart) {
    await cleanupBiometricKeyIfOwned(epochAtStart);
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
  };

  return runWithStorageLock(async () => {
    if (currentSessionEpoch !== epochAtStart) {
      return {
        success: false,
        canceled: false,
        error: 'Sessão alterada durante a persistência da credencial biométrica.',
      };
    }

    await writeRawStorage(JSON.stringify(envelope));

    if (currentSessionEpoch !== epochAtStart) {
      return {
        success: false,
        canceled: false,
        error: 'Sessão alterada durante a persistência da credencial biométrica.',
      };
    }

    inMemoryBiometricKey = key;
    inMemoryBiometricKeyEpoch = epochAtStart;
    return { success: true, canceled: false };
  });
}

/**
 * Desativa a proteção biométrica:
 * - Mantém a sessão autenticada atual intacta
 * - Restaura o envelope normal (plain) do refresh token ANTES de apagar a chave
 * - Se a gravação do envelope normal falhar, preserva a chave protegida e o estado utilizável
 * - Remove a chave protegida do SecureStore somente após o sucesso da gravação plain
 */
export async function disableBiometricSession(expectedEpoch?: number): Promise<void> {
  const epochAtStart = expectedEpoch ?? currentSessionEpoch;

  return runWithStorageLock(async () => {
    if (currentSessionEpoch !== epochAtStart) {
      return;
    }

    const raw = await readRawStorage();
    let plainRefreshToken: string | null = null;

    if (raw) {
      const env = parseTokenEnvelope(raw);
      if (env.mode === 'plain') {
        plainRefreshToken = env.refreshToken;
      } else if (isBiometricSessionUnlocked()) {
        const sealed = AESSealedData.fromCombined(env.combined);
        const dec = await aesDecryptAsync(sealed, inMemoryBiometricKey!, { output: 'bytes' });
        plainRefreshToken = new TextDecoder().decode(dec);
      }
    }

    if (currentSessionEpoch !== epochAtStart) {
      return;
    }

    if (!plainRefreshToken) {
      // Se não há credencial para reverter, apenas limpa chaves órfãs sob lock serializado com conferência de época
      if (Platform.OS !== 'web') {
        await SecureStore.deleteItemAsync(BIOMETRIC_AES_KEY_STORAGE, {
          keychainService: BIOMETRIC_KEYCHAIN_SERVICE,
        }).catch(() => {});
      }
      inMemoryBiometricKey = null;
      inMemoryBiometricKeyEpoch = null;
      return;
    }

    // 1. PRIMEIRO prepara o envelope plain normal
    const plainEnvelope: PlainRefreshEnvelope = {
      version: 1,
      mode: 'plain',
      refreshToken: plainRefreshToken,
    };

    // Grava PRIMEIRO o envelope plain normal
    await writeRawStorage(JSON.stringify(plainEnvelope));

    if (currentSessionEpoch !== epochAtStart) {
      throw new Error('Sessão alterada durante a gravação da credencial desativada.');
    }

    // SOMENTE APÓS confirmar a gravação normal do refresh, exclui a chave protegida
    if (Platform.OS !== 'web') {
      await SecureStore.deleteItemAsync(BIOMETRIC_AES_KEY_STORAGE, {
        keychainService: BIOMETRIC_KEYCHAIN_SERVICE,
      }).catch(() => {});
    }

    inMemoryBiometricKey = null;
    inMemoryBiometricKeyEpoch = null;
  });
}

/**
 * Limpa todos os tokens em memória e no armazenamento persistido,
 * removendo a chave biométrica e avançando a época da sessão.
 */
export async function clearStoredTokens(): Promise<void> {
  bumpSessionEpoch();

  return runWithStorageLock(async () => {
    let storageError: unknown = null;
    try {
      await writeRawStorage(null);
    } catch (err) {
      storageError = err;
    }

    if (Platform.OS !== 'web') {
      try {
        await SecureStore.deleteItemAsync(BIOMETRIC_AES_KEY_STORAGE, {
          keychainService: BIOMETRIC_KEYCHAIN_SERVICE,
        });
      } catch {
        // Ignora erro ao remover chave que talvez não existisse
      }
    }

    if (storageError) {
      throw storageError;
    }
  });
}

export function getScopedVehicleStorageKey(userId: string): string {
  return `${ACTIVE_VEHICLE_KEY_PREFIX}${userId}`;
}
