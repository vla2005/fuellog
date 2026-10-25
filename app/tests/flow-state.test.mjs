import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

// Execute the screen's real hooks, effects and handlers, replacing only its JSX
// return with an observable snapshot. This is a state regression, not visual E2E.
function loadScreen(relativePath, exportName, dependencies) {
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
    transformers: { before: [transform] },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(specifier => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    if (specifier.startsWith('@/components/') || specifier.includes('VehicleFormSheet')) return {};
    throw Error(`Unmapped dependency: ${specifier}`);
  }, module, module.exports);
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
const vehicle = id => ({ id, nickname: id, allowedFuels: ['ETHANOL'], brand: null, model: null, plate: null });
const period = { from: '2026-10-01', to: '2026-10-31', label: 'Outubro 2026', monthKey: '2026-10' };
const draftKey = id => `fuellog.draft.fuel_entry.v1.user.${id}`;
const draft = (id, liters = '35') => ({ id, liters, unitPrice: '6', manualPaidTotal: '', isManualPaidTotal: false,
  adjustmentReason: '', odometerKm: '1000', dateStr: '2026-10-20', timeStr: '12:00', timezone: 'America/Sao_Paulo',
  fuelType: 'ETHANOL', tankState: 'FULL', historyGapBefore: false, stationName: '', notes: '', showMoreDetails: false });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function mount(relativePath, exportName, { store = new Map(), endpoints = {} } = {}) {
  let index = 0;
  let dirty = false;
  let pendingEffects = [];
  const hooks = [];
  const writes = [];
  const session = { status: 'authenticated', user: { id: 'user', preferredTimezone: 'America/Sao_Paulo' }, vehicles: [vehicle('A'), vehicle('B')],
    activeVehicle: vehicle('A'), selectedPeriod: period, dataVersion: 0, invalidateFuelData() {}, showToast() {} };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
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
  class ApiError extends Error { constructor(options) { super(options.message); Object.assign(this, options); } }
  const dependencies = {
    react, 'react-native': { StyleSheet: { create: styles => styles } },
    '@react-native-async-storage/async-storage': {
      getItem: async key => store.get(key) ?? null,
      setItem: async (key, value) => { writes.push({ key, value: JSON.parse(value) }); store.set(key, value); },
      removeItem: async key => { store.delete(key); },
    },
    'expo-router': { useRouter: () => ({ replace() {}, push() {} }) },
    '@/api/endpoints': { FUEL_TYPE_LABELS: {}, FUEL_TYPE_SHORT_LABELS: {}, TANK_STATE_LABELS: {}, TANK_STATE_SHORT_LABELS: {}, UNAVAILABLE_REASON_EXPLANATIONS: {}, ...endpoints },
    '@/api/types': { ApiError }, '@/state/SessionContext': { useSession: () => session },
    '@/api/tokenStorage': { getSessionEpoch: () => 0 },
    '@/theme/ThemeProvider': { useAppTheme: () => ({ colors: {}, isDark: false }) },
    '@/theme/tokens': { radii: {}, shadows: {}, typography: {} },
    '@/utils/date': date, '@/utils/decimal': decimal, '@/utils/uuid': { generateUuidV4: randomUUID },
  };
  const screen = loadScreen(relativePath, exportName, dependencies);
  const harness = { session, store, writes, ApiError, snapshot: null,
    render() { index = 0; dirty = false; pendingEffects = []; harness.snapshot = screen(); const effects = pendingEffects; effects.forEach(effect => effect()); },
    async settle() { for (let i = 0; i < 12; i++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) harness.render(); } },
    async remountBeforeOldCleanup() {
      const cleanups = hooks.map(hook => hook?.cleanup).filter(Boolean);
      hooks.length = 0;
      harness.render();
      cleanups.forEach(cleanup => cleanup());
      await harness.settle();
    },
    async switchVehicle(id) { session.activeVehicle = session.vehicles.find(item => item.id === id); harness.render(); await harness.settle(); },
  };
  harness.render();
  return harness;
}

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
