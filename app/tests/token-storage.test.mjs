import test from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { loadStorage } from './helpers/session-fixtures.mjs';

const rememberedCredential = (refreshToken = 'remembered-B', sessionId = '20000000-0000-4000-8000-000000000001') => ({
  refresh_token: refreshToken,
  refresh_expires_at: '2099-01-01T00:00:00Z',
  session_id: sessionId,
});

function memoryStorage(secureStore = new Map(), options = {}) {
  const key = (k, opts) => opts?.keychainService ? `${opts.keychainService}:${k}` : k;
  const dependencies = {
    getItemAsync: async (k, opts) => secureStore.get(key(k, opts)) ?? null,
    deleteItemAsync: async (k, opts) => secureStore.delete(key(k, opts)),
    ...options,
  };
  return loadStorage(async (k, value, opts) => secureStore.set(key(k, opts), value), dependencies);
}

test('sessão ativa com biometria restaura sem ler chave protegida e refresh não substitui B', async () => {
  const disk = new Map();
  const storage = memoryStorage(disk);
  await storage.saveTokenPairAtomically('access-A', 'refresh-A');
  assert.equal((await storage.enableBiometricSession(rememberedCredential())).success, true);
  const rememberedBefore = disk.get('fuellog.biometric.refresh_token.v1');
  await storage.saveTokenPairAtomically('access-A2', 'refresh-A2');
  assert.equal(disk.get('fuellog.biometric.refresh_token.v1'), rememberedBefore);
  assert.ok(!rememberedBefore.includes('remembered-B'));
  const cold = memoryStorage(disk, { getItemAsync: async (k, opts) => {
    assert.ok(!opts?.requireAuthentication, 'cold start não solicita biometria');
    return disk.get(k) ?? null;
  } });
  assert.equal(await cold.getRefreshToken(), 'refresh-A2');
  assert.equal(await cold.getStoredSessionType(), 'plain');
  assert.equal(await cold.getBiometricSessionId(), '20000000-0000-4000-8000-000000000001');
});

test('logout remove ativo e mantém B protegido após reload; login por senha de outra conta remove vínculo', async () => {
  const disk = new Map();
  const storage = memoryStorage(disk);
  await storage.saveTokenPairAtomically('access-A', 'refresh-A');
  await storage.enableBiometricSession(rememberedCredential());
  const epoch = storage.getSessionEpoch();
  await storage.clearActiveSession();
  assert.equal(storage.getSessionEpoch(), epoch + 1);
  assert.equal(storage.getAccessToken(), null);
  const cold = memoryStorage(disk);
  assert.equal(await cold.getRefreshToken(), null);
  assert.equal(await cold.getBiometricSessionId(), '20000000-0000-4000-8000-000000000001');
  const unlock = await cold.unlockBiometricSession();
  assert.equal(unlock.refreshToken, 'remembered-B');
  await cold.saveTokenPairAtomically('other-access', 'other-refresh', cold.getSessionEpoch(), { clearBiometrics: true });
  assert.equal(await cold.getBiometricSessionId(), null);
  assert.equal(cold.isBiometricSessionUnlocked(), false);
  assert.ok(!disk.has('fuellog_biometric_service:fuellog.biometric.aes_key.v1'));
});

test('relogin biométrico persiste B rotacionado antes de C e nunca publica acesso quando C falha', async () => {
  const disk = new Map();
  const storage = memoryStorage(disk);
  await storage.saveTokenPairAtomically('access-A', 'refresh-A');
  await storage.enableBiometricSession(rememberedCredential());
  await storage.clearActiveSession();
  const order = [];
  let failActive = true;
  const cold = loadStorage(async (k, value, opts) => {
    order.push(k);
    if (k === 'fuellog.auth.refresh_token.v1' && failActive) throw new Error('write C failed');
    disk.set(opts?.keychainService ? `${opts.keychainService}:${k}` : k, value);
  }, {
    getItemAsync: async (k, opts) => disk.get(opts?.keychainService ? `${opts.keychainService}:${k}` : k) ?? null,
    deleteItemAsync: async (k, opts) => disk.delete(opts?.keychainService ? `${opts.keychainService}:${k}` : k),
  });
  await cold.unlockBiometricSession();
  await assert.rejects(cold.saveBiometricLoginAtomically(rememberedCredential('B2'), { access_token: 'access-C', refresh_token: 'refresh-C' }, 0), /write C failed/);
  assert.deepEqual(order, ['fuellog.biometric.refresh_token.v1', 'fuellog.auth.refresh_token.v1']);
  assert.equal(cold.getAccessToken(), null);
  assert.equal(await cold.getRefreshToken(), null);
  assert.equal((await cold.unlockBiometricSession()).refreshToken, 'B2');
  failActive = false;
  await cold.saveBiometricLoginAtomically(rememberedCredential('B3'), { access_token: 'access-C2', refresh_token: 'refresh-C2' }, 0);
  assert.equal(cold.getAccessToken(), 'access-C2');
  assert.equal(await cold.getRefreshToken(), 'refresh-C2');
  assert.equal((await cold.unlockBiometricSession()).refreshToken, 'B3');
});

test('falha ao apagar B impede publicar sessão de outra conta', async () => {
  const disk = new Map();
  let failDelete = false;
  const storage = memoryStorage(disk, { deleteItemAsync: async (key, opts) => {
    if (failDelete && key === 'fuellog.biometric.refresh_token.v1') throw new Error('B removal failed');
    disk.delete(opts?.keychainService ? `${opts.keychainService}:${key}` : key);
  } });
  await storage.saveTokenPairAtomically('A', 'refresh-A');
  await storage.enableBiometricSession(rememberedCredential());
  storage.bumpSessionEpoch();
  failDelete = true;
  await assert.rejects(storage.saveTokenPairAtomically('other-A', 'other-refresh', 1, { clearBiometrics: true }), /B removal failed/);
  assert.equal(storage.getAccessToken(), null);
  assert.equal(await storage.getRefreshToken(), 'refresh-A');
  assert.equal(await storage.getBiometricSessionId(), '20000000-0000-4000-8000-000000000001');
  assert.equal(disk.has('fuellog_biometric_service:fuellog.biometric.aes_key.v1'), false, 'falha ao remover B ainda remove chave protegida');
});

test('resposta de B antigo não sobrescreve outro vínculo criado no mesmo epoch', async () => {
  const disk = new Map();
  const storage = memoryStorage(disk);
  await storage.saveTokenPairAtomically('A', 'refresh-A');
  await storage.enableBiometricSession(rememberedCredential('B1', 'B1-id'));
  await storage.unlockBiometricSession();
  await storage.enableBiometricSession(rememberedCredential('B-new', 'B-new-id'));
  await assert.rejects(storage.saveBiometricLoginAtomically(rememberedCredential('B1-rotated', 'B1-id'), { access_token: 'C', refresh_token: 'refresh-C' }, 0), /alterada/);
  assert.equal(await storage.getRefreshToken(), 'refresh-A');
  assert.equal((await storage.unlockBiometricSession()).refreshToken, 'B-new');
});

test('migração do envelope legado usa um único prompt e próximos boots restauram A sem biometria', async () => {
  const disk = new Map();
  const old = memoryStorage(disk);
  await old.saveTokenPairAtomically('old-access', 'old-refresh');
  await old.enableBiometricSession(rememberedCredential('legacy-refresh'));
  disk.set('fuellog.auth.refresh_token.v1', disk.get('fuellog.biometric.refresh_token.v1'));
  disk.delete('fuellog.biometric.refresh_token.v1');
  let prompts = 0;
  const cold = memoryStorage(disk, { getItemAsync: async (key, opts) => {
    if (opts?.requireAuthentication) prompts++;
    return disk.get(opts?.keychainService ? `${opts.keychainService}:${key}` : key) ?? null;
  } });
  assert.equal(await cold.getRefreshToken(), null);
  const unlock = await cold.unlockBiometricSession();
  assert.equal(unlock.legacy, true);
  assert.equal(unlock.refreshToken, 'legacy-refresh');
  await cold.saveTokenPairAtomically('access-A', 'refresh-A', 0);
  await cold.enableBiometricSession(rememberedCredential('separate-B'), 0);
  assert.equal(prompts, 1);
  const nextBoot = memoryStorage(disk, { getItemAsync: async (key, opts) => {
    assert.ok(!opts?.requireAuthentication);
    return disk.get(key) ?? null;
  } });
  assert.equal(await nextBoot.getRefreshToken(), 'refresh-A');
  assert.equal(await nextBoot.getBiometricSessionId(), '20000000-0000-4000-8000-000000000001');
});

test('desativar durante cifragem do opt-in no mesmo epoch impede ressuscitar B sem chave', async () => {
  const disk = new Map();
  let release;
  let ready;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { ready = resolve; });
  const storage = memoryStorage(disk, { expoCryptoExtra: { onBeforeEncrypt: async () => { ready(); await gate; } } });
  await storage.saveTokenPairAtomically('access-A', 'refresh-A');
  const enabling = storage.enableBiometricSession(rememberedCredential());
  await started;
  await storage.disableBiometricSession(0);
  release();
  assert.equal((await enabling).success, false);
  assert.equal(await storage.getBiometricSessionId(), null);
  assert.equal(storage.isBiometricSessionUnlocked(), false);
  assert.equal(await storage.getRefreshToken(), 'refresh-A');
});

test('logout enfileirado remove A mesmo se novo login avançar epoch antes da remoção', async () => {
  const disk = new Map();
  const storage = memoryStorage(disk);
  await storage.saveTokenPairAtomically('access-A', 'refresh-A');
  const clearing = storage.clearActiveSession();
  storage.bumpSessionEpoch();
  await clearing;
  assert.equal(await storage.getRefreshToken(), null);
});

test('C gravado durante mudança de epoch não permanece disponível após falha do login biométrico', async () => {
  const disk = new Map();
  let storage;
  let changeEpochOnActiveWrite = false;
  storage = loadStorage(async (key, value, opts) => {
    disk.set(opts?.keychainService ? `${opts.keychainService}:${key}` : key, value);
    if (changeEpochOnActiveWrite && key === 'fuellog.auth.refresh_token.v1') {
      changeEpochOnActiveWrite = false;
      storage.bumpSessionEpoch();
    }
  }, {
    getItemAsync: async (key, opts) => disk.get(opts?.keychainService ? `${opts.keychainService}:${key}` : key) ?? null,
    deleteItemAsync: async (key, opts) => disk.delete(opts?.keychainService ? `${opts.keychainService}:${key}` : key),
  });
  await storage.saveTokenPairAtomically('A', 'refresh-A');
  await storage.enableBiometricSession(rememberedCredential());
  await storage.clearActiveSession();
  await storage.unlockBiometricSession();
  changeEpochOnActiveWrite = true;
  await assert.rejects(storage.saveBiometricLoginAtomically(rememberedCredential('B2'), { access_token: 'C', refresh_token: 'refresh-C' }, 1));
  assert.equal(storage.getAccessToken(), null);
  assert.equal(await storage.getRefreshToken(), null);
});

test('erro tardio de decrypt não invalida vínculo novo criado no mesmo epoch', async () => {
  const disk = new Map();
  let release;
  let ready;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { ready = resolve; });
  const storage = memoryStorage(disk, { expoCryptoExtra: { onBeforeDecrypt: async () => {
    ready(); await gate; throw new Error('old credential decrypt failed');
  } } });
  await storage.saveTokenPairAtomically('A', 'refresh-A');
  await storage.enableBiometricSession(rememberedCredential('B1', 'B1-id'));
  const unlock = storage.unlockBiometricSession();
  await started;
  await storage.enableBiometricSession(rememberedCredential('B2', 'B2-id'));
  release();
  const result = await unlock;
  assert.equal(result.success, false);
  assert.equal(result.invalidated, false);
  assert.equal(await storage.getBiometricSessionId(), 'B2-id');
});

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
  const enableResult = await storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()));
  assert.equal(enableResult.success, true);
  assert.ok(storage.isBiometricSessionUnlocked(), 'Sessão deve estar desbloqueada após ativação');

  const rawBiometric = secureStore.get('fuellog.biometric.refresh_token.v1');
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
  assert.equal(envRotated.mode, 'plain');
  assert.equal(envRotated.refreshToken, 'refresh-token-secret-2');

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
  await storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()));

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
  assert.equal(await freshStorage.getRefreshToken(), 'refresh-original-value', 'Ativo restaura sem prompt');

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
  const enablingPromise = storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()));

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

test('atomicidade: falha ao remover B ainda limpa chave protegida e preserva sessão ativa', async () => {
  const secureStore = new Map();
  let failWrite = false;

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
        if (failWrite && k === 'fuellog.biometric.refresh_token.v1') throw new Error('Falha de I/O forcada');
        const storeKey = opts?.keychainService ? `${opts.keychainService}:${k}` : k;
        secureStore.delete(storeKey);
      },
    },
  );

  // 1. Inicializa com biometria
  await storage.saveTokenPairAtomically('access-active', 'refresh-vital-token');
  await storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()));
  assert.equal(storage.isBiometricSessionUnlocked(), true);

  // 2. Agora força falha em writeRawStorage durante disableBiometricSession
  failWrite = true;
  await assert.rejects(storage.disableBiometricSession(), /Falha de I\/O/);

  // Sem a chave, um envelope que não pôde ser removido deixa de conceder acesso.
  assert.equal(
    secureStore.has('fuellog_biometric_service:fuellog.biometric.aes_key.v1'), false,
    'Chave protegida deve ser apagada mesmo se a remoção do envelope falhar',
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
  await storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()));

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
  const sessionAEnablePromise = storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()));
  await startedEncryptPromise;

  // 3. Usuário faz logout (invalida imediatamente o epoch de A)
  await storage.clearStoredTokens();

  // 4. Nova Sessão B é estabelecida (login por senha) com novos tokens
  const epochB = storage.getSessionEpoch();
  await storage.saveTokenPairAtomically('access-B', 'refresh-B', epochB, { clearBiometrics: true });

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
  const result = await storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()));

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
  const bioA = await storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()));
  assert.equal(bioA.success, true);
  assert.ok(secureStore.has('fuellog_biometric_service:fuellog.biometric.aes_key.v1'));

  // Nova conta B faz login completo por senha (nova época)
  storage.bumpSessionEpoch();
  const epochB = storage.getSessionEpoch();
  await storage.saveTokenPairAtomically('access-B', 'refresh-B', epochB, { clearBiometrics: true });

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
  const enableAPromise = storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()));
  await startedEncryptAPromise;

  // 3. Usuário faz clearStoredTokens e bump de nova sessão
  await storage.clearStoredTokens();
  storage.bumpSessionEpoch();
  const epochB = storage.getSessionEpoch();

  // 4. Salvar B e concluir enable B com sucesso
  await storage.saveTokenPairAtomically('access-B', 'refresh-B', epochB, { clearBiometrics: true });
  const enableBResult = await storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()), epochB);
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

  const envRaw = secureStore.get('fuellog.biometric.refresh_token.v1');
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

  assert.equal(await coldStorage.getStoredSessionType(), 'plain');
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
  const enableAPromise = storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()));
  await deleteAStartedPromise;

  // 3. Disparar logout e login + enable de B concorrentemente
  const clearing = storage.clearStoredTokens();
  const bPromise = (async () => {
    await clearing;
    const epochB = storage.getSessionEpoch();
    await storage.saveTokenPairAtomically('access-B', 'refresh-B', epochB, { clearBiometrics: true });
    return await storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()), epochB);
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

  assert.equal(await coldStorage.getStoredSessionType(), 'plain');
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
  await storage.saveTokenPairAtomically('access-B', 'refresh-B', epochB, { clearBiometrics: true });
  const enableBResult = await storage.enableBiometricSession(rememberedCredential(await storage.getRefreshToken()), epochB);
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

  assert.equal(await coldStorage.getStoredSessionType(), 'plain');
  const unlockResult = await coldStorage.unlockBiometricSession();
  assert.equal(unlockResult.success, true);
  assert.equal(unlockResult.refreshToken, 'refresh-B');
});

test('desativacao concorrente com refresh preserva ultimo token ativo R2', async () => {
  const disk = new Map();
  let release;
  let started;
  let hold = false;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const storage = memoryStorage(disk, {
    deleteItemAsync: async (key, options) => {
      if (hold && key === 'fuellog.biometric.refresh_token.v1') {
        started();
        await gate;
      }
      disk.delete(options?.keychainService ? `${options.keychainService}:${key}` : key);
    },
  });
  await storage.saveTokenPairAtomically('access-1', 'refresh-1');
  await storage.enableBiometricSession(rememberedCredential());
  hold = true;
  const disabling = storage.disableBiometricSession();
  await ready;
  const rotating = storage.saveTokenPairAtomically('access-2', 'refresh-2', 0);
  release();
  await Promise.all([disabling, rotating]);
  assert.equal(await storage.getRefreshToken(), 'refresh-2');
  assert.equal(await storage.getStoredSessionType(), 'plain');
  assert.equal(await storage.getBiometricSessionId(), null);
});
