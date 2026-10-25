import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

process.env.EXPO_PUBLIC_API_URL = process.env.FUELLOG_API_URL ?? 'http://127.0.0.1:8080/api/v1';
const base = process.env.EXPO_PUBLIC_API_URL;
const credentials = () => ({ name: 'Transporte E2E', email: `transport-${randomUUID()}@example.test`, password: 'FuelLog-test-2026!' });

function loadTransport() {
  let access = null;
  let refresh = null;
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
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', outputText)(specifier => {
      assert.ok(Object.hasOwn(modules, specifier), `Import não autorizado no loader: ${specifier}`);
      return modules[specifier];
    }, module, module.exports);
    modules[`./${name}`] = module.exports;
  }
  return { storage, endpoints: modules['./endpoints'], client: modules['./client'] };
}

async function realSession() {
  const account = credentials();
  const registered = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(account) });
  assert.equal(registered.status, 201);
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(account) });
  assert.equal(response.status, 200);
  return { account, tokens: await response.json() };
}

test('cliente cadastra name, salva tokens snake_case e consulta /me real', async () => {
  const { endpoints, storage } = loadTransport();
  const account = credentials();
  const registered = await endpoints.registerUser(account);
  assert.equal(registered.name, account.name);
  const tokens = await endpoints.loginUser({ email: account.email, password: account.password });
  assert.equal(typeof tokens.access_token, 'string');
  assert.equal(typeof tokens.refresh_token, 'string');
  assert.ok(storage.getAccessToken() === tokens.access_token, 'Access token real deve ser salvo');
  assert.ok(await storage.getRefreshToken() === tokens.refresh_token, 'Refresh token real deve ser salvo');
  const me = await endpoints.getMe();
  assert.equal(me.email, account.email);
  assert.equal(me.name, account.name);
});

test('duas consultas com access inválido compartilham refresh real rotativo', async () => {
  const { account, tokens } = await realSession();
  const { endpoints, storage } = loadTransport();
  await storage.saveTokenPairAtomically('invalid-access-for-test', tokens.refresh_token);
  const users = await Promise.all([endpoints.getMe(), endpoints.getMe()]);
  assert.ok(users.every(user => user.email === account.email));
  const rotated = await storage.getRefreshToken();
  assert.ok(typeof rotated === 'string' && rotated !== tokens.refresh_token, 'Refresh deve rotacionar');
  assert.ok(storage.getAccessToken() !== 'invalid-access-for-test', 'Access deve ser substituído');
});

test('logout envia Bearer real e revoga sessão no servidor', async () => {
  const { tokens } = await realSession();
  const { endpoints, storage } = loadTransport();
  await storage.saveTokenPairAtomically(tokens.access_token, tokens.refresh_token);
  await endpoints.logoutSession();
  const me = await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  assert.equal(me.status, 401);
  const refresh = await fetch(`${base}/auth/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });
  assert.equal(refresh.status, 401);
});

test('resposta de refresh anterior ao logout não entrega dados da sessão encerrada', async () => {
  const { tokens } = await realSession();
  const { endpoints, storage } = loadTransport();
  await storage.saveTokenPairAtomically('invalid-access-for-test', tokens.refresh_token);
  const realFetch = globalThis.fetch;
  let release;
  let signalResponse;
  const gate = new Promise(resolve => { release = resolve; });
  const responseReady = new Promise(resolve => { signalResponse = resolve; });
  globalThis.fetch = async (...args) => {
    const response = await realFetch(...args);
    if (String(args[0]) === `${base}/auth/refresh`) {
      signalResponse(response.status);
      await gate;
    }
    return response;
  };
  const pending = endpoints.getMe().then(value => ({ value }), error => ({ error }));
  try {
    assert.equal(await responseReady, 200, 'Gate deve segurar refresh real bem-sucedido');
    await storage.clearStoredTokens();
    release();
    const result = await pending;
    assert.ok(result.error, 'Consulta iniciada antes do logout deve rejeitar, sem devolver dados protegidos');
    assert.equal(storage.getAccessToken(), null);
    assert.equal(await storage.getRefreshToken(), null);
  } finally {
    release();
    await pending;
    globalThis.fetch = realFetch;
  }
});

for (const switchAccount of [false, true]) {
  test(`login A atrasado não restaura A depois de ${switchAccount ? 'troca para B' : 'logout'}`, async () => {
    const a = await realSession();
    const b = switchAccount ? await realSession() : null;
    const { endpoints, storage } = loadTransport();
    const realFetch = globalThis.fetch;
    let release;
    let ready;
    const gate = new Promise(resolve => { release = resolve; });
    const responseReady = new Promise(resolve => { ready = resolve; });
    globalThis.fetch = async (...args) => {
      const response = await realFetch(...args);
      if (String(args[0]) === `${base}/auth/login`) {
        ready(response.status);
        await gate;
      }
      return response;
    };
    const pending = endpoints.loginUser(a.account).then(value => ({ value }), error => ({ error }));
    try {
      assert.equal(await responseReady, 200);
      await storage.clearStoredTokens();
      if (b) await storage.saveTokenPairAtomically(b.tokens.access_token, b.tokens.refresh_token);
      release();
      const result = await pending;
      assert.ok(storage.getAccessToken() === (b?.tokens.access_token ?? null), 'Resposta antiga não substitui access atual');
      assert.ok(await storage.getRefreshToken() === (b?.tokens.refresh_token ?? null), 'Resposta antiga não substitui refresh atual');
      assert.ok(result.error, 'Login antigo deve rejeitar após mudança de sessão');
    } finally {
      release();
      await pending;
      globalThis.fetch = realFetch;
    }
  });
}

test('401 atrasado do retry A não limpa sessão B nem notifica logout', async () => {
  const a = await realSession();
  const b = await realSession();
  const { endpoints, storage, client } = loadTransport();
  await storage.saveTokenPairAtomically('invalid-access-for-test', a.tokens.refresh_token);
  let notifications = 0;
  client.setOnUnauthorizedListener(() => { notifications += 1; });
  const realFetch = globalThis.fetch;
  let release;
  let ready;
  let meAttempts = 0;
  let rotatedAccess;
  const gate = new Promise(resolve => { release = resolve; });
  const retryReady = new Promise(resolve => { ready = resolve; });
  globalThis.fetch = async (...args) => {
    const url = String(args[0]);
    if (url === `${base}/me` && ++meAttempts === 2) {
      const logout = await realFetch(`${base}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${rotatedAccess}` } });
      assert.equal(logout.status, 204);
      const response = await realFetch(...args);
      ready(response.status);
      await gate;
      return response;
    }
    const response = await realFetch(...args);
    if (url === `${base}/auth/refresh`) rotatedAccess = (await response.clone().json()).access_token;
    return response;
  };
  const pending = endpoints.getMe().then(value => ({ value }), error => ({ error }));
  try {
    assert.equal(await retryReady, 401);
    await storage.clearStoredTokens();
    await storage.saveTokenPairAtomically(b.tokens.access_token, b.tokens.refresh_token);
    release();
    const result = await pending;
    assert.ok(result.error);
    assert.ok(storage.getAccessToken() === b.tokens.access_token, '401 antigo não limpa access B');
    assert.ok(await storage.getRefreshToken() === b.tokens.refresh_token, '401 antigo não limpa refresh B');
    assert.equal(notifications, 0);
  } finally {
    release();
    await pending;
    globalThis.fetch = realFetch;
  }
});
