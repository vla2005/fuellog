import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadClient() {
  let access = 'initial-access-token';
  let refresh = 'initial-refresh-token';
  let epoch = 0;
  const storage = {
    getAccessToken: () => access,
    getRefreshToken: async () => refresh,
    getSessionEpoch: () => epoch,
    saveTokenPairAtomically: async (a, r) => { access = a; refresh = r; },
    clearStoredTokens: async () => { access = null; refresh = null; epoch += 1; },
    bumpSessionEpoch: () => { epoch += 1; return epoch; },
  };
  const modules = { './tokenStorage': storage };
  for (const name of ['types', 'client']) {
    const source = readFileSync(new URL(`../src/api/${name}.ts`, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', outputText)(specifier => {
      assert.ok(Object.hasOwn(modules, specifier), `Import não autorizado: ${specifier}`);
      return modules[specifier];
    }, module, module.exports);
    modules[`./${name}`] = module.exports;
  }
  return { storage, client: modules['./client'] };
}

test('apiRequest inclui headers customizados como If-Match', async () => {
  const { client } = loadClient();
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const res = await client.apiRequest({
      method: 'PUT',
      path: '/vehicles/test-id',
      body: { model: 'Civic' },
      headers: { 'If-Match': '"42"' },
      authenticated: true,
    });

    assert.equal(calls.length, 1);
    const headers = calls[0].init.headers;
    assert.equal(headers['If-Match'], '"42"');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers.Authorization, 'Bearer initial-access-token');
    assert.deepEqual(res, { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extraHeaders não podem sobrescrever Authorization (inclusive case-insensitive)', async () => {
  const { client } = loadClient();
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    for (const badAuthKey of ['Authorization', 'authorization', 'AUTHORIZATION']) {
      calls.length = 0;
      await client.apiRequest({
        method: 'PUT',
        path: '/vehicles/test-id',
        body: { model: 'Civic' },
        headers: {
          [badAuthKey]: 'Bearer hijacked-token',
          'If-Match': '"1"',
        },
        authenticated: true,
      });

      assert.equal(calls.length, 1);
      const headers = calls[0].init.headers;
      assert.equal(headers.Authorization, 'Bearer initial-access-token');
      assert.equal(headers['If-Match'], '"1"');
      assert.equal(headers[badAuthKey.toLowerCase()], undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('If-Match e custom headers são mantidos após retry de 401 com refresh de token', async () => {
  const { client, storage } = loadClient();
  const originalFetch = globalThis.fetch;
  const calls = [];
  let refreshCalled = false;

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/auth/refresh')) {
      refreshCalled = true;
      return new Response(
        JSON.stringify({
          access_token: 'new-refreshed-access-token',
          refresh_token: 'new-refreshed-refresh-token',
          token_type: 'Bearer',
          expires_in: 900,
          access_expires_at: '2026-10-27T13:00:00Z',
          refresh_expires_at: '2026-11-27T13:00:00Z',
          session_id: 'session-123',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (calls.length === 1) {
      // First attempt fails with 401
      return new Response(JSON.stringify({ title: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }

    // Second attempt (retry) succeeds with 200
    return new Response(JSON.stringify({ id: 'vehicle-1', version: 2 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const res = await client.apiRequest({
      method: 'PUT',
      path: '/vehicles/vehicle-1',
      body: { model: 'Civic Novo' },
      headers: { 'If-Match': '"1"' },
      authenticated: true,
      retryOn401: true,
    });

    assert.equal(refreshCalled, true);
    // 3 calls: 1st PUT (401), POST refresh (200), 2nd PUT (200)
    assert.equal(calls.length, 3);

    const firstPutHeaders = calls[0].init.headers;
    assert.equal(firstPutHeaders['If-Match'], '"1"');
    assert.equal(firstPutHeaders.Authorization, 'Bearer initial-access-token');
    assert.equal(calls[0].init.body, JSON.stringify({ model: 'Civic Novo' }));

    const secondPutHeaders = calls[2].init.headers;
    assert.equal(secondPutHeaders['If-Match'], '"1"');
    assert.equal(secondPutHeaders.Authorization, 'Bearer new-refreshed-access-token');
    assert.equal(calls[2].init.body, JSON.stringify({ model: 'Civic Novo' }));

    assert.deepEqual(res, { id: 'vehicle-1', version: 2 });
    assert.equal(storage.getAccessToken(), 'new-refreshed-access-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
