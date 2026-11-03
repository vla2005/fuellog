import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

// Run the screen's actual hooks/handlers; replace only UI, time and HTTP boundaries.
function mount() {
  let index = 0, dirty = false, mounted = true, effects = [], now = Date.now();
  const hooks = [], timers = new Set(), calls = [], routes = [], toasts = [], lateWrites = [];
  const state = { epoch: 0, send: null, register: null };
  const challenge = { verificationId: 'verification-1', expiresAt: new Date(now + 600_000).toISOString(), resendAfterSeconds: 60 };
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const i = index++;
      hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[i].value, next => {
        if (!mounted) lateWrites.push(next);
        const value = typeof next === 'function' ? next(hooks[i].value) : next;
        if (!Object.is(value, hooks[i].value)) { hooks[i].value = value; dirty = true; }
      }];
    },
    useRef(initial) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useEffect(effect, deps) {
      const i = index++;
      if (!hooks[i] || !same(hooks[i].deps, deps)) effects.push(() => {
        hooks[i]?.cleanup?.(); hooks[i] = { deps, cleanup: effect() };
      });
    },
  };
  react.default = react;
  class ApiError extends Error { constructor(options) { super(options.message); Object.assign(this, options); } }
  const dependencies = {
    react,
    'expo-linking': { openURL: async () => {} },
    'expo-router': { useRouter: () => ({ replace: path => routes.push(path), canGoBack: () => false }) },
    'react-native': { Keyboard: { dismiss() {} }, Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View', StyleSheet: { create: value => value } },
    '@/api/types': { ApiError },
    '@/api/tokenStorage': { getSessionEpoch: () => state.epoch },
    '@/api/endpoints': { requestRegistrationCode: async email => {
      calls.push({ type: 'code', email });
      return state.send ? state.send(email) : challenge;
    } },
    '@/state/SessionContext': { useSession: () => ({
      getCurrentSessionEpoch: () => state.epoch,
      showToast: value => toasts.push(value),
      signUpAndSignIn: async payload => {
        calls.push({ type: 'register', payload });
        return state.register ? state.register(payload) : { registeredOnly: false, email: payload.email };
      },
    }) },
    '@/theme/ThemeProvider': { useAppTheme: () => ({ colors: {} }) },
    '@/theme/tokens': { radii: {}, typography: {} },
    '@/components/icons/AppIcons': Object.fromEntries(['EyeIcon', 'LockIcon', 'MailIcon', 'UserIcon'].map(name => [name, name])),
  };
  for (const [path, name] of [
    ['@/components/feedback/InlineNotice', 'InlineNotice'], ['@/components/layout/ScreenShell', 'ScreenShell'],
    ['@/components/overlays/AppSheet', 'AppSheet'], ['@/components/ui/PrimaryButton', 'PrimaryButton'],
    ['@/features/auth/AuthSceneHero', 'AuthSceneHero'], ['@/components/inputs/OtpSixInput', 'OtpSixInput'],
  ]) dependencies[path] = { [name]: name };
  const source = readFileSync(new URL('../src/features/auth/RegisterScreen.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  const FakeDate = class extends Date { static now() { return now; } };
  new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', 'Date', outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unmapped dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports, fn => { timers.add(fn); return fn; }, fn => timers.delete(fn), FakeDate);
  const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(child => nodes(child, predicate))
    : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
  const h = { state, calls, routes, toasts, lateWrites, timers, ApiError,
    render() { index = 0; dirty = false; effects = []; h.tree = module.exports.RegisterScreen(); effects.forEach(effect => effect()); },
    async settle() { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); if (mounted && dirty) h.render(); } },
    find(type) { return nodes(h.tree, node => node.type === type); },
    button(label) { return h.find('PrimaryButton').find(node => node.props.label === label); },
    press(label) { const button = h.button(label); assert.ok(button, `Missing button ${label}`); assert.ok(!button.props.disabled && !button.props.loading); button.props.onPress(); },
    field(label, value) { const input = h.find('TextInput').find(node => node.props.accessibilityLabel === label); assert.ok(input); input.props.onChangeText(value); h.render(); },
    otp(value) { assert.equal(h.find('OtpSixInput').length, 1); h.find('OtpSixInput')[0].props.onChange(value); h.render(); },
    async advance(ms) { now += ms; timers.forEach(fn => fn()); await h.settle(); },
    unmount() { mounted = false; hooks.forEach(hook => hook?.cleanup?.()); },
  };
  h.render();
  h.field('Nome', 'Condutor'); h.field('E-mail', 'driver@example.test'); h.field('Senha', 'Strong-test-42!');
  return h;
}

async function start(h = mount()) { h.press('Criar conta'); await h.settle(); return h; }

test('signup sends email only and waits for six-digit proof before creating account', async () => {
  const h = await start();
  assert.deepEqual(h.calls, [{ type: 'code', email: 'driver@example.test' }]);
  assert.equal(h.find('OtpSixInput').length, 1);
  assert.equal(h.button('Confirmar e criar conta').props.disabled, true);
  h.otp('012345'); h.press('Confirmar e criar conta'); await h.settle();
  assert.deepEqual(h.calls[1], { type: 'register', payload: {
    name: 'Condutor', email: 'driver@example.test', password: 'Strong-test-42!', verificationId: 'verification-1', code: '012345',
  } });
  assert.deepEqual(h.routes, ['/']);
  h.unmount();
});

test('wrong code preserves form without success; resend is throttled and replaces proof', async () => {
  const h = await start();
  h.state.register = async () => { throw new h.ApiError({ message: 'Código inválido.', kind: 'http', status: 400 }); };
  h.otp('123456'); h.press('Confirmar e criar conta'); await h.settle();
  assert.equal(h.find('OtpSixInput')[0].props.value, '123456');
  assert.deepEqual(h.toasts, []); assert.deepEqual(h.routes, []);
  assert.ok(h.find('InlineNotice').length);
  assert.equal(h.button('Reenviar em 60s').props.disabled, true);
  await h.advance(60_000);
  h.state.send = async () => ({ verificationId: 'verification-2', expiresAt: new Date(Date.now() + 600_000).toISOString(), resendAfterSeconds: 60 });
  h.press('Reenviar código'); await h.settle();
  assert.equal(h.find('OtpSixInput')[0].props.value, '');
  h.state.register = async () => ({ registeredOnly: true });
  h.otp('987654'); h.press('Confirmar e criar conta'); await h.settle();
  assert.equal(h.calls.at(-1).payload.verificationId, 'verification-2');
  assert.deepEqual(h.routes, ['/login']);
  h.unmount();
});

test('changing details discards the old code and keeps editable data; expired code cannot submit', async () => {
  const h = await start();
  h.otp('123456'); h.press('Alterar dados'); await h.settle();
  assert.equal(h.find('OtpSixInput').length, 0);
  assert.equal(h.find('TextInput').find(node => node.props.accessibilityLabel === 'E-mail').props.value, 'driver@example.test');
  h.field('E-mail', 'other@example.test'); h.press('Criar conta'); await h.settle();
  assert.equal(h.calls.at(-1).email, 'other@example.test');
  h.otp('123456'); await h.advance(600_001);
  assert.equal(h.button('Confirmar e criar conta').props.disabled, true);
  h.unmount(); assert.equal(h.timers.size, 0);
});

test('send failure stays on details and duplicate taps do not send multiple requests', async () => {
  const h = mount(), request = deferred();
  h.state.send = () => request.promise;
  h.press('Criar conta'); h.button('Criar conta').props.onPress(); await h.settle();
  assert.equal(h.calls.length, 1);
  request.reject(new Error('SMTP unavailable')); await h.settle();
  assert.equal(h.find('OtpSixInput').length, 0);
  assert.ok(h.find('InlineNotice').length);
  assert.deepEqual(h.routes, []);
  h.unmount();
});

test('code response from an old session cannot advance registration', async () => {
  const h = mount(), request = deferred();
  h.state.send = () => request.promise; h.press('Criar conta'); await h.settle();
  h.state.epoch++;
  request.resolve({ verificationId: 'old-session', expiresAt: new Date(Date.now() + 600_000).toISOString(), resendAfterSeconds: 60 });
  await h.settle();
  assert.equal(h.find('OtpSixInput').length, 0);
  assert.deepEqual(h.routes, []); assert.deepEqual(h.toasts, []);
  h.unmount();
});

for (const during of ['code', 'register']) test(`unmount during ${during} avoids late writes, toasts and navigation`, async () => {
  const h = mount(), request = deferred();
  if (during === 'code') { h.state.send = () => request.promise; h.press('Criar conta'); }
  else { await start(h); h.otp('123456'); h.state.register = () => request.promise; h.press('Confirmar e criar conta'); }
  await h.settle(); h.unmount(); request.resolve({ registeredOnly: false }); await h.settle();
  assert.deepEqual(h.lateWrites, []); assert.deepEqual(h.toasts, []); assert.deepEqual(h.routes, []);
});

test('registration transport sends only email to public code endpoint and proof to register', async () => {
  const requests = [];
  const source = readFileSync(new URL('../src/api/endpoints.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => name === './client'
    ? { apiRequest: async options => { requests.push(options); return {}; } }
    : {}, module, module.exports);
  await module.exports.requestRegistrationCode('driver@example.test');
  const payload = { name: 'User', email: 'driver@example.test', password: 'Strong-test-42!', verificationId: 'proof', code: '012345' };
  await module.exports.registerUser(payload);
  assert.deepEqual(requests, [
    { method: 'POST', path: '/auth/registration-code', body: { email: 'driver@example.test' }, authenticated: false },
    { method: 'POST', path: '/auth/register', body: payload, authenticated: false },
  ]);
});
