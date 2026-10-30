import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadTransport(options = {}) {
  let access = options.initialAccess ?? 'valid-access-token';
  let refresh = options.initialRefresh ?? 'valid-refresh-token';
  let epoch = 0;
  const storage = {
    getAccessToken: () => access,
    getRefreshToken: async () => refresh,
    getSessionEpoch: () => epoch,
    saveTokenPairAtomically: async (a, r) => { access = a; refresh = r; },
    clearStoredTokens: async () => { access = null; refresh = null; epoch += 1; },
  };
  const modules = { './tokenStorage': storage };
  for (const name of ['types', 'client', 'endpoints']) {
    const source = readFileSync(new URL(`../src/api/${name}.ts`, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', outputText)((specifier) => {
      assert.ok(Object.hasOwn(modules, specifier), `Import não autorizado no loader: ${specifier}`);
      return modules[specifier];
    }, module, module.exports);
    modules[`./${name}`] = module.exports;
  }
  return { storage, endpoints: modules['./endpoints'], client: modules['./client'] };
}

test('deleteFuelEntry sends DELETE with strong If-Match, no body, and accepts 204', async () => {
  const { endpoints } = loadTransport();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.ok(String(url).endsWith('/vehicles/car%2F1/fuel-entries/entry%2F1'));
    assert.equal(init.method, 'DELETE');
    assert.equal(init.headers['If-Match'], '"3"');
    assert.equal(init.body, undefined);
    return new Response(null, { status: 204 });
  };
  try { assert.equal(await endpoints.deleteFuelEntry('car/1', 'entry/1', 3), undefined); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(calls, 1);
});

test('deleteFuelEntry propagates conflicts and server failures without automatic mutation retries', async () => {
  for (const status of [412, 500]) {
    const { endpoints } = loadTransport();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ status, code: status === 412 ? 'PRECONDITION_FAILED' : 'INTERNAL_ERROR', detail: 'Falha de teste' }), { status });
    };
    try { await assert.rejects(endpoints.deleteFuelEntry('car', 'entry', 3), error => error.status === status); }
    finally { globalThis.fetch = originalFetch; }
    assert.equal(calls, 1);
  }
});
