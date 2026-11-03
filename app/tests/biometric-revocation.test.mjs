import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { loadStorage, extractCallbackFromSessionContext } from './helpers/session-fixtures.mjs';

process.env.EXPO_PUBLIC_API_URL = 'http://fuellog.test/api/v1';
const ownerId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';

function fixture(disk = new Map()) {
  const faults = { failPendingWrite: false };
  const key = (name, options) => options?.keychainService ? `${options.keychainService}:${name}` : name;
  const storage = loadStorage(async (name, value, options) => {
    if (faults.failPendingWrite && name === 'fuellog.biometric.pending_revocations.v1') throw new Error('Pending write failed');
    disk.set(key(name, options), value);
  }, {
    getItemAsync: async (name, options) => disk.get(key(name, options)) ?? null,
    deleteItemAsync: async (name, options) => disk.delete(key(name, options)),
  });
  const modules = { './tokenStorage': storage };
  for (const name of ['types', 'client', 'endpoints']) {
    const source = readFileSync(new URL(`../src/api/${name}.ts`, import.meta.url), 'utf8');
    const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputText)(specifier => modules[specifier], module, module.exports);
    modules[`./${name}`] = module.exports;
  }
  const endpoints = modules['./endpoints'];
  const state = { status: 'unauthenticated', biometric: false, locked: false, toasts: [] };
  const scope = {
    ...storage, ...endpoints, ...modules['./types'],
    isBiometricActive: false, hasBiometricLock: false,
    activeChallengeRef: { current: null }, biometricSuggestionBusyRef: { current: false },
    biometricUnlockBusyRef: { current: false }, biometricDeviceInfo: { isSupported: true },
    getBiometricDeviceInfo: async () => ({ isSupported: true }), setBiometricDeviceInfo: () => {},
    setStatus: value => { state.status = value; }, setIsBiometricActive: value => { state.biometric = value; },
    setHasBiometricLock: value => { state.locked = value; }, setUser: () => {}, setPrefilledLoginEmail: () => {},
    setBootError: () => {}, setBiometricSuggestionOpen: () => {}, setBiometricSuggestionBusy: () => {},
    clearInMemoryUserData: () => {}, loadUserWorkspace: async () => {}, showToast: toast => { state.toasts.push(toast); },
  };
  scope.enableBiometricsOnCurrentSession = extractCallbackFromSessionContext('enableBiometricsOnCurrentSession')(scope);
  const callbacks = Object.fromEntries(['signIn', 'signOut', 'bootstrapSession', 'disableBiometricsOnCurrentSession'].map(name => [name, extractCallbackFromSessionContext(name)(scope)]));
  return { storage, endpoints, state, callbacks, enable: scope.enableBiometricsOnCurrentSession, disk, faults };
}

function server() {
  let serial = 0;
  const active = new Map();
  const biometric = new Map();
  const calls = [];
  let failDelete = false;
  return {
    biometric, calls,
    set failDelete(value) { failDelete = value; },
    fetch: async (url, init) => {
      const path = new URL(url).pathname.replace('/api/v1', '');
      const body = init.body ? JSON.parse(init.body) : {};
      calls.push(`${init.method} ${path}`);
      const account = active.get(init.headers.Authorization?.replace('Bearer ', ''));
      if (path === '/auth/login') {
        const owner = body.email === 'other@example.test' ? otherId : ownerId;
        const number = ++serial;
        const tokens = { access_token: `access-A${number}`, refresh_token: `refresh-A${number}`, token_type: 'Bearer',
          expires_in: 900, access_expires_at: '2099-01-01T00:00:00Z', refresh_expires_at: '2099-02-01T00:00:00Z',
          session_id: `10000000-0000-4000-8000-${String(number).padStart(12, '0')}` };
        active.set(tokens.access_token, { owner, tokens });
        return Response.json(tokens);
      }
      if (path === '/auth/biometric-login') {
        const grant = [...biometric.values()].find(item => item.refresh_token === body.refresh_token);
        return Response.json({ detail: 'revoked' }, { status: grant?.alive ? 500 : 401 });
      }
      if (path === '/auth/refresh') {
        const previous = [...active.values()].find(item => item.tokens.refresh_token === body.refresh_token);
        assert.ok(previous, 'refresh ativo conhecido');
        const tokens = { ...previous.tokens, access_token: `${previous.tokens.access_token}-rotated`, refresh_token: `${previous.tokens.refresh_token}-rotated` };
        active.set(tokens.access_token, { owner: previous.owner, tokens });
        return Response.json(tokens);
      }
      if (!account) return Response.json({ detail: 'no access' }, { status: 401 });
      if (path === '/me') return Response.json({ id: account.owner, name: 'Driver', email: 'driver@example.test', preferredTimezone: 'America/Sao_Paulo' });
      if (path === '/auth/logout') {
        active.delete(account.tokens.access_token);
        return new Response(null, { status: 204 });
      }
      if (path === '/me/biometric-session' && init.method === 'POST') {
        assert.equal(body.refresh_token, account.tokens.refresh_token);
        const number = ++serial;
        const grant = { session_id: `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
          refresh_token: `remembered-B${number}`, refresh_expires_at: '2099-03-01T00:00:00Z' };
        biometric.set(grant.session_id, { ...grant, alive: true, owner: account.owner });
        return Response.json(grant, { status: 201 });
      }
      if (path.startsWith('/me/biometric-session/') && init.method === 'DELETE') {
        const grant = biometric.get(path.split('/').at(-1));
        if (grant?.owner !== account.owner) return Response.json({ detail: 'not found' }, { status: 404 });
        if (failDelete) throw new Error('DELETE offline');
        grant.alive = false;
        return new Response(null, { status: 204 });
      }
      assert.fail(`unexpected route ${path}`);
    },
  };
}

async function seed(app) {
  await app.callbacks.signIn({ email: 'owner@example.test', password: 'password' }, { enableBiometrics: false });
  assert.equal((await app.enable()).success, true);
  return app.storage.getBiometricSessionId();
}

test('senha + reenroll + desativação revoga B1 e B2 no servidor usando storage e callbacks reais', async () => {
  const realFetch = globalThis.fetch;
  const backend = server();
  globalThis.fetch = backend.fetch;
  try {
    const app = fixture();
    const first = await seed(app);
    const firstToken = backend.biometric.get(first).refresh_token;
    await app.callbacks.signOut();
    await app.callbacks.signIn({ email: 'owner@example.test', password: 'password' }, { enableBiometrics: true });
    const second = await app.storage.getBiometricSessionId();
    assert.notEqual(second, first);
    await app.callbacks.disableBiometricsOnCurrentSession();
    assert.equal(backend.biometric.get(first).alive, false);
    assert.equal(backend.biometric.get(second).alive, false);
    await assert.rejects(app.endpoints.loginWithBiometrics(firstToken), error => error.status === 401);
    assert.equal(app.state.biometric, false);
  } finally { globalThis.fetch = realFetch; }
});

test('DELETE offline mantém UUID após senha e reload; bloqueia reenroll até retry confirmar revogação', async () => {
  const realFetch = globalThis.fetch;
  const backend = server();
  globalThis.fetch = backend.fetch;
  try {
    const app = fixture();
    const first = await seed(app);
    backend.failDelete = true;
    await app.callbacks.signIn({ email: 'owner@example.test', password: 'password' }, { enableBiometrics: false });
    assert.equal(app.state.status, 'authenticated');
    assert.equal(app.state.toasts.at(-1).title, 'Revogação biométrica pendente');
    assert.equal(await app.storage.getBiometricSessionId(), null);
    const cold = fixture(app.disk);
    assert.deepEqual(await cold.storage.getPendingBiometricSessionIds(), [first]);
    await cold.callbacks.bootstrapSession();
    assert.equal(cold.state.status, 'authenticated');
    assert.equal(cold.state.toasts.at(-1).title, 'Revogação biométrica pendente');
    const creates = backend.calls.filter(call => call === 'POST /me/biometric-session').length;
    await assert.rejects(cold.endpoints.createBiometricSession());
    assert.equal(backend.calls.filter(call => call === 'POST /me/biometric-session').length, creates);
    assert.deepEqual(await cold.storage.getPendingBiometricSessionIds(), [first]);
    backend.failDelete = false;
    await cold.endpoints.createBiometricSession();
    assert.equal(backend.biometric.get(first).alive, false);
    assert.deepEqual(await cold.storage.getPendingBiometricSessionIds(), []);
  } finally { globalThis.fetch = realFetch; }
});

test('limite de 32 UUIDs bloqueia novo vínculo sem descartar pendências', async () => {
  const realFetch = globalThis.fetch;
  const backend = server();
  globalThis.fetch = backend.fetch;
  try {
    const app = fixture();
    await app.callbacks.signIn({ email: 'owner@example.test', password: 'password' }, { enableBiometrics: false });
    const ids = Array.from({ length: 32 }, (_, i) => `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    for (const id of ids) await app.storage.queueBiometricSessionRevocation(id, app.storage.getSessionEpoch());
    await app.storage.queueBiometricSessionRevocation(ids[0], app.storage.getSessionEpoch());
    await assert.rejects(app.endpoints.createBiometricSession(), /32 revogações/);
    await assert.rejects(app.storage.queueBiometricSessionRevocation('30000000-0000-4000-8000-000000000099', app.storage.getSessionEpoch()), /32 revogações/);
    assert.deepEqual(await app.storage.getPendingBiometricSessionIds(), ids);
    assert.equal(backend.calls.filter(call => call === 'POST /me/biometric-session').length, 0);
    await app.storage.completeBiometricSessionRevocation(ids[1], app.storage.getSessionEpoch());
    assert.deepEqual(await app.storage.getPendingBiometricSessionIds(), ids.filter(id => id !== ids[1]));
    await app.storage.clearStoredTokens();
    assert.deepEqual(await app.storage.getPendingBiometricSessionIds(), ids.filter(id => id !== ids[1]));
  } finally { globalThis.fetch = realFetch; }
});

test('falha ao gravar UUID pendente impede apagar B1 e publicar sessão de senha nova', async () => {
  const realFetch = globalThis.fetch;
  const backend = server();
  globalThis.fetch = backend.fetch;
  try {
    const app = fixture();
    const first = await seed(app);
    app.faults.failPendingWrite = true;
    await assert.rejects(app.callbacks.signIn({ email: 'owner@example.test', password: 'password' }, { enableBiometrics: false }), /Pending write failed/);
    assert.equal(await app.storage.getBiometricSessionId(), first);
    assert.equal(app.storage.getAccessToken(), null);
    assert.equal(backend.biometric.get(first).alive, true);
    app.faults.failPendingWrite = false;
    await app.callbacks.signIn({ email: 'owner@example.test', password: 'password' }, { enableBiometrics: false });
    assert.equal(backend.biometric.get(first).alive, false);
    assert.deepEqual(await app.storage.getPendingBiometricSessionIds(), []);
  } finally { globalThis.fetch = realFetch; }
});

test('mudança de epoch no DELETE preserva pendências e impede chamadas seguintes da conta antiga', async () => {
  const realFetch = globalThis.fetch;
  const backend = server();
  globalThis.fetch = backend.fetch;
  try {
    const app = fixture();
    const first = await seed(app);
    const second = '20000000-0000-4000-8000-000000000099';
    await app.storage.queueBiometricSessionRevocation(first, app.storage.getSessionEpoch());
    await app.storage.queueBiometricSessionRevocation(second, app.storage.getSessionEpoch());
    let requests = 0;
    globalThis.fetch = async (url, init) => {
      requests++;
      const response = await backend.fetch(url, init);
      app.storage.bumpSessionEpoch();
      return response;
    };
    await assert.rejects(app.endpoints.revokePendingBiometricSessions());
    assert.equal(requests, 1);
    assert.deepEqual(await app.storage.getPendingBiometricSessionIds(), [first, second]);
  } finally { globalThis.fetch = realFetch; }
});

test('outra conta mantém UUID estrangeiro em 404 e não bloqueia login nem novo vínculo', async () => {
  const realFetch = globalThis.fetch;
  const backend = server();
  globalThis.fetch = backend.fetch;
  try {
    const app = fixture();
    const first = await seed(app);
    await app.callbacks.signIn({ email: 'other@example.test', password: 'password' }, { enableBiometrics: true });
    assert.equal(app.state.status, 'authenticated');
    assert.equal(backend.biometric.get(first).alive, true);
    assert.deepEqual(await app.storage.getPendingBiometricSessionIds(), [first]);
    const second = await app.storage.getBiometricSessionId();
    assert.notEqual(second, first);
    await app.callbacks.signIn({ email: 'owner@example.test', password: 'password' }, { enableBiometrics: false });
    assert.equal(backend.biometric.get(first).alive, false);
    assert.equal(backend.biometric.get(second).alive, true);
    assert.deepEqual(await app.storage.getPendingBiometricSessionIds(), [second]);
  } finally { globalThis.fetch = realFetch; }
});

test('desativação com DELETE offline conserva vínculo e pendência até retry confirmado', async () => {
  const realFetch = globalThis.fetch;
  const backend = server();
  globalThis.fetch = backend.fetch;
  try {
    const app = fixture();
    const first = await seed(app);
    backend.failDelete = true;
    await assert.rejects(app.callbacks.disableBiometricsOnCurrentSession());
    assert.equal(app.state.biometric, true);
    assert.deepEqual(await app.storage.getPendingBiometricSessionIds(), [first]);
    assert.equal(backend.biometric.get(first).alive, true);
    backend.failDelete = false;
    await app.callbacks.disableBiometricsOnCurrentSession();
    assert.equal(backend.biometric.get(first).alive, false);
    assert.equal(app.state.biometric, false);
    assert.ok(app.storage.getAccessToken());
    assert.deepEqual(await app.storage.getPendingBiometricSessionIds(), []);
  } finally { globalThis.fetch = realFetch; }
});
