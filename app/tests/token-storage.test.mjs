import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nodeCrypto from 'node:crypto';
import ts from 'typescript';

function createExpoCryptoMock({
  onBeforeEncrypt = async () => {},
  onBeforeDecrypt = async () => {},
} = {}) {
  class AESEncryptionKey {
    constructor(buffer) {
      this._buffer = buffer;
    }
    static async generate(size = 256) {
      return new AESEncryptionKey(nodeCrypto.randomBytes(size / 8));
    }
    static async import(input, encoding) {
      const buf = typeof input === 'string' ? Buffer.from(input, encoding) : Buffer.from(input);
      return new AESEncryptionKey(buf);
    }
    async bytes() {
      return new Uint8Array(this._buffer);
    }
    async encoded(encoding) {
      return this._buffer.toString(encoding);
    }
  }

  class AESSealedData {
    constructor(combinedBuffer) {
      this._buffer = combinedBuffer;
    }
    static fromCombined(combined) {
      const buf = typeof combined === 'string' ? Buffer.from(combined, 'base64') : Buffer.from(combined);
      return new AESSealedData(buf);
    }
    async combined(encoding = 'base64') {
      return this._buffer.toString(encoding);
    }
  }

  async function aesEncryptAsync(plaintext, key) {
    await onBeforeEncrypt();
    const iv = nodeCrypto.randomBytes(12);
    const keyBuf = key._buffer;
    const plainBuf = typeof plaintext === 'string'
      ? Buffer.from(plaintext, 'base64')
      : Buffer.from(plaintext);
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', keyBuf, iv);
    const ciphertext = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
    const tag = cipher.getAuthTag();
    const combined = Buffer.concat([iv, ciphertext, tag]);
    return new AESSealedData(combined);
  }

  async function aesDecryptAsync(sealedData, key, options = {}) {
    await onBeforeDecrypt();
    const combined = sealedData._buffer;
    const iv = combined.subarray(0, 12);
    const tag = combined.subarray(combined.length - 16);
    const ciphertext = combined.subarray(12, combined.length - 16);
    const keyBuf = key._buffer;

    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (options.output === 'base64') {
      return decrypted.toString('base64');
    }
    return new Uint8Array(decrypted);
  }

  return {
    AESEncryptionKey,
    AESSealedData,
    aesEncryptAsync,
    aesDecryptAsync,
  };
}

function loadStorage(
  setItemAsync = async () => {},
  {
    platform = 'android',
    getItemAsync = async () => null,
    deleteItemAsync = async () => {},
    secureStoreExtra = {},
    expoCryptoExtra = {},
  } = {},
) {
  const source = readFileSync(new URL('../src/api/tokenStorage.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const dependencies = {
    'expo-secure-store': {
      setItemAsync,
      getItemAsync,
      deleteItemAsync,
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
      canUseBiometricAuthentication: () => true,
      ...secureStoreExtra,
    },
    'expo-crypto': createExpoCryptoMock(expoCryptoExtra),
    'react-native': { Platform: { OS: platform } },
  };

  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Import não autorizado: ${specifier}`);
    return dependencies[specifier];
  }, module, module.exports);
  return module.exports;
}

test('novo access só fica disponível depois de persistir refresh', async () => {
  let release;
  const persisted = new Promise(resolve => {
    release = resolve;
  });
  const storage = loadStorage(async () => persisted);
  storage.setAccessToken('previous-access');
  const saving = storage.saveTokenPairAtomically('new-access', 'new-refresh');
  try {
    assert.ok(
      storage.getAccessToken() === 'previous-access',
      'Não publicar access antes de persistir refresh',
    );
  } finally {
    release();
    await saving;
  }
  assert.ok(storage.getAccessToken() === 'new-access');
});

test('falha do SecureStore é explícita e preserva access anterior', async () => {
  const storage = loadStorage(async () => {
    throw new Error('SecureStore indisponível no teste');
  });
  storage.setAccessToken('previous-access');
  await assert.rejects(storage.saveTokenPairAtomically('new-access', 'new-refresh'));
  assert.ok(
    storage.getAccessToken() === 'previous-access',
    'Falha de persistência não publica novo access',
  );
});

for (const platform of ['android', 'web']) {
  test(`remoção falha no ${platform}: memória limpa, epoch avança e erro explícito`, async () => {
    const originalWindow = globalThis.window;
    const failure = new Error('Storage access denied');
    if (platform === 'web') {
      globalThis.window = {
        sessionStorage: {
          removeItem: () => {
            throw failure;
          },
        },
      };
    }
    const storage = loadStorage(async () => {}, {
      platform,
      deleteItemAsync: async () => {
        throw failure;
      },
    });
    storage.setAccessToken('previous-access');
    const previousEpoch = storage.getSessionEpoch();
    try {
      const result = await storage
        .clearStoredTokens()
        .then(() => ({ error: null }), error => ({ error }));
      assert.equal(storage.getAccessToken(), null);
      assert.ok(storage.getSessionEpoch() > previousEpoch);
      assert.ok(result.error, 'Falha ao apagar refresh deve ser informada');
    } finally {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    }
  });
}

test('compatibilidade com formato legado: interpreta texto simples como plain envelope', () => {
  const storage = loadStorage();
  const env = storage.parseTokenEnvelope('legacy-raw-refresh-jwt');
  assert.equal(env.version, 1);
  assert.equal(env.mode, 'plain');
  assert.equal(env.refreshToken, 'legacy-raw-refresh-jwt');
});

test('sessão biométrica bloqueada no bootstrap retorna null e não restaura silenciosamente', async () => {
  const mockStorage = new Map();
  mockStorage.set('fuellog.auth.refresh_token.v1', JSON.stringify({
    version: 1,
    mode: 'biometric',
    combined: Buffer.from(nodeCrypto.randomBytes(48)).toString('base64'),
  }));

  const storage = loadStorage(
    async (k, v) => mockStorage.set(k, v),
    {
      getItemAsync: async k => mockStorage.get(k) ?? null,
      deleteItemAsync: async k => mockStorage.delete(k),
    },
  );

  const sessionType = await storage.getStoredSessionType();
  assert.equal(sessionType, 'biometric', 'Deve identificar sessão biométrica');

  const refresh = await storage.getRefreshToken();
  assert.equal(refresh, null, 'Refresh deve ser null quando biométrico está bloqueado');
  assert.equal(storage.isBiometricSessionUnlocked(), false);
});

test('fluxo completo: login plain -> ativação biométrica -> persistência cifrada -> rotação transparente', async () => {
  const secureStore = new Map();
  const storage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
    },
  );

  // 1. Login inicial sem biometria
  await storage.saveTokenPairAtomically('access-1', 'refresh-token-secret-1');
  const rawInitial = secureStore.get('fuellog.auth.refresh_token.v1');
  const envInitial = JSON.parse(rawInitial);
  assert.equal(envInitial.mode, 'plain');
  assert.equal(envInitial.refreshToken, 'refresh-token-secret-1');

  // 2. Ativação biométrica explícita
  const enableResult = await storage.enableBiometricSession();
  assert.equal(enableResult.success, true);
  assert.ok(storage.isBiometricSessionUnlocked(), 'Sessão deve estar desbloqueada após ativação');

  const rawBiometric = secureStore.get('fuellog.auth.refresh_token.v1');
  const envBiometric = JSON.parse(rawBiometric);
  assert.equal(envBiometric.mode, 'biometric');
  assert.ok(envBiometric.combined, 'Deve conter dados cifrados');
  assert.ok(
    !rawBiometric.includes('refresh-token-secret-1'),
    'O refresh token original nunca deve estar em texto claro no storage',
  );

  const rawAesKey = secureStore.get('fuellog_biometric_service:fuellog.biometric.aes_key.v1');
  assert.ok(rawAesKey, 'Chave AES deve ser persistida no keychainService próprio');

  // 3. Rotação de tokens durante a sessão ativa (sem novo prompt)
  await storage.saveTokenPairAtomically('access-2', 'refresh-token-secret-2');
  const rawRotated = secureStore.get('fuellog.auth.refresh_token.v1');
  const envRotated = JSON.parse(rawRotated);
  assert.equal(envRotated.mode, 'biometric');
  assert.ok(!rawRotated.includes('refresh-token-secret-2'), 'Novo refresh foi recifrado');

  const currentRefresh = await storage.getRefreshToken();
  assert.equal(currentRefresh, 'refresh-token-secret-2');

  // 4. Desativar biometria restaura armazenamento plain e exclui chave protegida
  await storage.disableBiometricSession();
  assert.equal(storage.isBiometricSessionUnlocked(), false);
  assert.equal(
    secureStore.get('fuellog_biometric_service:fuellog.biometric.aes_key.v1'),
    undefined,
    'Chave protegida deve ser deletada ao desativar',
  );

  const rawAfterDisable = secureStore.get('fuellog.auth.refresh_token.v1');
  const envAfterDisable = JSON.parse(rawAfterDisable);
  assert.equal(envAfterDisable.mode, 'plain');
  assert.equal(envAfterDisable.refreshToken, 'refresh-token-secret-2');
});

test('desbloqueio biométrico: sucesso decifra credencial e cancelamento preserva sem apagar', async () => {
  const secureStore = new Map();
  let simulatePromptOutcome = 'success';

  const storage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        if (opts?.requireAuthentication) {
          if (simulatePromptOutcome === 'cancel') {
            throw new Error('User canceled the authentication');
          }
          if (simulatePromptOutcome === 'invalidated') {
            return null;
          }
        }
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
    },
  );

  // Inicializa e ativa biometria
  await storage.saveTokenPairAtomically('access-0', 'refresh-original-value');
  await storage.enableBiometricSession();

  // Simula cold restart (novo storage carregado sem chave em memória)
  const freshStorage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        if (opts?.requireAuthentication) {
          if (simulatePromptOutcome === 'cancel') {
            throw new Error('User canceled the authentication');
          }
          if (simulatePromptOutcome === 'invalidated') {
            return null;
          }
        }
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
    },
  );

  assert.equal(freshStorage.isBiometricSessionUnlocked(), false);
  assert.equal(await freshStorage.getRefreshToken(), null, 'Locked');

  // Cenário 1: Usuário cancela prompt
  simulatePromptOutcome = 'cancel';
  const cancelResult = await freshStorage.unlockBiometricSession();
  assert.equal(cancelResult.success, false);
  assert.equal(cancelResult.canceled, true);
  assert.ok(secureStore.has('fuellog.auth.refresh_token.v1'), 'Não deve apagar ao cancelar');
  assert.ok(
    secureStore.has('fuellog_biometric_service:fuellog.biometric.aes_key.v1'),
    'Não deve apagar chave ao cancelar',
  );

  // Cenário 2: Usuário confirma biometria com sucesso
  simulatePromptOutcome = 'success';
  const unlockResult = await freshStorage.unlockBiometricSession();
  assert.equal(unlockResult.success, true);
  assert.equal(unlockResult.refreshToken, 'refresh-original-value');
  assert.equal(freshStorage.isBiometricSessionUnlocked(), true);
  assert.equal(await freshStorage.getRefreshToken(), 'refresh-original-value');

  // Cenário 3: Biometria alterada no OS (chave invalidada)
  simulatePromptOutcome = 'invalidated';
  const invalidatedStorage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        if (opts?.requireAuthentication) return null;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
    },
  );
  const invalidResult = await invalidatedStorage.unlockBiometricSession();
  assert.equal(invalidResult.success, false);
  assert.equal(invalidResult.invalidated, true);
});

test('corrida: clearStoredTokens durante encryptAsync de enableBiometricSession descarta persistência e não preenche memória', async () => {
  const secureStore = new Map();
  let delayEncrypt;
  const triggerEncryptHold = new Promise(resolve => {
    delayEncrypt = resolve;
  });
  let signalStartedEncrypt;
  const startedEncryptPromise = new Promise(resolve => {
    signalStartedEncrypt = resolve;
  });
  let holdEncryption = false;

  const storage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
      expoCryptoExtra: {
        onBeforeEncrypt: async () => {
          if (holdEncryption) {
            signalStartedEncrypt();
            await triggerEncryptHold;
          }
        },
      },
    },
  );

  await storage.saveTokenPairAtomically('access-orig', 'refresh-orig');

  // Inicia enableBiometricSession mas retém durante aesEncryptAsync
  holdEncryption = true;
  const enablingPromise = storage.enableBiometricSession();

  // Espera a execução chegar efetivamente dentro de onBeforeEncrypt
  await startedEncryptPromise;

  // Enquanto está suspenso na cifragem, o usuário faz logout
  await storage.clearStoredTokens();
  assert.equal(storage.getAccessToken(), null);
  assert.equal(storage.isBiometricSessionUnlocked(), false);

  // Libera a cifragem retida
  delayEncrypt();
  const enableResult = await enablingPromise;

  assert.equal(enableResult.success, false, 'Enable deve falhar pois época avançou no logout');
  assert.equal(
    storage.isBiometricSessionUnlocked(),
    false,
    'inMemoryBiometricKey não pode ficar preenchida após logout',
  );
  assert.equal(
    secureStore.get('fuellog_biometric_service:fuellog.biometric.aes_key.v1'),
    undefined,
    'Chave órfã deve ter sido deletada',
  );
  assert.equal(
    secureStore.get('fuellog.auth.refresh_token.v1'),
    undefined,
    'Envelope antigo não deve ter sido persistido',
  );
});

test('atomicidade: falha ao gravar envelope normal em disableBiometricSession preserva chave e credencial protegida', async () => {
  const secureStore = new Map();
  let failWrite = false;

  const storage = loadStorage(
    async (k, v, opts) => {
      if (failWrite && k === 'fuellog.auth.refresh_token.v1' && !opts?.keychainService) {
        throw new Error('Falha de I/O forçada ao salvar envelope plain');
      }
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
    },
  );

  // 1. Inicializa com biometria
  await storage.saveTokenPairAtomically('access-active', 'refresh-vital-token');
  await storage.enableBiometricSession();
  assert.equal(storage.isBiometricSessionUnlocked(), true);

  // 2. Agora força falha em writeRawStorage durante disableBiometricSession
  failWrite = true;
  await assert.rejects(storage.disableBiometricSession(), /Falha de I\/O forçada/);

  // 3. Verifica que a chave protegida e a credencial protegida NÃO foram destruídas
  assert.ok(
    secureStore.has('fuellog_biometric_service:fuellog.biometric.aes_key.v1'),
    'Chave protegida não deve ser apagada se o write falhar',
  );
  assert.ok(
    secureStore.has('fuellog.auth.refresh_token.v1'),
    'Envelope biométrico deve permanecer intacto',
  );

  // A sessão continua utilizável e decifrável!
  failWrite = false;
  const refresh = await storage.getRefreshToken();
  assert.equal(refresh, 'refresh-vital-token', 'Credencial continua disponível');
});

test('corrida: clearStoredTokens durante unlockBiometricSession descarta resultado e não polui memória', async () => {
  const secureStore = new Map();
  let delayUnlock;
  const triggerUnlockHold = new Promise(resolve => {
    delayUnlock = resolve;
  });
  let signalStartedDecrypt;
  const startedDecryptPromise = new Promise(resolve => {
    signalStartedDecrypt = resolve;
  });
  let holdDecrypt = false;

  const storage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
      expoCryptoExtra: {
        onBeforeDecrypt: async () => {
          if (holdDecrypt) {
            signalStartedDecrypt();
            await triggerUnlockHold;
          }
        },
      },
    },
  );

  await storage.saveTokenPairAtomically('access-0', 'refresh-to-unlock');
  await storage.enableBiometricSession();

  // Simula cold restart com chave ausente em memória
  const coldStorage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
      expoCryptoExtra: {
        onBeforeDecrypt: async () => {
          if (holdDecrypt) {
            signalStartedDecrypt();
            await triggerUnlockHold;
          }
        },
      },
    },
  );

  holdDecrypt = true;
  const unlockingPromise = coldStorage.unlockBiometricSession();

  // Espera a execução chegar efetivamente dentro de onBeforeDecrypt
  await startedDecryptPromise;

  // Durante o desbloqueio, o usuário executa clearStoredTokens
  await coldStorage.clearStoredTokens();

  // Libera a decifragem
  delayUnlock();
  const unlockResult = await unlockingPromise;

  assert.equal(
    unlockResult.success,
    false,
    'Desbloqueio tardio deve ser descartado após mudança de época',
  );
  assert.equal(
    coldStorage.isBiometricSessionUnlocked(),
    false,
    'inMemoryBiometricKey não pode ser preenchida',
  );
});

test('corrida: Session A enableBiometricSession atrasado versus logout e nova sessão B não apaga nem sobrescreve B', async () => {
  const secureStore = new Map();
  let delayEncrypt;
  const triggerEncryptHold = new Promise(resolve => {
    delayEncrypt = resolve;
  });
  let signalStartedEncrypt;
  const startedEncryptPromise = new Promise(resolve => {
    signalStartedEncrypt = resolve;
  });
  let holdEncryption = false;

  const storage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
      expoCryptoExtra: {
        onBeforeEncrypt: async () => {
          if (holdEncryption) {
            signalStartedEncrypt();
            await triggerEncryptHold;
          }
        },
      },
    },
  );

  // 1. Sessão A inicia e salva credenciais
  await storage.saveTokenPairAtomically('access-A', 'refresh-A', 0);

  // 2. Sessão A inicia enableBiometricSession mas fica suspensa durante a cifragem
  holdEncryption = true;
  const sessionAEnablePromise = storage.enableBiometricSession();
  await startedEncryptPromise;

  // 3. Usuário faz logout (invalida imediatamente o epoch de A)
  await storage.clearStoredTokens();

  // 4. Nova Sessão B é estabelecida (login por senha) com novos tokens
  const epochB = storage.getSessionEpoch();
  await storage.saveTokenPairAtomically('access-B', 'refresh-B', epochB);

  assert.equal(await storage.getRefreshToken(), 'refresh-B', 'Sessão B gravada com sucesso');

  // 5. Finalização tardia da Sessão A é liberada
  delayEncrypt();
  const sessionAResult = await sessionAEnablePromise;

  // Sessão A falhou com detecção de mudança de época
  assert.equal(sessionAResult.success, false);

  // O armazenamento da Sessão B DEVE permanecer intocado: não foi sobrescrito nem apagado!
  const rawAfterA = secureStore.get('fuellog.auth.refresh_token.v1');
  assert.ok(rawAfterA, 'Envelope da sessão B não pode ter sido apagado por A');
  const parsed = JSON.parse(rawAfterA);
  assert.equal(parsed.mode, 'plain', 'Modo plain de B preservado');
  assert.equal(parsed.refreshToken, 'refresh-B', 'Refresh token de B preservado intacto');
  assert.equal(await storage.getRefreshToken(), 'refresh-B');
});

test('prova biométrica real: enableBiometricSession exige validação de leitura e cancelamento descarta chave', async () => {
  const secureStore = new Map();
  let readAttempts = 0;
  let simulateCancelOnReadBack = false;

  const storage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        if (opts?.requireAuthentication && k === 'fuellog.biometric.aes_key.v1') {
          readAttempts += 1;
          if (simulateCancelOnReadBack) {
            throw new Error('User canceled the authentication');
          }
        }
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
    },
  );

  await storage.saveTokenPairAtomically('access-0', 'refresh-plain-value');

  // Simula cancelamento do usuário durante o prompt de prova biométrica real
  simulateCancelOnReadBack = true;
  const result = await storage.enableBiometricSession();

  assert.equal(result.success, false);
  assert.equal(result.canceled, true);
  assert.ok(readAttempts >= 1, 'Deve ter tentado ler a chave criada com requireAuthentication');
  assert.equal(
    secureStore.has('fuellog_biometric_service:fuellog.biometric.aes_key.v1'),
    false,
    'Chave órfã deve ter sido apagada após cancelamento da prova biométrica',
  );

  // Sessão plain original continua preservada e utilizável
  const currentRefresh = await storage.getRefreshToken();
  assert.equal(currentRefresh, 'refresh-plain-value');
});

test('login completo por senha limpa chave biométrica anterior e não herda de outra conta', async () => {
  const secureStore = new Map();

  const storage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
    },
  );

  // Conta A ativa biometria
  await storage.saveTokenPairAtomically('access-A', 'refresh-A', 0);
  const bioA = await storage.enableBiometricSession();
  assert.equal(bioA.success, true);
  assert.ok(secureStore.has('fuellog_biometric_service:fuellog.biometric.aes_key.v1'));

  // Nova conta B faz login completo por senha (nova época)
  storage.bumpSessionEpoch();
  const epochB = storage.getSessionEpoch();
  await storage.saveTokenPairAtomically('access-B', 'refresh-B', epochB);

  // Chave biométrica da conta A não é herdada
  assert.equal(
    secureStore.has('fuellog_biometric_service:fuellog.biometric.aes_key.v1'),
    false,
    'Chave biométrica da conta anterior deve ter sido removida no login plain da nova conta',
  );
  assert.equal(storage.isBiometricSessionUnlocked(), false);

  const envB = JSON.parse(secureStore.get('fuellog.auth.refresh_token.v1'));
  assert.equal(envB.mode, 'plain');
  assert.equal(envB.refreshToken, 'refresh-B');
});

test('regressão coordenada: ativação A tardia não apaga chave biométrica de B e B persiste utilizável em cold reload', async () => {
  const secureStore = new Map();
  let delayEncryptA;
  const triggerEncryptAHold = new Promise(resolve => {
    delayEncryptA = resolve;
  });
  let signalStartedEncryptA;
  const startedEncryptAPromise = new Promise(resolve => {
    signalStartedEncryptA = resolve;
  });
  let holdFirstEncryptA = true;

  const storage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
      expoCryptoExtra: {
        onBeforeEncrypt: async () => {
          if (holdFirstEncryptA) {
            holdFirstEncryptA = false;
            signalStartedEncryptA();
            await triggerEncryptAHold;
          }
        },
      },
    },
  );

  // 1. Salvar A
  await storage.saveTokenPairAtomically('access-A', 'refresh-A', 0);

  // 2. Iniciar enable A e reter somente o primeiro aesEncryptAsync depois da criação/leitura protegida
  const enableAPromise = storage.enableBiometricSession();
  await startedEncryptAPromise;

  // 3. Usuário faz clearStoredTokens e bump de nova sessão
  await storage.clearStoredTokens();
  storage.bumpSessionEpoch();
  const epochB = storage.getSessionEpoch();

  // 4. Salvar B e concluir enable B com sucesso
  await storage.saveTokenPairAtomically('access-B', 'refresh-B', epochB);
  const enableBResult = await storage.enableBiometricSession(epochB);
  assert.equal(enableBResult.success, true, 'Sessão B deve ativar biometria com sucesso');

  // 5. Liberar encrypt de A
  delayEncryptA();
  const enableAResult = await enableAPromise;
  assert.equal(enableAResult.success, false, 'Ativação tardia de A deve falhar');

  // 6. Confere que a chave persistida de B NÃO foi apagada pela limpeza de A
  const keyKey = 'fuellog_biometric_service:fuellog.biometric.aes_key.v1';
  assert.ok(
    secureStore.has(keyKey),
    'Chave biométrica protegida de B DEVE estar presente no SecureStore após término de A',
  );

  const envRaw = secureStore.get('fuellog.auth.refresh_token.v1');
  assert.ok(envRaw, 'Envelope persistido deve existir');
  const envParsed = JSON.parse(envRaw);
  assert.equal(envParsed.mode, 'biometric', 'Modo armazenado deve ser biométrico');

  // 7. Simula cold restart (novo storage carregado sem cache em memória)
  const coldStorage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
    },
  );

  assert.equal(await coldStorage.getStoredSessionType(), 'biometric');
  assert.equal(coldStorage.isBiometricSessionUnlocked(), false, 'Cold restart inicia bloqueado');

  // Desbloqueia com biometria usando a chave persistida de B
  const unlockResult = await coldStorage.unlockBiometricSession();
  assert.equal(unlockResult.success, true, 'Desbloqueio de B em cold restart deve ter sucesso');
  assert.equal(unlockResult.refreshToken, 'refresh-B', 'Refresh token de B deve ser decifrado corretamente');
});

test('regressão coordenada: leitura protegida cancelada em A com delete atrasado não apaga chave biométrica de B e B desbloqueia em cold reload', async () => {
  const secureStore = new Map();
  let holdDeleteA = false;
  let releaseDeleteA;
  const deleteAHoldPromise = new Promise(resolve => {
    releaseDeleteA = resolve;
  });
  let signalDeleteAStarted;
  const deleteAStartedPromise = new Promise(resolve => {
    signalDeleteAStarted = resolve;
  });

  let failReadBackA = false;

  const storage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        if (failReadBackA && storeKey === 'fuellog_biometric_service:fuellog.biometric.aes_key.v1') {
          failReadBackA = false;
          throw new Error('User canceled authentication');
        }
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        if (holdDeleteA && storeKey === 'fuellog_biometric_service:fuellog.biometric.aes_key.v1') {
          holdDeleteA = false;
          signalDeleteAStarted();
          await deleteAHoldPromise;
        }
        secureStore.delete(storeKey);
      },
    },
  );

  // 1. Salvar credenciais de A
  await storage.saveTokenPairAtomically('access-A', 'refresh-A', 0);

  // Armar o cancelamento do prompt biométrico e retenção de delete especificamente para a ativação de A
  failReadBackA = true;
  holdDeleteA = true;

  // 2. Iniciar enableBiometricSession de A (o readBackKey falha com cancelamento e aciona cleanupBiometricKeyIfOwned)
  const enableAPromise = storage.enableBiometricSession();
  await deleteAStartedPromise;

  // 3. Disparar logout e login + enable de B concorrentemente
  const clearing = storage.clearStoredTokens();
  const bPromise = (async () => {
    await clearing;
    const epochB = storage.getSessionEpoch();
    await storage.saveTokenPairAtomically('access-B', 'refresh-B', epochB);
    return await storage.enableBiometricSession(epochB);
  })();

  // 4. Liberar delete de A sem deadlock
  releaseDeleteA();

  const [resultA, resultB] = await Promise.all([enableAPromise, bPromise]);
  assert.equal(resultA.success, false, 'Ativação de A deve falhar por cancelamento');
  assert.equal(resultA.canceled, true, 'Ativação de A deve reportar canceled=true');
  assert.equal(resultB.success, true, 'Ativação de B deve ser concluída com sucesso');

  // 5. Confere que a chave biométrica de B está preservada no SecureStore
  const keyKey = 'fuellog_biometric_service:fuellog.biometric.aes_key.v1';
  assert.ok(secureStore.has(keyKey), 'Chave biométrica de B deve estar preservada');

  // 6. Cold reload: nova instância sem estado em memória
  const coldStorage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
    },
  );

  assert.equal(await coldStorage.getStoredSessionType(), 'biometric');
  const unlockResult = await coldStorage.unlockBiometricSession();
  assert.equal(unlockResult.success, true, 'Desbloqueio de B em cold reload deve ter sucesso');
  assert.equal(unlockResult.refreshToken, 'refresh-B', 'Refresh token de B deve ser recuperado');
});

test('regressão coordenada: invalidação antes de disableBiometricSession sem refresh token não apaga chave de B', async () => {
  const secureStore = new Map();

  const storage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
    },
  );

  // 1. Invalidação ocorre antes da desativação de A:
  // Sessão B assume, faz login e ativa biometria na sua época
  const epochA = storage.getSessionEpoch();
  storage.bumpSessionEpoch();
  const epochB = storage.getSessionEpoch();
  await storage.saveTokenPairAtomically('access-B', 'refresh-B', epochB);
  const enableBResult = await storage.enableBiometricSession(epochB);
  assert.equal(enableBResult.success, true);

  const keyKey = 'fuellog_biometric_service:fuellog.biometric.aes_key.v1';
  assert.ok(secureStore.has(keyKey));

  // 2. A executa disableBiometricSession(epochA) (que na época de A não tinha refresh token)
  await storage.disableBiometricSession(epochA);

  // 3. A chave de B DEVE continuar intacta no SecureStore
  assert.ok(
    secureStore.has(keyKey),
    'Chave biométrica de B não deve ter sido apagada pela ramificação sem refresh token de A',
  );

  // 4. Cold reload desbloqueia B com sucesso
  const coldStorage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
    },
  );

  assert.equal(await coldStorage.getStoredSessionType(), 'biometric');
  const unlockResult = await coldStorage.unlockBiometricSession();
  assert.equal(unlockResult.success, true);
  assert.equal(unlockResult.refreshToken, 'refresh-B');
});

test('regressão coordenada: corrida entre disableBiometricSession e rotação concorrente preserva último refresh R2', async () => {
  const secureStore = new Map();
  let holdDecrypt = false;
  let releaseDecrypt;
  const decryptHoldPromise = new Promise(resolve => {
    releaseDecrypt = resolve;
  });
  let signalDecryptStarted;
  const decryptStartedPromise = new Promise(resolve => {
    signalDecryptStarted = resolve;
  });

  const storage = loadStorage(
    async (k, v, opts) => {
      const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
      secureStore.set(storeKey, v);
    },
    {
      getItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        return secureStore.get(storeKey) ?? null;
      },
      deleteItemAsync: async (k, opts) => {
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
      expoCryptoExtra: {
        onBeforeDecrypt: async () => {
          if (holdDecrypt) {
            holdDecrypt = false;
            signalDecryptStarted();
            await decryptHoldPromise;
          }
        },
      },
    },
  );

  // 1. Salvar R1 e ativar biometria
  await storage.saveTokenPairAtomically('access-1', 'refresh-1', 0);
  const enableResult = await storage.enableBiometricSession(0);
  assert.equal(enableResult.success, true);

  // Armar a retenção durante o decrypt de disableBiometricSession
  holdDecrypt = true;

  // 2. Iniciar disableBiometricSession (vai reter dentro do lock durante aesDecryptAsync)
  const disablePromise = storage.disableBiometricSession();
  await decryptStartedPromise;

  // 3. Rotação legítima concorre para salvar access-2 e refresh-2 no mesmo epoch
  const rotatePromise = storage.saveTokenPairAtomically('access-2', 'refresh-2', 0);

  // 4. Liberar decrypt de disable
  releaseDecrypt();

  await Promise.all([disablePromise, rotatePromise]);

  // 5. O refresh token mais recente (R2) DEVE ser preservado
  const latestRefresh = await storage.getRefreshToken();
  assert.equal(
    latestRefresh,
    'refresh-2',
    'O refresh token mais recente da rotação (refresh-2) deve ser preservado, sem regressão para refresh-1',
  );

  // Envelope deve estar em plain mode
  assert.equal(await storage.getStoredSessionType(), 'plain');
});
