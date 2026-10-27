import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

class ApiError extends Error {
  constructor(opts) {
    super(opts.message);
    Object.assign(this, opts);
  }
}

// 1. OpenAPI contract check for UpdateVehicleRequest
test('UpdateVehicleRequest: chaves HTTP e regras iguais a UpdateVehicle no OpenAPI', () => {
  const openapi = JSON.parse(readFileSync(new URL('../../contracts/openapi.json', import.meta.url), 'utf8'));
  const schema = openapi.components.schemas.UpdateVehicle;
  assert.ok(schema, 'Schema UpdateVehicle deve existir no OpenAPI');

  const source = ts.createSourceFile('types.ts', readFileSync(new URL('../src/api/types.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(s => ts.isInterfaceDeclaration(s) && s.name.text === 'UpdateVehicleRequest');
  assert.ok(declaration, 'Interface UpdateVehicleRequest deve existir em types.ts');

  const keys = declaration.members.map(m => m.name.text).sort();
  const schemaKeys = Object.keys(schema.properties).sort();
  assert.deepEqual(keys, schemaKeys, 'Campos da interface devem bater exatamente com as propriedades OpenAPI');
  assert.deepEqual([...schema.required].sort(), ['allowedFuels', 'model'].sort());
});

// Helper to load endpoints with mock transport
function loadEndpointsWithMock(mockApiRequest) {
  const modules = {
    './client': { apiRequest: mockApiRequest },
    './tokenStorage': { getSessionEpoch: () => 0, saveTokenPairAtomically: async () => {} },
  };
  const source = readFileSync(new URL('../src/api/endpoints.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(specifier => {
    if (specifier === './types') return { ApiError };
    if (modules[specifier]) return modules[specifier];
    throw new Error(`Unmapped: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

test('updateVehicle envia PUT, If-Match forte com aspas e body correto para o mesmo ID', async () => {
  const calls = [];
  const mockApi = async (options) => {
    calls.push(options);
    return {
      id: 'veh-123',
      nickname: 'Civic Turbo',
      model: 'Civic Turbo',
      allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'],
      version: 4,
      currentOdometerKm: 52000,
      tankCapacityLiters: '50.000',
      brand: 'Honda',
      modelYear: 2022,
      plate: 'ABC-1234',
      archivedAt: null,
    };
  };

  const endpoints = loadEndpointsWithMock(mockApi);
  const res = await endpoints.updateVehicle('veh-123', 3, {
    model: 'Civic Turbo',
    allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'],
    currentOdometerKm: 52000,
    tankCapacityLiters: '50.000',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].path, '/vehicles/veh-123');
  assert.equal(calls[0].headers['If-Match'], '"3"');
  assert.deepEqual(calls[0].body, {
    model: 'Civic Turbo',
    allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'],
    currentOdometerKm: 52000,
    tankCapacityLiters: '50.000',
  });
  assert.equal(res.id, 'veh-123');
  assert.equal(res.version, 4);
});

// Helper to mount VehicleFormSheet
function loadVehicleFormSheet(exportName, dependencies) {
  const path = new URL('../src/features/vehicles/VehicleFormSheet.tsx', import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindingNames = name => ts.isIdentifier(name) ? [name.text] : name.elements.flatMap(e => bindingNames(e.name));
  const transform = context => root => ts.visitNode(root, function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === exportName) {
      const names = node.body.statements.filter(ts.isVariableStatement)
        .flatMap(s => s.declarationList.declarations.flatMap(d => bindingNames(d.name)));
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
    if (dependencies[specifier]) return dependencies[specifier];
    return {};
  }, module, module.exports);
  return module.exports[exportName];
}

function mountSheet(props, sessionOverrides = {}, endpointOverrides = {}) {
  let index = 0;
  let dirty = false;
  let pendingEffects = [];
  const hooks = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

  const react = {
    createElement(type, p, ...children) {
      return typeof type === 'function' ? type({ ...p, children }) : { type, props: { ...p, children } };
    },
    useContext() { return {}; },
    useState(initial) {
      const i = index++;
      if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[i].value, val => {
        const next = typeof val === 'function' ? val(hooks[i].value) : val;
        if (!Object.is(next, hooks[i].value)) {
          hooks[i].value = next;
          dirty = true;
        }
      }];
    },
    useRef(initial) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useMemo(f, deps) { const i = index++; if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { value: f(), deps }; return hooks[i].value; },
    useCallback(cb, deps) { return react.useMemo(() => cb, deps); },
    useEffect(effect, deps) {
      const i = index++;
      if (!hooks[i] || !same(hooks[i].deps, deps)) pendingEffects.push(() => {
        hooks[i]?.cleanup?.();
        hooks[i] = { deps, effect, cleanup: effect?.() };
      });
    },
  };

  const session = {
    availableFuelTypes: ['GASOLINE_REGULAR', 'ETHANOL', 'DIESEL_S10'],
    createNewVehicle: async (p) => p,
    updateExistingVehicle: async (id, v, p) => ({ id, version: v + 1, ...p }),
    refreshVehicles: async () => [],
    showToast: () => {},
    ...sessionOverrides,
  };

  const Component = loadVehicleFormSheet('VehicleFormSheet', {
    react,
    'react-native': { StyleSheet: { create: s => s }, Text: 'Text', View: 'View', TextInput: 'TextInput', Pressable: 'Pressable' },
    '@/state/SessionContext': { useSession: () => session },
    '@/theme/ThemeProvider': { useAppTheme: () => ({ colors: {} }) },
    '@/theme/tokens': { radii: {}, typography: {} },
    '@/components/feedback/InlineNotice': { InlineNotice: 'InlineNotice' },
    '@/components/icons/AppIcons': { CheckIcon: 'CheckIcon', SaveIcon: 'SaveIcon' },
    '@/components/overlays/AppSheet': { AppSheet: 'AppSheet' },
    '@/components/ui/DecimalField': { DecimalField: 'DecimalField' },
    '@/components/ui/PrimaryButton': { PrimaryButton: 'PrimaryButton' },
    '@/utils/decimal': {
      parsePositiveDecimalInput: (val, maxDecimals = 3) => {
        const clean = String(val).trim().replace(',', '.');
        if (!clean || isNaN(clean) || Number(clean) <= 0) return { valid: false, errorReason: 'INVALID' };
        const parts = clean.split('.');
        if (parts[1] && parts[1].length > maxDecimals) return { valid: false, errorReason: 'EXCESSIVE_SCALE' };
        return { valid: true, normalizedDot: clean };
      },
    },
    '@/api/endpoints': {
      FUEL_TYPE_LABELS: { GASOLINE_REGULAR: 'Gasolina Comum', ETHANOL: 'Etanol', DIESEL_S10: 'Diesel S10' },
      getVehicle: async (id) => ({
        id,
        version: 99,
        nickname: 'Atualizado Servidor',
        model: 'Atualizado Servidor',
        allowedFuels: ['ETHANOL'],
        currentOdometerKm: 88888,
        tankCapacityLiters: '60.000',
      }),
      ...endpointOverrides,
    },
    '@/api/types': {
      ApiError,
    },
  });

  const harness = {
    snapshot: null,
    render() {
      index = 0;
      dirty = false;
      pendingEffects = [];
      harness.snapshot = Component(props);
      const effects = pendingEffects;
      for (const eff of effects) eff();
    },
    async settle() {
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setImmediate(r));
        if (dirty) harness.render();
      }
    },
  };

  harness.render();
  return harness;
}

test('edição preenche campos com veículo ativo e envia PUT com versão e mesmo ID', async () => {
  const active = {
    id: 'veh-42',
    nickname: 'Meu Captur',
    model: 'Captur Intense',
    allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'],
    version: 2,
    currentOdometerKm: 32000,
    tankCapacityLiters: '50.500',
    brand: 'Renault',
    modelYear: 2021,
    plate: 'BRA2E19',
    archivedAt: null,
  };

  const updateCalls = [];
  const createCalls = [];

  const h = mountSheet(
    { visible: true, mode: 'edit', vehicle: active, onClose() {}, onUpdated() {} },
    {
      updateExistingVehicle: async (id, version, payload) => {
        updateCalls.push({ id, version, payload });
        return { ...active, version: version + 1, ...payload };
      },
      createNewVehicle: async (payload) => {
        createCalls.push(payload);
        return payload;
      },
    },
  );

  await h.settle();

  assert.equal(h.snapshot.model, 'Captur Intense');
  assert.deepEqual(h.snapshot.selectedFuels, ['GASOLINE_REGULAR', 'ETHANOL']);
  assert.equal(h.snapshot.currentOdometerKm, '32000');
  assert.equal(h.snapshot.tankCapacity, '50,500');
  assert.equal(h.snapshot.formVersion, 2);

  // Alterar modelo e odômetro
  h.snapshot.setModel('Captur Iconic');
  h.snapshot.setCurrentOdometerKm('35000');
  await h.settle();

  await h.snapshot.handleSubmit();
  await h.settle();

  assert.equal(createCalls.length, 0, 'Nunca deve chamar POST de criação em modo edição');
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].id, 'veh-42', 'Deve atualizar o mesmo ID');
  assert.equal(updateCalls[0].version, 2, 'Deve enviar a versão carregada');
  assert.equal(updateCalls[0].payload.model, 'Captur Iconic');
  assert.equal(updateCalls[0].payload.currentOdometerKm, 35000);
});

test('erro 422 preserva dados digitados e exibe fieldErrors sem deslogar', async () => {
  const active = {
    id: 'veh-1',
    model: 'Carro',
    allowedFuels: ['ETHANOL'],
    version: 1,
  };

  const h = mountSheet(
    { visible: true, mode: 'edit', vehicle: active, onClose() {} },
    {
      updateExistingVehicle: async () => {
        throw new ApiError({
          status: 422,
          message: 'Erro de validação',
          problem: { fieldErrors: { model: 'Modelo inválido pelo servidor' } },
        });
      },
    },
  );

  await h.settle();

  h.snapshot.setModel('Novo Modelo Inválido');
  h.snapshot.setCurrentOdometerKm('12345');
  await h.settle();

  await h.snapshot.handleSubmit();
  await h.settle();

  assert.equal(h.snapshot.model, 'Novo Modelo Inválido', 'Dados digitados devem ser preservados');
  assert.equal(h.snapshot.currentOdometerKm, '12345', 'Odômetro digitado deve ser preservado');
  assert.equal(h.snapshot.fieldErrors.model, 'Modelo inválido pelo servidor');
  assert.equal(h.snapshot.submitting, false);
});

test('conflito 412 PRECONDITION_FAILED não sobrescreve e permite recarregar versão atual', async () => {
  const active = {
    id: 'veh-conflito',
    model: 'Versão Antiga',
    allowedFuels: ['GASOLINE_REGULAR'],
    version: 1,
  };

  const refreshedVehicles = [];
  const toasts = [];
  const h = mountSheet(
    { visible: true, mode: 'edit', vehicle: active, onClose() {} },
    {
      updateExistingVehicle: async () => {
        throw new ApiError({
          status: 412,
          message: 'Precondition Failed',
          problem: { code: 'PRECONDITION_FAILED' },
        });
      },
      refreshVehicles: async () => {
        refreshedVehicles.push(true);
      },
      showToast: (t) => {
        toasts.push(t);
      },
    },
    {
      getVehicle: async (id) => ({
        id,
        version: 5,
        model: 'Versão do Servidor',
        allowedFuels: ['ETHANOL'],
        currentOdometerKm: 99999,
        tankCapacityLiters: '48.000',
      }),
    },
  );

  await h.settle();

  h.snapshot.setModel('Minha Edição Concorrente');
  await h.settle();

  await h.snapshot.handleSubmit();
  await h.settle();

  assert.equal(h.snapshot.conflictDetected, true, 'Deve sinalizar conflito');
  assert.equal(h.snapshot.model, 'Minha Edição Concorrente', 'Não deve sobrescrever imediatamente dados digitados');

  // Usuário clica em carregar versão atual
  await h.snapshot.handleReloadLatest();
  await h.settle();

  assert.equal(h.snapshot.conflictDetected, false, 'Conflito deve ser desfeito');
  assert.equal(h.snapshot.model, 'Versão do Servidor');
  assert.deepEqual(h.snapshot.selectedFuels, ['ETHANOL']);
  assert.equal(h.snapshot.formVersion, 5, 'Versão do formulário atualizada para nova ETag');
  assert.equal(refreshedVehicles.length, 1);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].title, 'Versão atualizada');
  assert.equal(toasts[0].subtitle, 'Dados mais recentes carregados.');
});

test('modo criação continua independente e funcional sem regressão', async () => {
  const createCalls = [];
  const updateCalls = [];

  const h = mountSheet(
    { visible: true, mode: 'create', onClose() {}, onCreated() {} },
    {
      createNewVehicle: async (payload) => {
        createCalls.push(payload);
        return { id: 'veh-new', nickname: payload.nickname, version: 1 };
      },
      updateExistingVehicle: async () => {
        updateCalls.push(true);
      },
    },
  );

  await h.settle();

  assert.equal(h.snapshot.model, '');
  h.snapshot.setModel('Gol Quadrado');
  await h.settle();

  await h.snapshot.handleCreate();
  await h.settle();

  assert.equal(updateCalls.length, 0);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].nickname, 'Gol Quadrado');
  assert.equal(createCalls[0].model, 'Gol Quadrado');
  assert.equal(h.snapshot.model, '', 'Formulário de criação é resetado após sucesso');
});
