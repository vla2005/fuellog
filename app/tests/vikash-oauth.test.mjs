import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Match the existing screen harnesses: execute real hooks, handlers and JSX,
// replacing native UI, browser and HTTP boundaries only.
function load(relativePath, dependencies) {
  const output = ts.transpileModule(readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8'), {
    fileName: relativePath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unmapped dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function mount({ platform = 'android', hookOnly = false, active = true, user = { id: 'user' }, status = 'DISCONNECTED' } = {}) {
  let index = 0, dirty = false, effects = [], mounted = true;
  const hooks = [], listeners = new Set(), calls = [], browserCalls = [], toasts = [], lateWrites = [];
  const authorization = { authorizationUrl: 'https://vikash.example.test/oauth2/authorize?state=fixture',
    returnUrl: platform === 'web' ? 'https://fuellog.example.test/vikash-return' : 'fuellog://vikash-return' };
  const state = { epoch: 0, user, active, status, request: null, browser: null };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const i = index++;
      hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[i].value, value => {
        if (!mounted) lateWrites.push(value);
        const next = typeof value === 'function' ? value(hooks[i].value) : value;
        if (!Object.is(next, hooks[i].value)) { hooks[i].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useMemo(factory, deps) {
      const i = index++;
      if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { value: factory(), deps };
      return hooks[i].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const i = index++;
      if (!hooks[i] || !same(hooks[i].deps, deps)) effects.push(() => {
        hooks[i]?.cleanup?.(); hooks[i] = { deps, cleanup: effect() };
      });
    },
  };
  react.default = react;
  class ApiError extends Error {}
  const getCurrentSessionEpoch = () => state.epoch;
  const dependencies = {
    react,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Text: 'Text', View: 'View',
      StyleSheet: { create: styles => styles }, Platform: { OS: platform },
      AppState: { currentState: 'active', addEventListener(event, listener) {
        assert.equal(event, 'change'); listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      } } },
    'expo-web-browser': { maybeCompleteAuthSession() {}, openAuthSessionAsync: async (...args) => {
      browserCalls.push(args); return state.browser ? state.browser(...args) : { type: 'dismiss' };
    } },
    '@/api/types': { ApiError },
    '@/state/SessionContext': { useSession: () => ({ user: state.user, getCurrentSessionEpoch, showToast: toast => toasts.push(toast) }) },
    '@/theme/ThemeProvider': { useAppTheme: () => ({ colors: {} }) },
    '@/theme/tokens': { typography: {} },
    './viKashTheme': { viKashColors: {}, viKashStyles: {} },
    './viKashChoices': { choicesError: () => null },
    './ViKashBrand': { ViKashBrand: 'ViKashBrand', ViKashState: 'ViKashState', viKashConnectionLabel: status => status?.status },
  };
  for (const [path, name] of [
    ['@/components/feedback/InlineNotice', 'InlineNotice'], ['@/components/overlays/AppSheet', 'AppSheet'],
    ['@/components/ui/PrimaryButton', 'PrimaryButton'], ['./ViKashFields', 'ViKashFields'],
    ['./ViKashDeletions', 'ViKashDeletions'], ['./ViKashDestination', 'ViKashDestination'], ['./ViKashSwitch', 'ViKashSwitch'],
  ]) dependencies[path] = { [name]: name };
  const endpoints = load('api/endpoints.ts', {
    './types': { ApiError }, './tokenStorage': { getSessionEpoch: getCurrentSessionEpoch, saveTokenPairAtomically: async () => {} },
    './client': { apiRequest: async request => {
      calls.push({ ...request, epoch: state.epoch });
      if (state.request) return state.request(request);
      if (request.path.endsWith('/authorizations')) {
        state.status = request.method === 'POST' ? 'CONNECTING' : 'DISCONNECTED';
        return request.method === 'POST' ? authorization : undefined;
      }
      if (request.path.endsWith('/catalog')) return { apiVersion: '1', currency: 'BRL', categories: [], accounts: [], cards: [],
        paymentMethods: ['PIX'], installments: { min: 1, max: 120, creditOnly: true } };
      return { status: state.status, configured: true, connectionId: state.status === 'CONNECTED' ? 'connection' : null,
        preferences: state.status === 'CONNECTED' ? { automaticSend: false, choices: null } : null };
    } },
  });
  dependencies['@/api/endpoints'] = endpoints;
  const { useViKash } = load('features/vikash/useViKash.ts', dependencies);
  dependencies['./useViKash'] = { useViKash };
  const { ViKashSettings } = load('features/vikash/ViKashSettings.tsx', dependencies);
  const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(child => nodes(child, predicate))
    : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
  const h = { state, calls, browserCalls, toasts, lateWrites, listeners, snapshot: null,
    render() {
      index = 0; dirty = false; effects = [];
      h.snapshot = hookOnly ? useViKash(state.active) : ViKashSettings();
      effects.forEach(effect => effect());
    },
    async settle() {
      for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); if (mounted && dirty) h.render(); }
    },
    buttons(label) { return nodes(h.snapshot, node => node.type === 'PrimaryButton' && (!label || node.props.label === label)); },
    press(label) {
      const [button] = h.buttons(label); assert.ok(button, `Missing button: ${label}`);
      assert.ok(!button.props.disabled && !button.props.loading, `Disabled button: ${label}`);
      button.props.onPress();
    },
    notices() { return nodes(h.snapshot, node => node.type === 'InlineNotice').map(node => node.props.message); },
    connected() { return nodes(h.snapshot, node => node.type === 'ViKashState').some(node => node.props.connected); },
    async appState(next) {
      dependencies['react-native'].AppState.currentState = next;
      listeners.forEach(listener => listener(next)); await h.settle();
    },
    unmount() { mounted = false; hooks.forEach(hook => hook?.cleanup?.()); },
    count(method, path = '/integrations/vikash') { return calls.filter(call => call.method === method && call.path === path).length; },
  };
  h.render();
  return h;
}

async function prepare(options) {
  const h = mount(options); await h.settle(); h.press('Conectar ao ViKash'); await h.settle(); return h;
}

for (const result of ['early', 'cancel', 'dismiss', 'success', 'error']) {
  test(`browser ${result} preserves pending authorization without DELETE and reconciles backend status`, async () => {
    const h = await prepare();
    const before = h.count('GET');
    h.state.browser = async () => {
      if (result === 'error') throw Error('Browser unavailable');
      return { type: result === 'early' ? 'dismiss' : result, url: 'fuellog://vikash-return' };
    };
    h.press('Continuar ao ViKash'); await h.settle();
    assert.equal(h.count('DELETE', '/integrations/vikash/authorizations'), 0);
    assert.ok(h.count('GET') > before);
    assert.equal(h.connected(), false, 'Only backend CONNECTED authorizes the connected UI');
    assert.equal(h.buttons('Continuar ao ViKash').length, 1);
    if (result === 'error') assert.equal(h.notices().length, 1);
    h.press('Continuar ao ViKash'); await h.settle();
    assert.equal(h.count('POST', '/integrations/vikash/authorizations'), 1, 'Continue reuses the existing attempt');
    assert.equal(h.browserCalls.length, 2);
    h.unmount();
  });
}

test('explicit cancel alone sends DELETE and permits another authorization', async () => {
  const h = await prepare();
  h.press('Cancelar conexão'); await h.settle();
  assert.equal(h.count('DELETE', '/integrations/vikash/authorizations'), 1);
  assert.equal(h.buttons('Continuar ao ViKash').length, 0);
  h.press('Conectar ao ViKash'); await h.settle();
  assert.equal(h.count('POST', '/integrations/vikash/authorizations'), 2);
  h.unmount();
});

test('foreground and browser return both reconcile the real backend connection', async () => {
  const h = await prepare(); const browser = deferred(); h.state.browser = () => browser.promise;
  const before = h.count('GET'); h.press('Continuar ao ViKash'); await h.settle();
  assert.equal(h.listeners.size, 1);
  await h.appState('background'); h.state.status = 'CONNECTED'; await h.appState('active');
  assert.equal(h.count('GET'), before + 1); assert.equal(h.connected(), true);
  const foregroundCount = h.count('GET'); await h.appState('active'); assert.equal(h.count('GET'), foregroundCount);
  browser.resolve({ type: 'success', url: 'fuellog://vikash-return' }); await h.settle();
  assert.equal(h.count('GET'), foregroundCount + 1); assert.equal(h.connected(), true);
  assert.equal(h.buttons('Continuar ao ViKash').length, 0);
  h.unmount(); assert.equal(h.listeners.size, 0);
});

test('a late callback is recovered by foreground after an early browser return', async () => {
  const h = await prepare(); h.press('Continuar ao ViKash'); await h.settle();
  assert.equal(h.connected(), false);
  await h.appState('background'); h.state.status = 'CONNECTED'; await h.appState('active');
  assert.equal(h.connected(), true);
  assert.equal(h.count('DELETE', '/integrations/vikash/authorizations'), 0);
  h.unmount();
});

test('failed status refresh preserves continuation and explicit cancellation', async () => {
  const h = await prepare();
  h.state.request = async () => { throw Error('Offline'); };
  h.press('Continuar ao ViKash'); await h.settle();
  assert.equal(h.connected(), false); assert.equal(h.buttons('Continuar ao ViKash').length, 1);
  assert.equal(h.buttons('Cancelar conexão').length, 1); assert.equal(h.notices().length, 1);
  assert.equal(h.count('DELETE', '/integrations/vikash/authorizations'), 0);
  h.unmount();
});

test('failed explicit cancellation keeps the same attempt available', async () => {
  const h = await prepare(); h.state.request = async () => { throw Error('Offline'); };
  h.press('Cancelar conexão'); await h.settle();
  assert.equal(h.count('DELETE', '/integrations/vikash/authorizations'), 1);
  assert.equal(h.buttons('Continuar ao ViKash').length, 1); assert.equal(h.notices().length, 1);
  h.unmount();
});

for (const operation of ['browser', 'cancel', 'start']) for (const invalidation of ['unmount', 'session']) for (const outcome of ['resolve', 'reject']) {
  test(`${operation} ${outcome} after ${invalidation} triggers no follow-up requests or UI writes`, async () => {
    const h = operation === 'start' ? mount() : await prepare(); await h.settle();
    const pending = deferred();
    if (operation === 'browser') h.state.browser = () => pending.promise;
    else h.state.request = () => pending.promise;
    h.press(operation === 'start' ? 'Conectar ao ViKash' : operation === 'cancel' ? 'Cancelar conexão' : 'Continuar ao ViKash');
    await h.settle(); const calls = h.calls.length, snapshot = h.snapshot;
    if (invalidation === 'unmount') h.unmount(); else h.state.epoch++;
    if (outcome === 'reject') pending.reject(Error('Late failure'));
    else pending.resolve(operation === 'start' ? { authorizationUrl: 'https://vikash.example.test/oauth2/authorize', returnUrl: 'fuellog://vikash-return' } : { type: 'success' });
    await h.settle();
    assert.equal(h.calls.length, calls); assert.deepEqual(h.lateWrites, []); assert.equal(h.snapshot, snapshot);
    if (invalidation !== 'unmount') h.unmount();
  });
}

test('same-frame taps cannot open parallel browsers, cancel, or replace an ongoing attempt', async () => {
  const h = await prepare(); const browser = deferred(); h.state.browser = () => browser.promise;
  const open = h.buttons('Continuar ao ViKash')[0].props.onPress;
  const cancel = h.buttons('Cancelar conexão')[0].props.onPress;
  open(); open(); cancel(); await h.settle();
  assert.equal(h.browserCalls.length, 1); assert.equal(h.count('DELETE', '/integrations/vikash/authorizations'), 0);
  assert.equal(h.count('POST', '/integrations/vikash/authorizations'), 1);
  browser.resolve({ type: 'dismiss' }); await h.settle(); h.unmount();
});

test('a pending server attempt without a local URL cannot be replaced by connect', async () => {
  const h = mount({ status: 'CONNECTING' }); await h.settle();
  assert.equal(h.buttons('Conectar ao ViKash').length, 0);
  assert.equal(h.buttons('Cancelar conexão').length, 1);
  assert.equal(h.count('POST', '/integrations/vikash/authorizations'), 0);
  h.unmount();
});

test('an expired connection does not allow retry to replace a still-pending authorization', async () => {
  const h = await prepare(); h.state.status = 'EXPIRED';
  h.press('Continuar ao ViKash'); await h.settle();
  assert.equal(h.buttons('Tentar novamente').length, 1);
  h.press('Tentar novamente'); await h.settle();
  assert.equal(h.count('POST', '/integrations/vikash/authorizations'), 1);
  assert.equal(h.browserCalls.length, 2);
  assert.deepEqual(h.browserCalls[1], h.browserCalls[0]);
  assert.equal(h.count('DELETE', '/integrations/vikash/authorizations'), 0);
  h.unmount();
});

test('web preserves platform and return URL while keeping browser cancellation non-destructive', async () => {
  const h = await prepare({ platform: 'web' }); h.press('Continuar ao ViKash'); await h.settle();
  assert.deepEqual(h.calls.find(call => call.method === 'POST').body, { platform: 'web' });
  assert.equal(h.browserCalls[0][1], 'https://fuellog.example.test/vikash-return');
  assert.equal(h.count('DELETE', '/integrations/vikash/authorizations'), 0);
  h.unmount();
});

for (const inactive of ['inactive', 'signed-out']) {
  test(`hook ${inactive} performs no requests or foreground subscription`, async () => {
    const h = mount({ hookOnly: true, active: inactive !== 'inactive', user: inactive === 'signed-out' ? null : { id: 'user' } });
    await h.settle(); await h.appState('background'); await h.appState('active');
    assert.equal(h.calls.length, 0); assert.equal(h.listeners.size, 0); h.unmount();
  });
}

test('stale reload after unmount or session change cannot send requests', async () => {
  for (const invalidation of ['unmount', 'session']) {
    const h = mount({ hookOnly: true }); await h.settle(); const reload = h.snapshot.reload, count = h.calls.length;
    if (invalidation === 'unmount') h.unmount(); else h.state.epoch++;
    await reload(); await h.settle(); assert.equal(h.calls.length, count); assert.deepEqual(h.lateWrites, []);
    if (invalidation !== 'unmount') h.unmount();
  }
});

test('stale status responses never fetch catalog or update an unmounted or replaced session', async () => {
  for (const invalidation of ['unmount', 'session']) {
    const h = mount({ hookOnly: true }); await h.settle(); const pending = deferred(); h.state.request = () => pending.promise;
    const reload = h.snapshot.reload(); await h.settle(); const snapshot = h.snapshot, count = h.calls.length;
    if (invalidation === 'unmount') h.unmount(); else h.state.epoch++;
    pending.resolve({ status: 'CONNECTED', configured: true, connectionId: 'old', preferences: null });
    await reload; await h.settle(); assert.equal(h.calls.length, count); assert.deepEqual(h.lateWrites, []); assert.equal(h.snapshot, snapshot);
    if (invalidation !== 'unmount') h.unmount();
  }
});

test('browser return wins over an older foreground response', async () => {
  const h = await prepare(), browser = deferred(), foreground = deferred();
  h.state.browser = () => browser.promise; h.press('Continuar ao ViKash'); await h.settle();
  await h.appState('background');
  h.state.request = () => { h.state.request = null; return foreground.promise; };
  await h.appState('active'); h.state.status = 'CONNECTED';
  browser.resolve({ type: 'dismiss' }); await h.settle(); assert.equal(h.connected(), true);
  foreground.resolve({ status: 'CONNECTING', configured: true, connectionId: null, preferences: null });
  await h.settle(); assert.equal(h.connected(), true); h.unmount();
});

test('deactivating a hook blocks stale reload and foreground callbacks', async () => {
  const h = mount({ hookOnly: true }); await h.settle(); const reload = h.snapshot.reload;
  h.state.active = false; h.render(); await h.settle(); const count = h.calls.length;
  await reload(); await h.appState('background'); await h.appState('active');
  assert.equal(h.calls.length, count); assert.equal(h.listeners.size, 0); h.unmount();
});

test('session replacement clears the old authorization and keeps a new operation locked against late completion', async () => {
  const h = await prepare(), oldBrowser = deferred(), newStart = deferred();
  h.state.browser = () => oldBrowser.promise;
  const oldCancel = h.buttons('Cancelar conexão')[0].props.onPress;
  h.press('Continuar ao ViKash'); await h.settle();
  h.state.epoch++; h.state.status = 'DISCONNECTED'; h.render(); await h.settle();
  assert.equal(h.buttons('Continuar ao ViKash').length, 0);
  assert.equal(h.buttons('Conectar ao ViKash').length, 1);
  h.state.request = () => newStart.promise; h.press('Conectar ao ViKash'); await h.settle();
  const count = h.calls.length;
  oldBrowser.resolve({ type: 'success' }); await h.settle(); oldCancel(); await h.settle();
  assert.equal(h.calls.length, count); assert.equal(h.count('DELETE', '/integrations/vikash/authorizations'), 0);
  h.unmount(); newStart.resolve({ authorizationUrl: 'https://vikash.example.test/oauth2/authorize', returnUrl: 'fuellog://vikash-return' });
  await h.settle(); assert.deepEqual(h.lateWrites, []);
});
