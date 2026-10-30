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

function mountNewFuelEntry({ store = new Map(), endpoints = {} } = {}) {
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
    '@/utils/uuid': { generateUuidV4: randomUUID },
    '@/utils/numericMask': numericMask,
    '../../utils/numericMask': numericMask,
    './useForegroundLocation': {
      useForegroundLocation: () => stableLocationObj,
    },
  };
  dependencies['./fuelingCalculations'] = loadFeatureModule('features/fueling/fuelingCalculations.ts', dependencies);
  dependencies['@/features/fueling/fuelingCalculations'] = dependencies['./fuelingCalculations'];

  const screen = loadScreen('features/fueling/NewFuelEntryScreen.tsx', 'NewFuelEntryScreen', dependencies, true);
  const harness = {
    session,
    store,
    writes,
    navigation,
    snapshot: null,
    render() {
      index = 0;
      dirty = false;
      pendingEffects = [];
      harness.snapshot = screen();
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
