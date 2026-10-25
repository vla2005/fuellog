import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadStorage(setItemAsync, { platform = 'android', deleteItemAsync = async () => {} } = {}) {
  const source = readFileSync(new URL('../src/api/tokenStorage.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const dependencies = {
    'expo-secure-store': {
      setItemAsync, getItemAsync: async () => null, deleteItemAsync,
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
    },
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
  const persisted = new Promise(resolve => { release = resolve; });
  const storage = loadStorage(async () => persisted);
  storage.setAccessToken('previous-access');
  const saving = storage.saveTokenPairAtomically('new-access', 'new-refresh');
  try {
    assert.ok(storage.getAccessToken() === 'previous-access', 'Não publicar access antes de persistir refresh');
  } finally {
    release();
    await saving;
  }
  assert.ok(storage.getAccessToken() === 'new-access');
});

test('falha do SecureStore é explícita e preserva access anterior', async () => {
  const storage = loadStorage(async () => { throw new Error('SecureStore indisponível no teste'); });
  storage.setAccessToken('previous-access');
  await assert.rejects(storage.saveTokenPairAtomically('new-access', 'new-refresh'));
  assert.ok(storage.getAccessToken() === 'previous-access', 'Falha de persistência não publica novo access');
});

for (const platform of ['android', 'web']) {
  test(`remoção falha no ${platform}: memória limpa, epoch avança e erro explícito`, async () => {
    const originalWindow = globalThis.window;
    const failure = new Error('Storage access denied');
    if (platform === 'web') {
      globalThis.window = { sessionStorage: { removeItem: () => { throw failure; } } };
    }
    const storage = loadStorage(async () => {}, { platform, deleteItemAsync: async () => { throw failure; } });
    storage.setAccessToken('previous-access');
    const previousEpoch = storage.getSessionEpoch();
    try {
      const result = await storage.clearStoredTokens().then(() => ({ error: null }), error => ({ error }));
      assert.equal(storage.getAccessToken(), null);
      assert.ok(storage.getSessionEpoch() > previousEpoch);
      assert.ok(result.error, 'Falha ao apagar refresh deve ser informada');
    } finally {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    }
  });
}
