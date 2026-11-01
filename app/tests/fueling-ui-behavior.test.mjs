import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

function loadScreen(relativePath, exportName, dependencies, observableReturn = true) {
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
  }, module, module.exports, setTimeout, clearTimeout);
  return module.exports[exportName];
}

function loadUtility(name) {
  const module = { exports: {} };
  const output = ts.transpileModule(readFileSync(new URL(`../src/utils/${name}.ts`, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

function loadFeatureModule(relativePath, dependencies) {
  const path = new URL(`../src/${relativePath}`, import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const output = ts.transpileModule(source.text, {
    fileName: path.pathname,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(specifier => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    if (specifier === '../../utils/decimal' || specifier === '@/utils/decimal') return dependencies['@/utils/decimal'];
    if (specifier === '../../utils/numericMask' || specifier === '@/utils/numericMask') return dependencies['@/utils/numericMask'];
    throw Error(`Unmapped dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const date = loadUtility('date');
const decimal = loadUtility('decimal');
const location = loadUtility('location');
const numericMask = loadUtility('numericMask');
const vehicle = id => ({ id, nickname: id, allowedFuels: ['ETHANOL', 'GASOLINE_REGULAR'], brand: null, model: null, plate: null });

function mountNewFuelEntry({ store = new Map(), endpoints = {}, observableReturn = true, edit, uuid = randomUUID } = {}) {
  let index = 0;
  let dirty = false;
  let pendingEffects = [];
  const hooks = [];
  const writes = [];
  const navigation = [];
  const session = {
    status: 'authenticated',
    user: { id: 'user-1', preferredTimezone: 'America/Sao_Paulo' },
    vehicles: [vehicle('veh-1')],
    activeVehicle: vehicle('veh-1'),
    invalidateFuelData() {},
    showToast() {},
  };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement(type, props, ...children) {
      return typeof type === 'function' ? type({ ...props, children }) : { type, props: { ...props, children } };
    },
    useContext() { return true; },
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

  const stableResetLocation = () => {};
  const stableSetFixedCoordinates = () => {};
  const stableRequestLocation = async () => {};
  const stableOpenSettings = () => {};
  const stableLocationObj = {
    status: 'ready',
    coordinates: { latitude: -23.55, longitude: -46.63 },
    errorMessage: null,
    canAskAgain: true,
    requestLocation: stableRequestLocation,
    openSettings: stableOpenSettings,
    resetLocation: stableResetLocation,
    setFixedCoordinates: stableSetFixedCoordinates,
  };

  const dependencies = {
    react,
    'react-native': {
      StyleSheet: { create: styles => styles },
      Platform: { OS: 'android', select: map => map?.android ?? map?.default },
      View: 'View', Text: 'Text', Pressable: 'Pressable', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator',
    },
    'expo-router': { useRouter: () => ({ replace(path) { navigation.push(path); }, back() { navigation.push('back'); } }) },
    '@react-native-async-storage/async-storage': {
      getItem: async key => store.get(key) ?? null,
      setItem: async (key, value) => { writes.push({ key, value: JSON.parse(value) }); store.set(key, value); },
      removeItem: async key => { store.delete(key); },
    },
    '@/motion/useMotionPolicy': { useMotionPolicy: () => ({ isAppActive: true }) },
    '@/components/navigation/AuthenticatedTabShell': { TabActiveContext: {} },
    '@/api/endpoints': { FUEL_TYPE_LABELS: { ETHANOL: 'Etanol', GASOLINE_REGULAR: 'Gasolina comum' }, ...endpoints },
    '@/api/types': { ApiError },
    '@/state/SessionContext': { useSession: () => session },
    '@/theme/ThemeProvider': { useAppTheme: () => ({ colors: { surface: '#FFF', borderSubtle: '#EEE', brandPrimary: '#0066CC', textPrimary: '#111', textSecondary: '#666' }, isDark: false }) },
    '@/theme/tokens': { radii: {}, shadows: {}, typography: {} },
    '@/utils/date': date,
    '@/utils/decimal': decimal,
    '@/utils/location': location,
    '@/utils/uuid': { generateUuidV4: uuid },
    '@/features/vikash/useViKash': { useViKash: () => ({ status: null, catalog: null, error: null, loading: false, reload: async () => {} }) },
    '@/features/vikash/ViKashEntrySection': { ViKashEntrySection: () => null },
    '@/features/vikash/viKashChoices': { choicesError: () => null },
    '@/utils/numericMask': numericMask,
    '../../utils/numericMask': numericMask,
    './useForegroundLocation': {
      useForegroundLocation: () => stableLocationObj,
    },
  };
  dependencies['./fuelEditDateHelper'] = loadFeatureModule('features/fueling/fuelEditDateHelper.ts', dependencies);
  dependencies['./fuelingCalculations'] = loadFeatureModule('features/fueling/fuelingCalculations.ts', dependencies);
  dependencies['@/features/fueling/fuelingCalculations'] = dependencies['./fuelingCalculations'];

  dependencies['@/components/ui/FixedScaleInput'] = {
    FixedScaleInput: loadScreen('components/ui/FixedScaleInput.tsx', 'FixedScaleInput', dependencies, false),
  };
  const screen = loadScreen('features/fueling/FuelEntryForm.tsx', 'FuelEntryForm', dependencies, observableReturn);
  const harness = {
    session,
    store,
    writes,
    navigation,
    ApiError,
    snapshot: null,
    render() {
      index = 0;
      dirty = false;
      pendingEffects = [];
      harness.snapshot = screen({ edit });
      const effects = pendingEffects;
      effects.forEach(effect => effect());
    },
    async settle() {
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setImmediate(resolve));
        if (dirty) harness.render();
      }
    },
  };
  harness.render();
  return harness;
}

function findInput(node, label) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'TextInput' && node.props?.accessibilityLabel === label) return node;
  for (const child of node.props?.children?.flat(Infinity) ?? []) {
    const found = findInput(child, label);
    if (found) return found;
  }
  return null;
}

const savedEntry = (overrides = {}) => ({
  id: 'entry-1', vehicleId: 'veh-1', version: 7,
  liters: '10.123', unitPrice: '6.1234', paidTotal: '61.99', referenceTotal: '61.99',
  occurredAt: '2026-10-24T15:30:45.789Z', timezone: 'America/Manaus',
  odometerKm: 120500, fuelType: 'GASOLINE_REGULAR',
    adjustmentReason: null,
  latitude: -23.55052123, longitude: -46.63330876, ...overrides,
});

for (const overrides of [
  {},
  { paidTotal: '63.00', adjustmentReason: 'Ajuste histórico', latitude: null, longitude: null },
  { paidTotal: '60.00', adjustmentReason: 'Cupom do posto' },
]) {
  test(`edição: salvar sem alterar preserva valores reais e metadados (${overrides.paidTotal ?? '61.99'})`, async () => {
    const entry = savedEntry(overrides);
    const calls = [];
    const store = new Map([['fuellog.draft.fuel_entry.v1.user-1.veh-1', '{"liters":"99,999"}']]);
    const h = mountNewFuelEntry({
      store,
      uuid: () => assert.fail('Edição não gera UUID'),
      endpoints: { createFuelEntry: () => assert.fail('Edição não faz POST') },
      edit: { entry, save: async payload => calls.push(payload), reload: async () => {} },
    });
    await h.settle();
    assert.equal(h.snapshot.paidTotal, entry.paidTotal.replace('.', ','));
    assert.equal(h.snapshot.displayLiters, '10,123');
    assert.equal(h.snapshot.unitPrice, '6,1234');
    assert.equal(h.snapshot.dateStr, '2026-10-24');
    assert.equal(h.snapshot.timeStr, '11:30');
    assert.equal(h.snapshot.isDiscountActive, overrides.paidTotal === '60.00');
    assert.equal(h.snapshot.coordinates?.latitude ?? null, entry.latitude);
    await h.snapshot.handleSubmit();
    await h.settle();
    const { id, vehicleId, version, referenceTotal, ...expected } = entry;
    assert.deepEqual(calls, [expected]);
    for (const field of ['tankState', 'historyGapBefore', 'stationName', 'notes']) {
      assert.equal(Object.hasOwn(calls[0], field), false);
    }
    assert.equal(h.writes.length, 0, 'Edição não grava rascunho de novo');
    assert.equal(store.get('fuellog.draft.fuel_entry.v1.user-1.veh-1'), '{"liters":"99,999"}');
  });
}

test('edição: valores consistentes recalculam litros somente após alterar pago/preço; override e desconto usam mesmas regras de novo', async () => {
  const calls = [];
  const entry = savedEntry({ liters: '20.000', unitPrice: '5.0000', paidTotal: '100.00', referenceTotal: '100.00' });
  const h = mountNewFuelEntry({ edit: { entry, save: async payload => calls.push(payload), reload: async () => {} } });
  await h.settle();
  h.snapshot.handlePaidTotalChange('150,00');
  await h.settle();
  assert.equal(h.snapshot.liters, '30,000');
  h.snapshot.handleLitersChange('35,000');
  h.snapshot.handlePaidTotalChange('155,00');
  await h.settle();
  await h.snapshot.handleSubmit();
  await h.settle();
  assert.equal(calls.length, 0);
  assert.match(h.snapshot.fieldErrors.liters, /inconsistentes/);
  h.snapshot.handleToggleDiscount();
  await h.settle();
  await h.snapshot.handleSubmit();
  await h.settle();
  assert.equal(calls[0].liters, '35.000');
  assert.equal(calls[0].paidTotal, '155.00');
  assert.equal(calls[0].unitPrice, '5.0000');
  assert.equal(calls[0].adjustmentReason, 'Desconto');
});

test('edição: erro/412 retém todos os campos, bloqueia reenvio com versão antiga e cancelar não persiste', async () => {
  const calls = [];
  let cancelled = 0;
  const edit = { entry: savedEntry(), reload: async () => {}, cancel: () => { cancelled += 1; } };
  const h = mountNewFuelEntry({ edit });
  edit.save = async payload => { calls.push(payload); throw new h.ApiError({ status: 422, message: 'Hodômetro inválido', problem: { fieldErrors: { odometerKm: 'Entre vizinhos' } } }); };
  await h.settle();
  h.snapshot.setOdometerKm('121000');
  await h.settle();
  await h.snapshot.handleSubmit();
  await h.settle();
  assert.equal(h.snapshot.odometerKm, '121000');
  assert.equal(h.snapshot.fieldErrors.odometerKm, 'Entre vizinhos');
  edit.save = async payload => { calls.push(payload); throw new h.ApiError({ status: 412, message: 'Versão alterada' }); };
  await h.snapshot.handleSubmit();
  await h.settle();
  assert.equal(h.snapshot.staleConflict, true);
  assert.equal(h.snapshot.odometerKm, '121000');
  await h.snapshot.handleSubmit();
  assert.equal(calls.length, 2, 'Versão antiga bloqueada após 412');
  h.snapshot.handleClose();
  assert.equal(cancelled, 1);
  assert.equal(calls.length, 2, 'Cancelar não envia requisição');
  assert.equal(h.writes.length, 0);
});

test('edição: data/hora alterada usa fuso original, sem perder campos ocultos', async () => {
  const calls = [];
  const h = mountNewFuelEntry({ edit: { entry: savedEntry(), save: async payload => calls.push(payload), reload: async () => {} } });
  await h.settle();
  h.snapshot.setTimeStr('12:45');
  await h.settle();
  await h.snapshot.handleSubmit();
  assert.equal(calls[0].occurredAt, '2026-10-24T16:45:00.000Z');
  assert.equal(calls[0].timezone, 'America/Manaus');
});

test('NewFuelEntryScreen: preço digita centavos como valor pago, apaga, limpa e cola sem mudar magnitude', async () => {
  const h = mountNewFuelEntry({ observableReturn: false });
  await h.settle();
  const price = () => findInput(h.snapshot, 'Preço por litro');
  for (const [key, expected] of [['5', '0,05'], ['9', '0,59'], ['9', '5,99']]) {
    price().props.onChangeText(price().props.value + key);
    await h.settle();
    assert.equal(price().props.value, expected);
  }
  price().props.onChangeText(price().props.value.slice(0, -1));
  await h.settle();
  assert.equal(price().props.value, '0,59');
  price().props.onChangeText('');
  await h.settle();
  assert.equal(price().props.value, '');
  price().props.onChangeText('R$ 5,99');
  await h.settle();
  assert.equal(price().props.value, '5,99');
});

for (const unitPrice of ['5,4321', '5.439', '-5,00', '5,43211']) {
  test(`NewFuelEntryScreen: campo real preserva precisão e erros do rascunho ${unitPrice}`, async () => {
    const store = new Map([['fuellog.draft.fuel_entry.v1.user-1.veh-1', JSON.stringify({ id: randomUUID(), unitPrice })]]);
    const h = mountNewFuelEntry({ store, observableReturn: false });
    await h.settle();
    const price = () => findInput(h.snapshot, 'Preço por litro');
    assert.equal(price().props.value, unitPrice.replace('.', ','));
    if (unitPrice === '5,4321') {
      price().props.onChangeText('5,4329');
      await h.settle();
      assert.equal(price().props.value, '5,4329');
      assert.equal(JSON.parse(store.get('fuellog.draft.fuel_entry.v1.user-1.veh-1')).unitPrice, '5,4329');
    }
  });
}

test('NewFuelEntryScreen: cálculo automático de litros a partir de valor pago e preço por litro', async () => {
  const h = mountNewFuelEntry();
  await h.settle();

  // Digita Valor pago = 153,43 e Preço = 4,58 (caso do print)
  h.snapshot.handlePaidTotalChange('153,43');
  h.snapshot.handleUnitPriceChange('4,58');
  await h.settle();

  assert.equal(h.snapshot.paidTotal, '153,43');
  assert.equal(h.snapshot.unitPrice, '4,58');
  assert.equal(h.snapshot.liters, '33,500', 'Litros calculados automaticamente HALF_UP para 33,500 L');
  assert.equal(h.snapshot.displayLiters, '33,500');
});

test('NewFuelEntryScreen: override manual de litros preserva digitação após alteração posterior de pago/preço', async () => {
  const h = mountNewFuelEntry();
  await h.settle();

  // Digita pago e preço
  h.snapshot.handlePaidTotalChange('153,43');
  h.snapshot.handleUnitPriceChange('4,58');
  await h.settle();
  assert.equal(h.snapshot.liters, '33,500');

  // Usuário toca no número de litros e faz override manual para 35,000
  h.snapshot.handleLitersChange('35,000');
  await h.settle();
  assert.equal(h.snapshot.liters, '35,000');
  assert.equal(h.snapshot.isLitersManuallyOverridden, true);

  // Usuário altera Valor pago para 180,00 posteriormente
  h.snapshot.handlePaidTotalChange('180,00');
  await h.settle();

  // Litros JAMAIS devem ser recalculados após override!
  assert.equal(h.snapshot.liters, '35,000', 'Litros manuais preservados');
  assert.equal(h.snapshot.paidTotal, '180,00', 'Pago mantém exatamente o digitado');

  // Usuário altera Preço para 5,00 posteriormente
  h.snapshot.handleUnitPriceChange('5,00');
  await h.settle();
  assert.equal(h.snapshot.liters, '35,000', 'Litros continuam preservados após mudar preço');
});

test('NewFuelEntryScreen: checkbox desconto envia Desconto padrão e bloqueia sobrepreço', async () => {
  const calls = [];
  const h = mountNewFuelEntry({
    endpoints: {
      createFuelEntry: async (vehicleId, payload) => {
        calls.push({ vehicleId, payload });
        return { ...payload, idempotentReplay: false };
      },
    },
  });
  await h.settle();

  // Litros 30,000, preço 4,58 -> referência = 137.40
  h.snapshot.handleUnitPriceChange('4,58');
  h.snapshot.handleLitersChange('30,000');
  h.snapshot.setOdometerKm('50000');
  h.snapshot.setFuelType('ETHANOL');

  // Com desconto ativo e pago 130,00 (menor que 137.40)
  h.snapshot.handleToggleDiscount();
  h.snapshot.handlePaidTotalChange('130,00');
  await h.settle();
  assert.equal(h.snapshot.isDiscountActive, true);

  // Submete: envia motivo padrão "Desconto"
  await h.snapshot.handleSubmit();
  await h.settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.adjustmentReason, 'Desconto');
  assert.equal(calls[0].payload.paidTotal, '130.00');
  assert.equal(calls[0].payload.liters, '30.000');
});

test('NewFuelEntryScreen: desmarcar desconto preserva texto digitado para quando remarcar e envia null', async () => {
  const calls = [];
  const h = mountNewFuelEntry({
    endpoints: {
      createFuelEntry: async (vehicleId, payload) => {
        calls.push({ vehicleId, payload });
        return { ...payload, idempotentReplay: false };
      },
    },
  });
  await h.settle();

  // Ativa desconto e digita motivo personalizado
  h.snapshot.handleToggleDiscount();
  h.snapshot.setAdjustmentReason('Cupom posto 10%');
  await h.settle();
  assert.equal(h.snapshot.isDiscountActive, true);
  assert.equal(h.snapshot.adjustmentReason, 'Cupom posto 10%');

  // Desmarca desconto: desativa e guarda texto
  h.snapshot.handleToggleDiscount();
  await h.settle();
  assert.equal(h.snapshot.isDiscountActive, false);

  // Configura valores consistentes sem desconto
  h.snapshot.handlePaidTotalChange('153,43');
  h.snapshot.handleUnitPriceChange('4,58');
  h.snapshot.setOdometerKm('50000');
  h.snapshot.setFuelType('ETHANOL');
  await h.settle();

  // Ao salvar sem desconto, adjustmentReason no payload DEVE ser null
  await h.snapshot.handleSubmit();
  await h.settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.adjustmentReason, null);

  // Ao reativar o desconto, o motivo salvo 'Cupom posto 10%' é restaurado
  h.snapshot.handleToggleDiscount();
  await h.settle();
  assert.equal(h.snapshot.isDiscountActive, true);
  assert.equal(h.snapshot.adjustmentReason, 'Cupom posto 10%', 'Motivo salvo foi restaurado');
});

test('NewFuelEntryScreen: sem desconto, override manual inconsistente mantém digitação e mostra erro', async () => {
  const calls = [];
  const h = mountNewFuelEntry({
    endpoints: {
      createFuelEntry: async (vehicleId, payload) => {
        calls.push(payload);
        return { ...payload, idempotentReplay: false };
      },
    },
  });
  await h.settle();

  h.snapshot.handlePaidTotalChange('153,43');
  h.snapshot.handleUnitPriceChange('4,58');
  // Override inconsistente: 30,000 L (deveria ser 33,500)
  h.snapshot.handleLitersChange('30,000');
  h.snapshot.setOdometerKm('50000');
  h.snapshot.setFuelType('ETHANOL');
  await h.settle();

  // Tenta submeter sem desconto ativo
  await h.snapshot.handleSubmit();
  await h.settle();

  assert.equal(calls.length, 0, 'Submissão bloqueada por inconsistência');
  assert.ok(h.snapshot.fieldErrors.liters, 'Erro exibido no campo litros');
  assert.equal(h.snapshot.liters, '30,000', 'Digitação do usuário foi mantida intacta');
  assert.equal(h.snapshot.paidTotal, '153,43', 'Valor pago foi mantido intacto');
});

test('NewFuelEntryScreen: com desconto, bloqueia sobrepreço (pago > referência)', async () => {
  const calls = [];
  const h = mountNewFuelEntry({
    endpoints: {
      createFuelEntry: async (vehicleId, payload) => {
        calls.push(payload);
      },
    },
  });
  await h.settle();

  // Litros 30,000, preço 4,58 -> referência = 137.40
  h.snapshot.handleToggleDiscount();
  h.snapshot.handleUnitPriceChange('4,58');
  h.snapshot.handleLitersChange('30,000');
  // Pago 150,00 (maior que 137.40) -> sobrepreço com desconto!
  h.snapshot.handlePaidTotalChange('150,00');
  h.snapshot.setOdometerKm('50000');
  h.snapshot.setFuelType('ETHANOL');
  await h.settle();

  await h.snapshot.handleSubmit();
  await h.settle();

  assert.equal(calls.length, 0, 'Sobrepreço bloqueado');
  assert.ok(h.snapshot.fieldErrors.paidTotal, 'Erro exibido no campo valor pago');
  assert.match(h.snapshot.fieldErrors.paidTotal, /não pode superar o valor de referência/);
});

test('NewFuelEntryScreen: preço por litro aceita e preserva até 4 casas decimais', async () => {
  const calls = [];
  const h = mountNewFuelEntry({
    endpoints: {
      createFuelEntry: async (vehicleId, payload) => {
        calls.push(payload);
        return { ...payload, idempotentReplay: false };
      },
    },
  });
  await h.settle();

  // Preço 5,4321 e pago 50,00 -> quociente HALF_UP3 = 9,205
  h.snapshot.handlePaidTotalChange('50,00');
  h.snapshot.handleUnitPriceChange('5,4321');
  h.snapshot.setOdometerKm('50000');
  h.snapshot.setFuelType('ETHANOL');
  await h.settle();

  assert.equal(h.snapshot.liters, '9,205');
  await h.snapshot.handleSubmit();
  await h.settle();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].unitPrice, '5.4321', 'Preserva 4 casas decimais do preço');
  assert.equal(calls[0].liters, '9.205');
});

test('NewFuelEntryScreen: restore de rascunho legado sem isLitersManuallyOverridden preserva litros como manual', async () => {
  const draftKey = 'fuellog.draft.fuel_entry.v1.user-1.veh-1';
  // Rascunho v1 antigo: liters presente, sem isLitersManuallyOverridden, sem paidTotal (ou manualPaidTotal vazio)
  const legacyDraft = {
    id: randomUUID(),
    liters: '35,100',
    unitPrice: '5,00',
    manualPaidTotal: '',
    isManualPaidTotal: false,
    odometerKm: '10000',
    dateStr: '2026-10-20',
    timeStr: '12:00',
    timezone: 'America/Sao_Paulo',
    fuelType: 'ETHANOL',
  };

  const store = new Map([[draftKey, JSON.stringify(legacyDraft)]]);
  const h = mountNewFuelEntry({ store });
  await h.settle();

  assert.equal(h.snapshot.liters, '35,100');
  assert.equal(h.snapshot.isLitersManuallyOverridden, true, 'Deve inferir override manual no rascunho legado');

  // Alterar preço não pode sobrescrever os litros restaurados
  h.snapshot.handleUnitPriceChange('6,00');
  await h.settle();
  assert.equal(h.snapshot.liters, '35,100', 'Litros não podem ser recalculados após alteração de preço');
});

test('NewFuelEntryScreen: restore com isLitersManuallyOverridden: false explícito mantém recálculo automático', async () => {
  const draftKey = 'fuellog.draft.fuel_entry.v1.user-1.veh-1';
  const modernAutoDraft = {
    id: randomUUID(),
    liters: '20,000',
    paidTotal: '100,00',
    unitPrice: '5,00',
    isLitersManuallyOverridden: false,
    odometerKm: '10000',
    dateStr: '2026-10-20',
    timeStr: '12:00',
    timezone: 'America/Sao_Paulo',
    fuelType: 'ETHANOL',
  };

  const store = new Map([[draftKey, JSON.stringify(modernAutoDraft)]]);
  const h = mountNewFuelEntry({ store });
  await h.settle();

  assert.equal(h.snapshot.liters, '20,000');
  assert.equal(h.snapshot.isLitersManuallyOverridden, false, 'Mantém modo automático');

  // Alterar preço recalcula litros: 100 / 4 = 25,000 L
  h.snapshot.handleUnitPriceChange('4,00');
  await h.settle();
  assert.equal(h.snapshot.liters, '25,000', 'Litros recalculados automaticamente no modo automático');
});
