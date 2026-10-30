import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

// Execute the screen's real hooks, effects and handlers, replacing only its JSX
// return with an observable snapshot. This is a state regression, not visual E2E.
function loadScreen(relativePath, exportName, dependencies, observableReturn = true, clock = globalThis) {
  const path = new URL(`../src/${relativePath}`, import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindingNames = name => ts.isIdentifier(name) ? [name.text] : name.elements.flatMap(element => bindingNames(element.name));
  const transform = context => root => ts.visitNode(root, function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === exportName) {
      const names = node.body.statements.filter(ts.isVariableStatement)
        .flatMap(statement => statement.declarationList.declarations.flatMap(declaration => bindingNames(declaration.name)));
      const statements = node.body.statements.map(statement => ts.isReturnStatement(statement)
        ? ts.factory.createReturnStatement(ts.factory.createObjectLiteralExpression(names.map(name => ts.factory.createShorthandPropertyAssignment(name))))
        : statement);
      return ts.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters,
        node.parameters, node.type, ts.factory.updateBlock(node.body, statements));
    }
    return ts.visitEachChild(node, visit, context);
  });
  const output = ts.transpileModule(source.text, {
    fileName: path.pathname,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    transformers: observableReturn ? { before: [transform] } : undefined,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', output)(specifier => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    if (specifier.startsWith('@/components/') || specifier.includes('VehicleFormSheet')) return {};
    throw Error(`Unmapped dependency: ${specifier}`);
  }, module, module.exports, clock.setTimeout.bind(clock), clock.clearTimeout.bind(clock));
  return module.exports[exportName];
}

function loadUtility(name) {
  const module = { exports: {} };
  const output = ts.transpileModule(readFileSync(new URL(`../src/utils/${name}.ts`, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

function loadFeatureModule(relativePath, dependencies, clock = globalThis) {
  const path = new URL(`../src/${relativePath}`, import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const output = ts.transpileModule(source.text, {
    fileName: path.pathname,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', output)(specifier => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    if (specifier === '../../utils/decimal' || specifier === '@/utils/decimal') return dependencies['@/utils/decimal'];
    if (specifier === '../../utils/numericMask' || specifier === '@/utils/numericMask') return dependencies['@/utils/numericMask'];
    throw Error(`Unmapped dependency: ${specifier}`);
  }, module, module.exports, clock.setTimeout.bind(clock), clock.clearTimeout.bind(clock));
  return module.exports;
}

const date = loadUtility('date');
const decimal = loadUtility('decimal');
const location = loadUtility('location');
const numericMask = loadUtility('numericMask');
const calendarHelper = (() => {
  const module = { exports: {} };
  const output = ts.transpileModule(readFileSync(new URL('../src/features/history/helpers/calendarHelper.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('module', 'exports', output)(module, module.exports);
  return module.exports;
})();
const vehicle = id => ({ id, nickname: id, allowedFuels: ['ETHANOL'], brand: null, model: null, plate: null });
const period = { from: '2026-10-01', to: '2026-10-31', label: 'Outubro 2026', monthKey: '2026-10' };
const draftKey = id => `fuellog.draft.fuel_entry.v1.user.${id}`;
const draft = (id, liters = '35') => ({ id, liters, unitPrice: '6', manualPaidTotal: '', isManualPaidTotal: false,
  adjustmentReason: '', odometerKm: '1000', dateStr: '2026-10-20', timeStr: '12:00', timezone: 'America/Sao_Paulo',
  fuelType: 'ETHANOL', tankState: 'FULL', historyGapBefore: false, stationName: '', notes: '', showMoreDetails: false });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function mount(relativePath, exportName, { store = new Map(), endpoints = {}, gps = {}, clock = globalThis, props = {}, observableReturn = true, platform = 'android' } = {}) {
  let index = 0;
  let dirty = false;
  let pendingEffects = [];
  const hooks = [];
  const writes = [];
  const activity = { tabActive: true, appActive: true };
  const navigation = [];
  const openedUrls = [];
  const session = { status: 'authenticated', user: { id: 'user', preferredTimezone: 'America/Sao_Paulo' }, vehicles: [vehicle('A'), vehicle('B')],
    activeVehicle: vehicle('A'), selectedPeriod: period, dataVersion: 0, invalidateFuelData() {}, showToast() {},
    createNewVehicle: payload => endpoints.createVehicle(payload) };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement(type, props, ...children) {
      return typeof type === 'function' ? type({ ...props, children }) : { type, props: { ...props, children } };
    },
    useContext() { return activity.tabActive; },
    useState(initial) {
      const i = index++;
      if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[i].value, value => {
        const next = typeof value === 'function' ? value(hooks[i].value) : value;
        if (!Object.is(next, hooks[i].value)) { hooks[i].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useMemo(factory, deps) { const i = index++; if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { value: factory(), deps }; return hooks[i].value; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const i = index++;
      if (!hooks[i] || !same(hooks[i].deps, deps)) pendingEffects.push(() => {
        hooks[i]?.cleanup?.(); hooks[i] = { deps, effect, cleanup: effect() };
      });
    },
  };
  react.default = react;
  class ApiError extends Error { constructor(options) { super(options.message); Object.assign(this, options); } }
  const dependencies = {
    react, 'react-native': { StyleSheet: { create: styles => styles, absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } },
      useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
      Platform: { OS: platform, select: map => map?.[platform] ?? map?.default }, Linking: { openURL: async url => { openedUrls.push(url); } }, View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', Image: 'NativeImage' },
    'react-native-webview': { WebView: 'NativeWebView' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) },
    'react-native-svg': { default: 'Svg', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' },
    '@/assets/brand/scene_day_road_integrated.png': 'IntegratedRoadScene',
    'expo-image': { Image: 'ExpoImage' },
    './AndroidLocationMap': { AndroidLocationMap: 'AndroidLocationMap' },
    'expo-location': {
      Accuracy: { Balanced: 3 },
      hasServicesEnabledAsync: async () => true,
      requestForegroundPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
      getCurrentPositionAsync: async () => ({ coords: { latitude: -23.55052, longitude: -46.633308 } }),
      ...gps,
    },
    '@react-native-async-storage/async-storage': {
      getItem: async key => store.get(key) ?? null,
      setItem: async (key, value) => { writes.push({ key, value: JSON.parse(value) }); store.set(key, value); },
      removeItem: async key => { store.delete(key); },
    },
    'expo-router': { useRouter: () => ({ replace(path) { navigation.push(path); }, push() {} }), useLocalSearchParams: () => ({}) },
    '@/components/navigation/AuthenticatedTabShell': { TabActiveContext: {}, useAuthenticatedHeader: () => ({ headerHeight: 56 }) },
    '@/motion/useMotionPolicy': { useMotionPolicy: () => ({ isAppActive: activity.appActive }) },
    '@/features/home/MonthlySummaryModal': {},
    '@/api/endpoints': { FUEL_TYPE_LABELS: {}, FUEL_TYPE_SHORT_LABELS: {}, TANK_STATE_LABELS: {}, TANK_STATE_SHORT_LABELS: {}, UNAVAILABLE_REASON_EXPLANATIONS: {}, ...endpoints },
    '@/api/types': { ApiError }, '@/state/SessionContext': { useSession: () => session },
    '@/api/tokenStorage': { getSessionEpoch: () => 0 },
    '@/theme/ThemeProvider': { useAppTheme: () => ({ colors: {}, isDark: false }) },
    '@/theme/tokens': { radii: {}, shadows: {}, typography: {}, layout: { horizontalPadding: 20 } },
    '@/utils/date': date, '@/utils/decimal': decimal, '@/utils/location': location, '@/utils/uuid': { generateUuidV4: randomUUID },
    '@/utils/numericMask': numericMask, '../../utils/numericMask': numericMask,
  };
  dependencies['./fuelingCalculations'] = loadFeatureModule('features/fueling/fuelingCalculations.ts', dependencies, clock);
  dependencies['@/features/fueling/fuelingCalculations'] = dependencies['./fuelingCalculations'];
  dependencies['./useForegroundLocation'] = {
    useForegroundLocation: loadScreen('features/fueling/useForegroundLocation.ts', 'useForegroundLocation', dependencies, false, clock),
  };
  dependencies['./components/HistoryFilterSheet'] = { HistoryFilterSheet: () => null };
  dependencies['./helpers/calendarHelper'] = calendarHelper;
  const screen = loadScreen(relativePath, exportName, dependencies, observableReturn, clock);
  const harness = { session, store, writes, activity, navigation, openedUrls, ApiError, snapshot: null,
    render() { index = 0; dirty = false; pendingEffects = []; harness.snapshot = screen(props); const effects = pendingEffects; effects.forEach(effect => effect()); },
    async settle() { for (let i = 0; i < 12; i++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) harness.render(); } },
    async remountBeforeOldCleanup() {
      const cleanups = hooks.map(hook => hook?.cleanup).filter(Boolean);
      hooks.length = 0;
      harness.render();
      cleanups.forEach(cleanup => cleanup());
      await harness.settle();
    },
    async switchVehicle(id) { session.activeVehicle = session.vehicles.find(item => item.id === id); harness.render(); await harness.settle(); },
    async replayEffects() {
      const effects = hooks.filter(hook => hook?.effect);
      effects.forEach(hook => hook.cleanup?.());
      effects.forEach(hook => { hook.cleanup = hook.effect(); });
      await harness.settle();
    },
    unmount() { hooks.forEach(hook => hook?.cleanup?.()); },
  };
  harness.render();
  return harness;
}

function findElement(node, matches) {
  if (!node || typeof node !== 'object') return null;
  if (matches(node)) return node;
  for (const child of node.props?.children?.flat(Infinity) ?? []) {
    const found = findElement(child, matches);
    if (found) return found;
  }
  return null;
}

function renderedText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return (node?.props?.children?.flat(Infinity) ?? []).map(renderedText).join(' ');
}

function* elements(node) {
  if (!node || typeof node !== 'object') return;
  yield node;
  for (const child of node.props?.children?.flat(Infinity) ?? []) yield* elements(child);
}

const nativeTiles = h => [...elements(h.snapshot)].filter(node => node.type === 'ExpoImage');
const mapSpinner = h => findElement(h.snapshot, node => node.type === 'ActivityIndicator');

test('Android usa renderer nativo e primeira carga termina apenas com todos os tiles distintos', async () => {
  const routed = mount('components/location/LocationMap.tsx', 'LocationMap', {
    props: { latitude: -23.55052, longitude: -46.633308 }, observableReturn: false,
  });
  try { assert.equal(routed.snapshot.type, 'AndroidLocationMap'); } finally { routed.unmount(); }
  const h = mount('components/location/AndroidLocationMap.tsx', 'AndroidLocationMap', {
    props: { latitude: -23.55052, longitude: -46.633308 }, observableReturn: false,
  });
  await h.settle();
  try {
    const tiles = nativeTiles(h);
    assert.ok(tiles.length > 1 && tiles.length <= 9);
    assert.ok(mapSpinner(h));
    for (const tile of tiles) {
      assert.match(tile.props.source.uri, /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
      assert.match(tile.props.source.headers['User-Agent'], /^FuelLog\//);
      assert.equal(tile.props.cachePolicy, 'memory-disk', 'Revisitas devem usar cache persistente, sem passar pelo no-store do Fresco');
      assert.equal(tile.props.source.uri.includes('?'), false, 'Retry e zoom não devem criar URLs para contornar o cache');
      assert.equal(tile.props.source.headers.Referer, undefined, 'Cliente nativo não deve simular a origem de outro site');
      assert.equal(tile.props.source.headers.Authorization, undefined);
    }
    tiles[0].props.onLoad();
    tiles[0].props.onLoad();
    await h.settle();
    assert.ok(mapSpinner(h), 'Evento repetido de um tile não representa os demais');
    for (const tile of tiles) tile.props.onLoad();
    await h.settle();
    assert.equal(mapSpinner(h), null, 'Primeira carga não depende de um rerender ou onLayout extra');
    assert.equal(findElement(h.snapshot, node => node.props?.accessibilityLabel === 'Tentar carregar o mapa novamente'), null);
  } finally { h.unmount(); }
});

test('replay de efeitos no modo estrito não invalida imagens Android da montagem atual', async () => {
  const h = mount('components/location/AndroidLocationMap.tsx', 'AndroidLocationMap', {
    props: { latitude: 0, longitude: 0 }, observableReturn: false,
  });
  await h.settle();
  try {
    await h.replayEffects();
    for (const tile of nativeTiles(h)) tile.props.onLoad();
    await h.settle();
    assert.equal(mapSpinner(h), null);
  } finally { h.unmount(); }
});

test('tiles Android preservam coordenadas no retry e ignoram callbacks antigos ou após desmontar', async () => {
  const errors = [];
  const props = { latitude: -23.55052, longitude: -46.633308, onMapError: error => errors.push(error) };
  const h = mount('components/location/AndroidLocationMap.tsx', 'AndroidLocationMap', { props, observableReturn: false });
  await h.settle();
  try {
    const old = nativeTiles(h);
    old[0].props.onError({ error: 'HTTP 403 private-diagnostic https://example.test/?token=secret' });
    await h.settle();
    const retry = findElement(h.snapshot, node => node.props?.accessibilityLabel === 'Tentar carregar o mapa novamente');
    assert.ok(retry);
    assert.equal(errors.length, 1);
    assert.match(renderedText(h.snapshot), /HTTP 403/);
    assert.doesNotMatch(renderedText(h.snapshot), /private-diagnostic|token=secret/);
    retry.props.onPress();
    await h.settle();
    const current = nativeTiles(h);
    assert.deepEqual(current.map(tile => tile.props.source.uri), old.map(tile => tile.props.source.uri));
    for (const tile of old) { tile.props.onLoad(); tile.props.onError({ nativeEvent: { error: 'old' } }); }
    await h.settle();
    assert.ok(mapSpinner(h));
    assert.equal(errors.length, 1);
    for (const tile of current) tile.props.onLoad();
    await h.settle();
    assert.equal(mapSpinner(h), null);
  } finally { h.unmount(); }
  const lateErrors = [];
  const detached = mount('components/location/AndroidLocationMap.tsx', 'AndroidLocationMap', {
    props: { latitude: 0, longitude: 0, onMapError: error => lateErrors.push(error) }, observableReturn: false,
  });
  await detached.settle();
  const late = nativeTiles(detached);
  detached.unmount();
  for (const tile of late) tile.props.onError({ nativeEvent: { error: 'late' } });
  assert.deepEqual(lateErrors, []);
});

test('zoom e mudança de coordenada dentro dos mesmos tiles não prendem o carregamento Android', async () => {
  const props = { latitude: -23.55052, longitude: -46.633308 };
  const h = mount('components/location/AndroidLocationMap.tsx', 'AndroidLocationMap', { props, observableReturn: false });
  await h.settle();
  try {
    for (const tile of nativeTiles(h)) tile.props.onLoad();
    await h.settle();
    const old = nativeTiles(h);
    findElement(h.snapshot, node => node.props?.accessibilityLabel === 'Aumentar zoom').props.onPress();
    await h.settle();
    assert.notDeepEqual(nativeTiles(h).map(tile => tile.props.source.uri), old.map(tile => tile.props.source.uri));
    for (const tile of old) tile.props.onLoad();
    await h.settle();
    assert.ok(mapSpinner(h));
    for (const tile of nativeTiles(h)) tile.props.onLoad();
    await h.settle();
    assert.equal(mapSpinner(h), null);
    const beforeMove = nativeTiles(h);
    props.latitude += 0.0000001;
    h.render();
    await h.settle();
    const moved = nativeTiles(h);
    assert.deepEqual(moved.map(tile => tile.props.source.uri), beforeMove.map(tile => tile.props.source.uri), 'Caso usa as mesmas imagens em cache');
    if (mapSpinner(h)) {
      assert.notDeepEqual(moved.map(tile => tile.props.key), beforeMove.map(tile => tile.props.key),
        'Se aguarda onLoad, imagens de mesma URI precisam remontar para emitir o evento');
      for (const tile of moved) tile.props.onLoad();
      await h.settle();
    }
    assert.equal(mapSpinner(h), null);
    const beforeResize = nativeTiles(h);
    findElement(h.snapshot, node => typeof node.props?.onLayout === 'function').props.onLayout({ nativeEvent: { layout: { width: 280, height: 280 } } });
    await h.settle();
    for (const tile of beforeResize) tile.props.onError({ nativeEvent: { error: 'old layout' } });
    await h.settle();
    assert.equal(findElement(h.snapshot, node => node.props?.accessibilityLabel === 'Tentar carregar o mapa novamente'), null);
    for (const tile of nativeTiles(h)) tile.props.onLoad();
    await h.settle();
    assert.equal(mapSpinner(h), null);
  } finally { h.unmount(); }
});

test('mapa nativo preserva erro HTTP após fim do carregamento e permite nova tentativa', async () => {
  const errors = [];
  const coordinates = { latitude: -23.55052, longitude: -46.633308 };
  const h = mount('components/location/LocationMap.tsx', 'LocationMap', {
    props: { ...coordinates, onMapError: error => errors.push(error) }, observableReturn: false, platform: 'ios',
  });
  await h.settle();
  const webview = () => findElement(h.snapshot, node => node.type === 'NativeWebView');
  const retry = () => findElement(h.snapshot, node => node.props?.accessibilityLabel === 'Tentar carregar o mapa novamente');
  try {
    const source = webview().props.source.uri;
    const allowNavigation = webview().props.onShouldStartLoadWithRequest;
    assert.equal(allowNavigation({ url: source }), true);
    assert.equal(allowNavigation({ url: 'about:blank' }), true);
    assert.equal(allowNavigation({ url: 'https://example.test/' }), false);
    assert.equal(allowNavigation({ url: 'https://www.openstreetmap.org/other-page' }), false);
    assert.deepEqual(h.openedUrls, [], 'Bloquear navegação não abre navegador externo automaticamente');
    assert.equal(typeof webview().props.onHttpError, 'function');
    webview().props.onHttpError({ nativeEvent: { statusCode: 503, description: 'private-diagnostic https://example.test/?token=secret', url: source } });
    await h.settle();
    webview().props.onLoad?.({ nativeEvent: { url: source } });
    webview().props.onLoadEnd?.({ nativeEvent: { url: source } });
    await h.settle();
    assert.ok(retry(), 'HTTP 503 permanece visível mesmo após onLoadEnd');
    assert.match(renderedText(h.snapshot), /503/, 'Erro HTTP informa código que pode ser diagnosticado no aparelho');
    assert.doesNotMatch(renderedText(h.snapshot), /private-diagnostic|token=secret/);
    assert.equal(errors.length, 1);
    retry().props.onPress();
    await h.settle();
    assert.equal(retry(), null);
    assert.equal(webview().props.source.uri, source, 'Retry usa as mesmas coordenadas, sem recapturar GPS');
    webview().props.onLoad?.({ nativeEvent: { url: source } });
    webview().props.onLoadEnd?.({ nativeEvent: { url: source } });
    await h.settle();
    assert.equal(retry(), null);
  } finally { h.unmount(); }
});

test('timeout do mapa permite retry, recupera sucesso tardio e cancela temporizadores ao desmontar', async () => {
  let timerId = 0;
  const timers = new Map();
  const clock = {
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const errors = [];
  const h = mount('components/location/LocationMap.tsx', 'LocationMap', {
    clock, props: { latitude: 0, longitude: 0, onMapError: error => errors.push(error) }, observableReturn: false, platform: 'ios',
  });
  await h.settle();
  try {
    assert.ok(timers.size > 0);
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    await h.settle();
    const retry = findElement(h.snapshot, node => node.props?.accessibilityLabel === 'Tentar carregar o mapa novamente');
    assert.ok(retry, 'Timeout expõe recuperação em vez de spinner permanente');
    assert.equal(errors.length, 1);
    retry.props.onPress();
    await h.settle();
    assert.ok(timers.size > 0, 'Retry recebe novo prazo de carregamento');
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    await h.settle();
    assert.equal(errors.length, 2, 'Cada tentativa notifica seu timeout uma vez');
    assert.ok(findElement(h.snapshot, node => node.props?.accessibilityLabel === 'Tentar carregar o mapa novamente'));
    const webview = findElement(h.snapshot, node => node.type === 'NativeWebView');
    webview.props.onLoad({ nativeEvent: { url: webview.props.source.uri } });
    await h.settle();
    assert.equal(findElement(h.snapshot, node => node.props?.accessibilityLabel === 'Tentar carregar o mapa novamente'), null,
      'Carregamento concluído após timeout recupera o mapa sem recaptura nem novo toque');
  } finally { h.unmount(); }
  assert.equal(timers.size, 0);
});

test('erro nativo do mapa mostra código sanitizado e preserva coordenadas na nova tentativa', async () => {
  const h = mount('components/location/LocationMap.tsx', 'LocationMap', {
    props: { latitude: 0, longitude: 0 }, observableReturn: false, platform: 'ios',
  });
  await h.settle();
  try {
    const webview = findElement(h.snapshot, node => node.type === 'NativeWebView');
    const source = webview.props.source.uri;
    webview.props.onError({ nativeEvent: { code: -2, description: 'private-diagnostic https://example.test/?token=secret', url: source } });
    webview.props.onLoadEnd?.({ nativeEvent: { url: source } });
    await h.settle();
    assert.match(renderedText(h.snapshot), /-2/);
    assert.doesNotMatch(renderedText(h.snapshot), /private-diagnostic|token=secret/);
    const retry = findElement(h.snapshot, node => node.props?.accessibilityLabel === 'Tentar carregar o mapa novamente');
    assert.ok(retry);
    retry.props.onPress();
    await h.settle();
    assert.equal(findElement(h.snapshot, node => node.type === 'NativeWebView').props.source.uri, source);
  } finally { h.unmount(); }
});

test('cadastro envia quilometragem opcional sem arredondar e preserva dados em falhas', async () => {
  for (const [input, expected] of [['', undefined], ['0', 0], ['45000', 45000], ['007', 7], ['-1', 'invalid'], ['1.5', 'invalid'], ['9007199254740993', 'invalid']]) {
    const calls = [];
    const h = mount('features/vehicles/VehicleFormSheet.tsx', 'VehicleFormSheet', {
      props: { visible: true, onClose() {}, onCreated() {} },
      endpoints: { createVehicle: async payload => { calls.push(payload); return vehicle('created'); } },
    });
    h.snapshot.setModel('Meu carro');
    h.snapshot.setCurrentOdometerKm(input);
    await h.settle();
    await h.snapshot.handleCreate();
    await h.settle();
    if (expected === 'invalid') {
      assert.equal(calls.length, 0, input);
      assert.ok(h.snapshot.fieldErrors.currentOdometerKm, input);
      assert.equal(h.snapshot.currentOdometerKm, input);
    } else {
      assert.equal(calls.length, 1, input);
      assert.equal(calls[0].currentOdometerKm, expected, input);
      if (expected === undefined) assert.equal(Object.hasOwn(calls[0], 'currentOdometerKm'), false);
    }
  }
  const h = mount('features/vehicles/VehicleFormSheet.tsx', 'VehicleFormSheet', {
    props: { visible: true, onClose() {}, onCreated() {} },
    endpoints: { createVehicle: async () => { throw Error('Sem conexão'); } },
  });
  h.snapshot.setModel('Meu carro');
  h.snapshot.setCurrentOdometerKm('45000');
  await h.settle();
  await h.snapshot.handleCreate();
  await h.settle();
  assert.equal(h.snapshot.model, 'Meu carro');
  assert.equal(h.snapshot.currentOdometerKm, '45000');
  assert.ok(h.snapshot.errorMessage);
});

test('cadastro usa modelo como identificação e valida modelo e capacidade sem perder dados', async () => {
  for (const [model, capacity, invalidField] of [
    ['  Captur  ', '50,125', null],
    [' ', '50', 'model'],
    ['a'.repeat(61), '50', 'model'],
    ['Captur', '0', 'tankCapacityLiters'],
    ['Captur', '-1', 'tankCapacityLiters'],
    ['Captur', '50,1234', 'tankCapacityLiters'],
  ]) {
    const calls = [];
    const h = mount('features/vehicles/VehicleFormSheet.tsx', 'VehicleFormSheet', {
      props: { visible: true, onClose() {}, onCreated() {} },
      endpoints: { createVehicle: async payload => { calls.push(payload); return vehicle('created'); } },
    });
    h.snapshot.setModel(model);
    h.snapshot.setTankCapacity(capacity);
    await h.settle();
    await h.snapshot.handleCreate();
    await h.settle();
    if (invalidField) {
      assert.equal(calls.length, 0);
      assert.ok(h.snapshot.fieldErrors[invalidField]);
      assert.equal(h.snapshot.model, model);
      assert.equal(h.snapshot.tankCapacity, capacity);
    } else {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].nickname, 'Captur');
      assert.equal(calls[0].model, 'Captur');
      assert.equal(calls[0].tankCapacityLiters, '50.125');
      for (const field of ['brand', 'modelYear', 'plate']) assert.ok(calls[0][field] == null);
    }
    h.unmount();
  }
  let closed = false;
  const h = mount('features/vehicles/VehicleFormSheet.tsx', 'VehicleFormSheet', {
    props: { visible: true, onClose() { closed = true; }, onCreated() {} },
    endpoints: { createVehicle: async () => {
      throw new h.ApiError({ message: 'Dados inválidos', problem: { fieldErrors: { nickname: 'Identificação inválida' } } });
    } },
  });
  h.snapshot.setModel('Captur');
  h.snapshot.setTankCapacity('50,125');
  await h.settle();
  await h.snapshot.handleCreate();
  await h.settle();
  assert.equal(h.snapshot.modelError, 'Identificação inválida');
  assert.equal(h.snapshot.model, 'Captur');
  assert.equal(h.snapshot.tankCapacity, '50,125');
  assert.equal(closed, false);
  h.unmount();
});

test('GPS negado, desligado ou indisponível bloqueia o handler real sem perder o formulário', async () => {
  for (const gps of [
    { requestForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: false }) },
    { hasServicesEnabledAsync: async () => false },
    { hasServicesEnabledAsync: async () => { throw Error('Módulo indisponível'); } },
  ]) {
    const calls = [];
    const h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', {
      store: new Map([[draftKey('A'), JSON.stringify(draft(randomUUID()))]]), gps,
      endpoints: { createFuelEntry: async (...args) => { calls.push(args); } },
    });
    await h.settle();
    await h.snapshot.requestLocation(true);
    await h.settle();
    assert.notEqual(h.snapshot.locationStatus, 'ready');
    assert.equal(h.snapshot.coordinates, null);
    await h.snapshot.handleSubmit();
    await h.settle();
    assert.equal(calls.length, 0);
    assert.equal(h.snapshot.liters, '35');
    assert.ok(h.snapshot.errorMessage);
  }
});

test('resposta antiga de GPS não remove o timeout da recaptura atual', async () => {
  const timers = new Map();
  let timerId = 0;
  const clock = {
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  let enabled = false;
  let pending = false;
  const positions = [];
  const h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', {
    clock,
    gps: {
      hasServicesEnabledAsync: async () => enabled,
      getCurrentPositionAsync: () => {
        if (!pending) return Promise.resolve({ coords: { latitude: 1, longitude: 2 } });
        const request = deferred(); positions.push(request); return request.promise;
      },
    },
  });
  await h.settle();
  enabled = true;
  await h.snapshot.requestLocation(true);
  await h.settle();
  assert.equal(h.snapshot.locationStatus, 'ready');
  pending = true;
  const older = h.snapshot.requestLocation(true);
  await h.settle();
  assert.equal(h.snapshot.coordinates, null, 'Recaptura invalida a coordenada anterior imediatamente');
  const newer = h.snapshot.requestLocation(true);
  await h.settle();
  assert.equal(timers.size, 1);
  positions[0].resolve({ coords: { latitude: 3, longitude: 4 } });
  await older; await h.settle();
  assert.equal(h.snapshot.coordinates, null);
  assert.equal(timers.size, 1, 'A resposta obsoleta não pode limpar o timer da requisição nova');
  const callback = [...timers.values()][0]; timers.clear(); callback();
  await newer; await h.settle();
  assert.equal(h.snapshot.locationStatus, 'error');
  assert.equal(h.snapshot.coordinates, null);
});

for (const inactiveKey of ['tabActive', 'appActive']) {
  test(`captura GPS ignora resposta tardia e pausa com ${inactiveKey} inativo`, async () => {
    const pending = deferred();
    let captures = 0;
    const h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', {
      gps: { getCurrentPositionAsync: () => {
        captures++;
        return captures === 1 ? pending.promise : Promise.resolve({ coords: { latitude: 3, longitude: 4 } });
      } },
    });
    await h.settle();
    assert.equal(captures, 1);
    assert.equal(h.snapshot.locationStatus, 'locating');
    h.activity[inactiveKey] = false; h.render(); await h.settle();
    pending.resolve({ coords: { latitude: 1, longitude: 2 } });
    await h.settle();
    assert.equal(h.snapshot.coordinates, null);
    assert.equal(h.snapshot.locationStatus, 'idle');
    assert.equal(captures, 1, 'Tela inativa não reinicia captura');
    h.activity[inactiveKey] = true; h.render(); await h.settle();
    assert.equal(captures, 2);
    assert.deepEqual(h.snapshot.coordinates, { latitude: 3, longitude: 4 });
  });
}

test('salvamento confirmado envia GPS normalizado e só recaptura ao voltar ao formulário', async () => {
  let captures = 0;
  const calls = [];
  const h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', {
    props: { embeddedInShell: true },
    store: new Map([[draftKey('A'), JSON.stringify(draft(randomUUID()))]]),
    gps: { getCurrentPositionAsync: async () => {
      captures++;
      return { coords: { latitude: -23.123456789, longitude: -46.987654321 } };
    } },
    endpoints: { createFuelEntry: async (id, payload) => {
      calls.push({ id, payload: structuredClone(payload) });
      return { ...payload, idempotentReplay: false };
    } },
  });
  await h.settle();
  await h.snapshot.handleSubmit(); await h.settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.latitude, -23.1234568);
  assert.equal(calls[0].payload.longitude, -46.9876543);
  assert.equal(calls[0].payload.tankState, 'UNKNOWN');
  assert.equal(calls[0].payload.historyGapBefore, false);
  assert.equal(calls[0].payload.stationName, null);
  assert.equal(calls[0].payload.notes, null);
  assert.deepEqual(h.navigation, ['/']);
  assert.equal(h.snapshot.liters, '');
  assert.equal(captures, 1, 'Navegar para Início não pode solicitar GPS outra vez');
  h.activity.tabActive = false; h.render(); await h.settle();
  assert.equal(captures, 1);
  h.activity.tabActive = true; h.render(); await h.settle();
  assert.equal(captures, 2, 'Retornar ao formulário inicia uma nova captura');
});

for (const existingB of [false, true]) {
  test(`rascunho A não contamina B ${existingB ? 'com' : 'sem'} rascunho, nem durante restauração`, async () => {
    const a = draft(randomUUID());
    const b = draft(randomUUID(), '12');
    const store = new Map([[draftKey('A'), JSON.stringify(a)]]);
    if (existingB) store.set(draftKey('B'), JSON.stringify(b));
    const h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', { store });
    await h.settle();
    assert.equal(h.snapshot.entryId, a.id);
    h.writes.length = 0;
    await h.switchVehicle('B');
    assert.ok(h.writes.filter(write => write.key === draftKey('B')).every(write => write.value.id !== a.id), 'Nunca persistir A sob chave B, nem transitoriamente');
    assert.equal(h.snapshot.liters, existingB ? b.liters : '');
    assert.equal(h.snapshot.entryId === a.id, false);
    if (existingB) assert.equal(h.snapshot.entryId, b.id);
    await h.switchVehicle('A');
    assert.equal(h.snapshot.entryId, a.id, 'Voltar para A preserva UUID de reenvio');
    assert.equal(h.snapshot.liters, a.liters);
  });
}

test('resposta incerta preserva UUID e comando idênticos no reenvio', async () => {
  const original = draft(randomUUID());
  const calls = [];
  let h;
  h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', {
    store: new Map([[draftKey('A'), JSON.stringify(original)]]),
    endpoints: { createFuelEntry: async (id, payload) => {
      calls.push({ id, payload: structuredClone(payload) });
      if (calls.length === 1) throw new h.ApiError({ message: 'Timeout', isUncertainWrite: true });
      return { ...payload, idempotentReplay: true };
    } },
  });
  await h.settle();
  assert.equal(h.snapshot.locationStatus, 'ready', 'Captura automática deve concluir após restaurar o escopo do formulário');
  await h.snapshot.handleSubmit(); await h.settle();
  await h.remountBeforeOldCleanup();
  await h.snapshot.handleSubmit(); await h.settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].payload.id, original.id);
  assert.deepEqual(calls[1], calls[0]);
});

for (const [file, name] of [['home/HomeScreen', 'HomeScreen'], ['history/HistoryScreen', 'HistoryScreen']]) {
  test(`${name}: resposta A atrasada não substitui B`, async () => {
    const gates = { A: deferred(), B: deferred() };
    const result = id => ({ vehicleId: id, paidTotal: id === 'A' ? '100.00' : '200.00', items: [{ id: `entry-${id}`, vehicleId: id,
      occurredAt: '2026-10-20T12:00:00Z', timezone: 'America/Sao_Paulo' }], page: 0, totalPages: 1, totalElements: 1 });
    const h = mount(`features/${file}.tsx`, name, { endpoints: {
      getVehicleSummary: id => gates[id].promise,
      listFuelEntries: id => gates[id].promise,
      getConsumptionCycles: async () => ({ items: [] }),
    } });
    await h.switchVehicle('B');
    gates.B.resolve(result('B')); await h.settle();
    const visible = () => name === 'HomeScreen' ? h.snapshot.summary?.vehicleId : h.snapshot.entries[0]?.vehicleId;
    assert.equal(visible(), 'B');
    gates.A.resolve(result('A')); await h.settle();
    assert.equal(visible(), 'B', 'Dados exibidos devem continuar pertencendo ao veículo selecionado');
    gates.B = deferred();
    h.session.dataVersion += 1; h.render(); await h.settle();
    h.session.status = 'unauthenticated'; h.session.activeVehicle = null; h.render(); await h.settle();
    gates.C = deferred();
    h.session.status = 'authenticated'; h.session.user = { id: 'another-user' };
    h.session.activeVehicle = vehicle('C'); h.render(); await h.settle();
    gates.C.resolve(result('C')); await h.settle();
    assert.equal(visible(), 'C');
    gates.B.resolve(result('B')); await h.settle();
    assert.equal(visible(), 'C', 'Resposta da sessão encerrada não reaparece na sessão nova');
  });
}

test('combustível em Radio no topo exibe apenas allowedFuels e acessibilidade correta', async () => {
  const customVehicle = { id: 'flex-car', nickname: 'Flex', allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'] };
  const h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', {
    observableReturn: false,
    sessionVehicles: [customVehicle],
  });
  h.session.activeVehicle = customVehicle;
  h.session.vehicles = [customVehicle];
  h.render();
  await h.settle();

  const group = findElement(h.snapshot, node => node.props?.accessibilityRole === 'radiogroup');
  assert.ok(group, 'Deve existir um radiogroup de combustível');
  const radios = [...elements(group)].filter(node => node.props?.accessibilityRole === 'radio');
  assert.equal(radios.length, 2, 'Deve exibir exatamente os 2 combustíveis permitidos');
  assert.equal(radios[0].props.accessibilityState?.checked, true, 'Primeiro combustível permitido vem selecionado por padrão');
  assert.equal(radios[1].props.accessibilityState?.checked, false);
});

test('combustível incompatível é sanitizado no estado e no envio ao trocar de veículo', async () => {
  const vehicleFlex = { id: 'flex-car', nickname: 'Flex', allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'] };
  const vehicleDiesel = { id: 'diesel-truck', nickname: 'Diesel Truck', allowedFuels: ['DIESEL_S10'] };

  const calls = [];
  const h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', {
    gps: { getCurrentPositionAsync: async () => ({ coords: { latitude: -23.55, longitude: -46.63 } }) },
    endpoints: { createFuelEntry: async (id, payload) => { calls.push({ id, payload }); return { ...payload, idempotentReplay: false }; } },
  });
  h.session.vehicles = [vehicleFlex, vehicleDiesel];
  h.session.activeVehicle = vehicleFlex;
  h.render();
  await h.settle();
  await h.snapshot.requestLocation(true);
  await h.settle();

  h.snapshot.setFuelType('GASOLINE_REGULAR');
  h.snapshot.setLiters('35,0');
  h.snapshot.setUnitPrice('5,00');
  h.snapshot.setOdometerKm('50000');
  await h.settle();
  assert.equal(h.snapshot.fuelType, 'GASOLINE_REGULAR');

  // Troca para veículo que só aceita DIESEL_S10
  await h.switchVehicle('diesel-truck');
  await h.settle();
  assert.notEqual(h.snapshot.fuelType, 'GASOLINE_REGULAR', 'Combustível incompatível deve ser desmarcado');
  assert.equal(h.snapshot.fuelType, 'DIESEL_S10', 'Deve adotar combustível permitido pelo novo veículo');

  // Ao salvar o abastecimento no novo veículo, envia exatamente DIESEL_S10
  h.snapshot.setPaidTotal('240,00');
  h.snapshot.setLiters('40,0');
  h.snapshot.setUnitPrice('6,00');
  h.snapshot.setOdometerKm('51000');
  await h.settle();
  await h.snapshot.handleSubmit();
  await h.settle();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.fuelType, 'DIESEL_S10');
  assert.equal(calls[0].id, 'diesel-truck');
});

test('cálculo com desconto manual e payload exato sem separador de milhar', async () => {
  const calls = [];
  const h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', {
    gps: { getCurrentPositionAsync: async () => ({ coords: { latitude: -23.55052, longitude: -46.633308 } }) },
    endpoints: { createFuelEntry: async (id, payload) => { calls.push(payload); return { ...payload, idempotentReplay: false }; } },
  });
  await h.settle();
  await h.snapshot.requestLocation(true);
  await h.settle();

  // Litros 1 casa, preço 2 casas, odômetro inteiro 0
  h.snapshot.setLiters('35,1');
  h.snapshot.setUnitPrice('5,43');
  h.snapshot.setOdometerKm('120542');
  await h.settle();

  // Referência calculada 35.1 * 5.43 = 190.593... arredondado HALF_UP = 190.59
  assert.equal(h.snapshot.referenceTotalDot, '190.59');

  // Aplica desconto manual: pagou 180,00 (diferença de R$ 10,59 > R$ 0,05 exige justificativa)
  h.snapshot.setIsManualPaidTotal(true);
  h.snapshot.setPaidTotal('180,00');
  h.snapshot.setManualPaidTotal('180,00');
  await h.settle();
  assert.equal(h.snapshot.adjustmentInfo.requiresReason, true);

  // Tenta submeter sem justificativa
  await h.snapshot.handleSubmit();
  await h.settle();
  assert.equal(calls.length, 0, 'Deve bloquear envio sem justificativa para diferença acima de 5 centavos');
  assert.ok(h.snapshot.fieldErrors.adjustmentReason);

  // Preenche justificativa e envia
  h.snapshot.setAdjustmentReason('Desconto fidelidade do posto');
  await h.settle();
  await h.snapshot.handleSubmit();
  await h.settle();

  assert.equal(calls.length, 1);
  const sent = calls[0];
  assert.equal(sent.liters, '35.1');
  assert.equal(sent.unitPrice, '5.43');
  assert.equal(sent.paidTotal, '180.00');
  assert.equal(sent.odometerKm, 120542);
  assert.equal(typeof sent.odometerKm, 'number');
  assert.equal(sent.adjustmentReason, 'Desconto fidelidade do posto');
  assert.equal(sent.fuelType, 'ETHANOL');
});

test('rascunho inválido com excesso de escala ou negativo não é mascarado como válido', async () => {
  const invalidDraft = {
    id: randomUUID(),
    liters: '35,1234', // excesso de escala (4 casas para litros que aceita 3)
    unitPrice: '-5,00', // negativo
    odometerKm: '1000',
    dateStr: '2026-10-20',
    timeStr: '12:00',
    timezone: 'America/Sao_Paulo',
    fuelType: 'ETHANOL',
  };

  const calls = [];
  const h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', {
    store: new Map([[draftKey('A'), JSON.stringify(invalidDraft)]]),
    gps: { getCurrentPositionAsync: async () => ({ coords: { latitude: -23.55, longitude: -46.63 } }) },
    endpoints: { createFuelEntry: async (id, payload) => { calls.push(payload); } },
  });
  await h.settle();

  // Rascunho mantém os valores originais no estado sem silenciar/normalizar para válidos
  assert.equal(h.snapshot.liters, '35,1234');
  assert.equal(h.snapshot.unitPrice, '-5,00');

  // Ao tentar submeter, o formulário barra com erro explícito de validação
  await h.snapshot.handleSubmit();
  await h.settle();
  assert.equal(calls.length, 0, 'Não pode enviar rascunho com escala excessiva ou negativo');
  assert.ok(h.snapshot.fieldErrors.liters, 'Deve acusar erro em litros');
  assert.ok(h.snapshot.fieldErrors.unitPrice, 'Deve acusar erro no preço');
});

test('fechar no X do topo reseta o estado do formulário e limpa o rascunho', async () => {
  const store = new Map([[draftKey('A'), JSON.stringify({ id: randomUUID(), liters: '35,0', unitPrice: '5,00', odometerKm: '1000' })]]);
  const h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', {
    store,
  });
  await h.settle();
  assert.equal(h.snapshot.liters, '35,0');
  assert.equal(h.snapshot.unitPrice, '5,00');

  // Fecha no X do topo
  await h.snapshot.handleClose();
  await h.settle();

  // Estado é limpo imediatamente
  assert.equal(h.snapshot.liters, '');
  assert.equal(h.snapshot.unitPrice, '');
  assert.equal(h.snapshot.odometerKm, '');
  assert.equal(h.snapshot.manualPaidTotal, '');
  assert.equal(store.has(draftKey('A')), false, 'Rascunho deve ser removido do storage ao fechar');
});

test('sair por navegacao em NewFuelEntryScreen descarta rascunho e reseta o formulario', async () => {
  const store = new Map([[draftKey('A'), JSON.stringify({ id: randomUUID(), liters: '35,0', unitPrice: '5,00', odometerKm: '1000' })]]);
  const h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', {
    store,
  });
  await h.settle();
  assert.equal(h.snapshot.liters, '35,0');

  // Abre submodal e gera erro
  h.snapshot.setVehicleSheetOpen(true);
  h.snapshot.setErrorMessage('Erro temporário');
  await h.settle();
  assert.equal(h.snapshot.vehicleSheetOpen, true);
  assert.equal(h.snapshot.errorMessage, 'Erro temporário');

  // Aba perde foco / muda rota (isTabActive: false)
  h.activity.tabActive = false;
  h.render();
  await h.settle();

  // Submodais, erros transientes e campos sao descartados e rascunho e removido do storage
  assert.equal(h.snapshot.liters, '');
  assert.equal(h.snapshot.vehicleSheetOpen, false);
  assert.equal(h.snapshot.errorMessage, null);
  assert.equal(store.has(draftKey('A')), false, 'Rascunho de abastecimento deve ser descartado ao sair por navegacao');
});

test('minimizar app em NewFuelEntryScreen preserva rascunho', async () => {
  const store = new Map([[draftKey('A'), JSON.stringify({ id: randomUUID(), liters: '35,0', unitPrice: '5,00', odometerKm: '1000' })]]);
  const h = mount('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', {
    store,
  });
  await h.settle();
  assert.equal(h.snapshot.liters, '35,0');

  // App vai para segundo plano (appActive: false, tabActive: true)
  h.activity.appActive = false;
  h.render();
  await h.settle();

  assert.equal(h.snapshot.liters, '35,0');
  assert.equal(store.has(draftKey('A')), true, 'Rascunho deve ser preservado ao minimizar');
});
