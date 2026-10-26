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

const date = loadUtility('date');
const decimal = loadUtility('decimal');
const location = loadUtility('location');
const vehicle = id => ({ id, nickname: id, allowedFuels: ['ETHANOL'], brand: null, model: null, plate: null });
const period = { from: '2026-10-01', to: '2026-10-31', label: 'Outubro 2026', monthKey: '2026-10' };
const draftKey = id => `fuellog.draft.fuel_entry.v1.user.${id}`;
const draft = (id, liters = '35') => ({ id, liters, unitPrice: '6', manualPaidTotal: '', isManualPaidTotal: false,
  adjustmentReason: '', odometerKm: '1000', dateStr: '2026-10-20', timeStr: '12:00', timezone: 'America/Sao_Paulo',
  fuelType: 'ETHANOL', tankState: 'FULL', historyGapBefore: false, stationName: '', notes: '', showMoreDetails: false });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function mount(relativePath, exportName, { store = new Map(), endpoints = {}, gps = {}, clock = globalThis, props = {}, observableReturn = true } = {}) {
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
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
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
        hooks[i]?.cleanup?.(); hooks[i] = { deps, cleanup: effect() };
      });
    },
  };
  react.default = react;
  class ApiError extends Error { constructor(options) { super(options.message); Object.assign(this, options); } }
  const dependencies = {
    react, 'react-native': { StyleSheet: { create: styles => styles, absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } },
      Platform: { OS: 'android' }, Linking: { openURL: async url => { openedUrls.push(url); } }, View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator' },
    'react-native-webview': { WebView: 'NativeWebView' },
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
    '@/components/navigation/AuthenticatedTabShell': { TabActiveContext: {} },
    '@/motion/useMotionPolicy': { useMotionPolicy: () => ({ isAppActive: activity.appActive }) },
    '@/features/home/MonthlySummaryModal': {},
    '@/api/endpoints': { FUEL_TYPE_LABELS: {}, FUEL_TYPE_SHORT_LABELS: {}, TANK_STATE_LABELS: {}, TANK_STATE_SHORT_LABELS: {}, UNAVAILABLE_REASON_EXPLANATIONS: {}, ...endpoints },
    '@/api/types': { ApiError }, '@/state/SessionContext': { useSession: () => session },
    '@/api/tokenStorage': { getSessionEpoch: () => 0 },
    '@/theme/ThemeProvider': { useAppTheme: () => ({ colors: {}, isDark: false }) },
    '@/theme/tokens': { radii: {}, shadows: {}, typography: {} },
    '@/utils/date': date, '@/utils/decimal': decimal, '@/utils/location': location, '@/utils/uuid': { generateUuidV4: randomUUID },
  };
  dependencies['./useForegroundLocation'] = {
    useForegroundLocation: loadScreen('features/fueling/useForegroundLocation.ts', 'useForegroundLocation', dependencies, false, clock),
  };
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

test('mapa nativo preserva erro HTTP após fim do carregamento e permite nova tentativa', async () => {
  const errors = [];
  const coordinates = { latitude: -23.55052, longitude: -46.633308 };
  const h = mount('components/location/LocationMap.tsx', 'LocationMap', {
    props: { ...coordinates, onMapError: error => errors.push(error) }, observableReturn: false,
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
    webview().props.onHttpError({ nativeEvent: { statusCode: 503, description: 'Service unavailable', url: source } });
    await h.settle();
    webview().props.onLoadEnd?.({ nativeEvent: { url: source } });
    await h.settle();
    assert.ok(retry(), 'HTTP 503 permanece visível mesmo após onLoadEnd');
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

test('timeout do mapa permite retry e desmontagem cancela os temporizadores', async () => {
  let timerId = 0;
  const timers = new Map();
  const clock = {
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const errors = [];
  const h = mount('components/location/LocationMap.tsx', 'LocationMap', {
    clock, props: { latitude: 0, longitude: 0, onMapError: error => errors.push(error) }, observableReturn: false,
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
  } finally { h.unmount(); }
  assert.equal(timers.size, 0);
});

test('cadastro envia quilometragem opcional sem arredondar e preserva dados em falhas', async () => {
  for (const [input, expected] of [['', undefined], ['0', 0], ['45000', 45000], ['007', 7], ['-1', 'invalid'], ['1.5', 'invalid'], ['9007199254740993', 'invalid']]) {
    const calls = [];
    const h = mount('features/vehicles/VehicleFormSheet.tsx', 'VehicleFormSheet', {
      props: { visible: true, onClose() {}, onCreated() {} },
      endpoints: { createVehicle: async payload => { calls.push(payload); return vehicle('created'); } },
    });
    h.snapshot.setNickname('Meu carro');
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
  h.snapshot.setNickname('Meu carro');
  h.snapshot.setCurrentOdometerKm('45000');
  await h.settle();
  await h.snapshot.handleCreate();
  await h.settle();
  assert.equal(h.snapshot.nickname, 'Meu carro');
  assert.equal(h.snapshot.currentOdometerKm, '45000');
  assert.ok(h.snapshot.errorMessage);
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
