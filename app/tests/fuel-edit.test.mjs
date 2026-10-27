import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadTransport(options = {}) {
  let access = options.initialAccess ?? 'valid-access-token';
  let refresh = options.initialRefresh ?? 'valid-refresh-token';
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
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', outputText)((specifier) => {
      assert.ok(Object.hasOwn(modules, specifier), `Import não autorizado no loader: ${specifier}`);
      return modules[specifier];
    }, module, module.exports);
    modules[`./${name}`] = module.exports;
  }
  return { storage, endpoints: modules['./endpoints'], client: modules['./client'] };
}

test('UpdateFuelEntryRequest: chaves conferem com a especificação OpenAPI / DTO backend', () => {
  const source = ts.createSourceFile(
    'types.ts',
    readFileSync(new URL('../src/api/types.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (s) => s.name && s.name.text === 'UpdateFuelEntryRequest',
  );
  assert.ok(declaration, 'Interface UpdateFuelEntryRequest deve existir em types.ts');

  const keys = declaration.members.map((m) => m.name.text).sort();
  const expectedKeys = [
    'adjustmentReason',
    'fuelType',
    'historyGapBefore',
    'latitude',
    'liters',
    'longitude',
    'notes',
    'odometerKm',
    'occurredAt',
    'paidTotal',
    'stationName',
    'tankState',
    'timezone',
    'unitPrice',
  ].sort();

  assert.deepEqual(keys, expectedKeys);
  assert.equal(keys.includes('id'), false);
});

test('updateFuelEntry: envia PUT para a mesma URL com If-Match forte entre aspas e body correto', async () => {
  const { endpoints } = loadTransport();
  const vehicleId = '11111111-1111-1111-1111-111111111111';
  const entryId = '22222222-2222-2222-2222-222222222222';
  const originalVersion = 3;

  let capturedUrl = '';
  let capturedMethod = '';
  let capturedHeaders = {};
  let capturedBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedMethod = init.method;
    capturedHeaders = init.headers;
    capturedBody = JSON.parse(init.body);

    return new Response(
      JSON.stringify({
        id: entryId,
        vehicleId,
        occurredAt: capturedBody.occurredAt,
        timezone: capturedBody.timezone,
        odometerKm: capturedBody.odometerKm,
        fuelType: capturedBody.fuelType,
        liters: capturedBody.liters,
        unitPrice: capturedBody.unitPrice,
        paidTotal: capturedBody.paidTotal,
        referenceTotal: '61.99',
        adjustmentAmount: '-1.99',
        tankState: capturedBody.tankState,
        historyGapBefore: capturedBody.historyGapBefore,
        adjustmentReason: capturedBody.adjustmentReason,
        stationName: capturedBody.stationName,
        notes: capturedBody.notes,
        version: originalVersion + 1,
        idempotentReplay: false,
        latitude: capturedBody.latitude,
        longitude: capturedBody.longitude,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ETag: `"${originalVersion + 1}"`,
        },
      },
    );
  };

  try {
    const payload = {
      occurredAt: '2026-10-24T12:00:00Z',
      timezone: 'America/Sao_Paulo',
      odometerKm: 12500,
      fuelType: 'GASOLINE_REGULAR',
      liters: '10.123',
      unitPrice: '6.1234',
      paidTotal: '60.00',
      tankState: 'FULL',
      historyGapBefore: false,
      adjustmentReason: 'desconto especial',
      stationName: 'Posto Shell Histórico',
      notes: 'Nota original preservada',
      latitude: -23.55052,
      longitude: -46.633308,
    };

    const result = await endpoints.updateFuelEntry(vehicleId, entryId, originalVersion, payload);

    assert.equal(capturedMethod, 'PUT');
    assert.ok(capturedUrl.includes(`/vehicles/${vehicleId}/fuel-entries/${entryId}`));
    assert.equal(capturedHeaders['If-Match'], '"3"');
    assert.equal(capturedHeaders.Authorization, 'Bearer valid-access-token');

    // Body enviado preserva precisão e campos ocultos
    assert.equal(capturedBody.liters, '10.123');
    assert.equal(capturedBody.unitPrice, '6.1234');
    assert.equal(capturedBody.paidTotal, '60.00');
    assert.equal(capturedBody.odometerKm, 12500);
    assert.equal(capturedBody.stationName, 'Posto Shell Histórico');
    assert.equal(capturedBody.notes, 'Nota original preservada');
    assert.equal(capturedBody.latitude, -23.55052);
    assert.equal(capturedBody.longitude, -46.633308);
    assert.equal(capturedBody.id, undefined);

    // Resposta mantém mesmo UUID e avança a versão
    assert.equal(result.id, entryId);
    assert.equal(result.vehicleId, vehicleId);
    assert.equal(result.version, 4);
    assert.equal(result.paidTotal, '60.00');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateFuelEntry: normaliza ETag numérico fornecido como string com ou sem aspas', async () => {
  const { endpoints } = loadTransport();
  const vehicleId = '11111111-1111-1111-1111-111111111111';
  const entryId = '22222222-2222-2222-2222-222222222222';

  let capturedIfMatch = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    capturedIfMatch = init.headers['If-Match'];
    return new Response(JSON.stringify({ id: entryId, version: 10 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const dummyPayload = {
      occurredAt: '2026-10-24T12:00:00Z',
      timezone: 'America/Sao_Paulo',
      odometerKm: 5000,
      fuelType: 'ETHANOL',
      liters: '20.0',
      unitPrice: '3.50',
      paidTotal: '70.00',
    };

    // Chamada com número: 9 -> "\"9\""
    await endpoints.updateFuelEntry(vehicleId, entryId, 9, dummyPayload);
    assert.equal(capturedIfMatch, '"9"');

    // Chamada com string sem aspas: "9" -> "\"9\""
    await endpoints.updateFuelEntry(vehicleId, entryId, '9', dummyPayload);
    assert.equal(capturedIfMatch, '"9"');

    // Chamada com string já entre aspas: "\"9\"" -> "\"9\""
    await endpoints.updateFuelEntry(vehicleId, entryId, '"9"', dummyPayload);
    assert.equal(capturedIfMatch, '"9"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateFuelEntry: preserva ausência de coordenadas sem forçar GPS', async () => {
  const { endpoints } = loadTransport();
  const vehicleId = '11111111-1111-1111-1111-111111111111';
  const entryId = '33333333-3333-3333-3333-333333333333';

  let capturedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: entryId, version: 2, latitude: null, longitude: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const payloadWithoutGps = {
      occurredAt: '2026-10-24T12:00:00Z',
      timezone: 'America/Sao_Paulo',
      odometerKm: 8000,
      fuelType: 'DIESEL_S10',
      liters: '50.0',
      unitPrice: '5.99',
      paidTotal: '299.50',
      latitude: null,
      longitude: null,
    };

    const res = await endpoints.updateFuelEntry(vehicleId, entryId, 1, payloadWithoutGps);
    assert.equal(capturedBody.latitude, null);
    assert.equal(capturedBody.longitude, null);
    assert.equal(res.latitude, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateFuelEntry: 412 PRECONDITION_FAILED lança ApiError com status 412 e não sobrescreve', async () => {
  const { endpoints } = loadTransport();
  const vehicleId = '11111111-1111-1111-1111-111111111111';
  const entryId = '44444444-4444-4444-4444-444444444444';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        status: 412,
        title: 'Precondition Failed',
        detail: 'Abastecimento alterado; consulte novamente antes de editar.',
        code: 'PRECONDITION_FAILED',
      }),
      {
        status: 412,
        headers: { 'Content-Type': 'application/problem+json' },
      },
    );
  };

  try {
    const payload = {
      occurredAt: '2026-10-24T12:00:00Z',
      timezone: 'America/Sao_Paulo',
      odometerKm: 9000,
      fuelType: 'GASOLINE_REGULAR',
      liters: '30.0',
      unitPrice: '6.00',
      paidTotal: '180.00',
    };

    await assert.rejects(
      async () => {
        await endpoints.updateFuelEntry(vehicleId, entryId, 1, payload);
      },
      (err) => {
        assert.equal(err.name, 'ApiError');
        assert.equal(err.status, 412);
        assert.equal(err.problem?.code, 'PRECONDITION_FAILED');
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateFuelEntry: 422 VALIDATION_ERROR propaga fieldErrors detalhados', async () => {
  const { endpoints } = loadTransport();
  const vehicleId = '11111111-1111-1111-1111-111111111111';
  const entryId = '55555555-5555-5555-5555-555555555555';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        status: 422,
        title: 'Validation Error',
        detail: 'Verifique os campos.',
        code: 'VALIDATION_ERROR',
        fieldErrors: {
          odometerKm: 'Hodômetro deve ficar entre os vizinhos cronológicos.',
          fuelType: 'Combustível não permitido pelo veículo.',
        },
      }),
      {
        status: 422,
        headers: { 'Content-Type': 'application/problem+json' },
      },
    );
  };

  try {
    const payload = {
      occurredAt: '2026-10-24T12:00:00Z',
      timezone: 'America/Sao_Paulo',
      odometerKm: 999999,
      fuelType: 'DIESEL_S500',
      liters: '10.0',
      unitPrice: '5.00',
      paidTotal: '50.00',
    };

    await assert.rejects(
      async () => {
        await endpoints.updateFuelEntry(vehicleId, entryId, 1, payload);
      },
      (err) => {
        assert.equal(err.name, 'ApiError');
        assert.equal(err.status, 422);
        assert.equal(err.problem?.fieldErrors?.odometerKm, 'Hodômetro deve ficar entre os vizinhos cronológicos.');
        assert.equal(err.problem?.fieldErrors?.fuelType, 'Combustível não permitido pelo veículo.');
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateFuelEntry: 401 dispara single-flight refresh e repete o PUT com If-Match preservado', async () => {
  const { endpoints, storage } = loadTransport({
    initialAccess: 'expired-access-token',
    initialRefresh: 'valid-refresh-token',
  });
  const vehicleId = '11111111-1111-1111-1111-111111111111';
  const entryId = '66666666-6666-6666-6666-666666666666';

  let attempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes('/auth/refresh')) {
      return new Response(
        JSON.stringify({
          access_token: 'new-access-token',
          token_type: 'Bearer',
          expires_in: 900,
          access_expires_at: '2026-10-27T16:00:00Z',
          refresh_token: 'new-refresh-token',
          refresh_expires_at: '2026-11-27T16:00:00Z',
          session_id: 'sess-123',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    attempts += 1;
    if (attempts === 1) {
      assert.equal(init.headers.Authorization, 'Bearer expired-access-token');
      assert.equal(init.headers['If-Match'], '"5"');
      return new Response(JSON.stringify({ status: 401, title: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/problem+json' },
      });
    }

    assert.equal(init.headers.Authorization, 'Bearer new-access-token');
    assert.equal(init.headers['If-Match'], '"5"');
    return new Response(JSON.stringify({ id: entryId, version: 6 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const payload = {
      occurredAt: '2026-10-24T12:00:00Z',
      timezone: 'America/Sao_Paulo',
      odometerKm: 7000,
      fuelType: 'ETHANOL',
      liters: '15.0',
      unitPrice: '4.00',
      paidTotal: '60.00',
    };

    const res = await endpoints.updateFuelEntry(vehicleId, entryId, 5, payload);
    assert.equal(attempts, 2);
    assert.equal(res.id, entryId);
    assert.equal(res.version, 6);
    assert.equal(storage.getAccessToken(), 'new-access-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


function loadFuelEditDateHelper() {
  const source = readFileSync(new URL('../src/features/fueling/fuelEditDateHelper.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)((specifier) => {
    throw new Error(`Import não autorizado no helper: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

test('stripInsignificantZeros e countSignificantDecimals: remove zeros de 35.100 e 5.4300 para máscaras padrão 1/2 e preserva 35.125 e 5.4321 sem arredondar', () => {
  const {
    stripInsignificantZeros,
    countSignificantDecimals,
  } = loadFuelEditDateHelper();

  // Litros: 35.100 deve usar máscara padrão 1 (35,1), não 3
  const liters35100 = stripInsignificantZeros('35.100');
  assert.equal(liters35100, '35.1');
  const lScale35100 = Math.min(3, Math.max(1, countSignificantDecimals(liters35100)));
  assert.equal(lScale35100, 1);

  // Preço: 5.4300 deve usar máscara padrão 2 (5,43), não 4
  const price54300 = stripInsignificantZeros('5.4300');
  assert.equal(price54300, '5.43');
  const pScale54300 = Math.min(4, Math.max(2, countSignificantDecimals(price54300)));
  assert.equal(pScale54300, 2);

  // Preservação sem arredondar de 35.125 (3 casas em litros)
  const liters35125 = stripInsignificantZeros('35.125');
  assert.equal(liters35125, '35.125');
  const lScale35125 = Math.min(3, Math.max(1, countSignificantDecimals(liters35125)));
  assert.equal(lScale35125, 3);

  // Preservação sem arredondar de 5.4321 (4 casas em preço)
  const price54321 = stripInsignificantZeros('5.4321');
  assert.equal(price54321, '5.4321');
  const pScale54321 = Math.min(4, Math.max(2, countSignificantDecimals(price54321)));
  assert.equal(pScale54321, 4);

  // Zeros inteiros: 35.000 e 5.00
  const liters35000 = stripInsignificantZeros('35.000');
  assert.equal(liters35000, '35');
  assert.equal(Math.min(3, Math.max(1, countSignificantDecimals(liters35000))), 1);

  const price500 = stripInsignificantZeros('5.00');
  assert.equal(price500, '5');
  assert.equal(Math.min(4, Math.max(2, countSignificantDecimals(price500))), 2);
});

test('formatEntryDateForInput e parseDateTimeInTimezone: trata meia-noite sem gerar 24:00', () => {
  const {
    formatEntryDateForInput,
    parseDateTimeInTimezone,
  } = loadFuelEditDateHelper();

  // Meia-noite UTC formatada em UTC
  const formattedUtc = formatEntryDateForInput('2026-10-24T00:00:00.000Z', 'UTC');
  assert.equal(formattedUtc.dateStr, '2026-10-24');
  assert.equal(formattedUtc.timeStr, '00:00');
  assert.notEqual(formattedUtc.timeStr, '24:00');

  // Meia-noite em São Paulo (03:00 UTC) formatada no fuso America/Sao_Paulo
  const formattedSp = formatEntryDateForInput('2026-10-24T03:00:00.000Z', 'America/Sao_Paulo');
  assert.equal(formattedSp.dateStr, '2026-10-24');
  assert.equal(formattedSp.timeStr, '00:00');
  assert.notEqual(formattedSp.timeStr, '24:00');

  // Parse de 00:00 em São Paulo
  const parsed00 = parseDateTimeInTimezone('2026-10-24', '00:00', 'America/Sao_Paulo');
  assert.equal(parsed00, '2026-10-24T03:00:00.000Z');

  // Parse se usuário digitar 24:00: normaliza sem estourar hora
  const parsed24 = parseDateTimeInTimezone('2026-10-24', '24:00', 'America/Sao_Paulo');
  assert.equal(parsed24, '2026-10-24T03:00:00.000Z');
});

test('parseDateTimeInTimezone: mudança real de hora produz instante UTC correto considerando timezone do registro', () => {
  const { parseDateTimeInTimezone } = loadFuelEditDateHelper();

  // São Paulo (UTC-3): 15:30 -> 18:30 UTC
  const isoSp = parseDateTimeInTimezone('2026-10-24', '15:30', 'America/Sao_Paulo');
  assert.equal(isoSp, '2026-10-24T18:30:00.000Z');

  // Manaus (UTC-4): 12:00 -> 16:00 UTC
  const isoManaus = parseDateTimeInTimezone('2026-10-24', '12:00', 'America/Manaus');
  assert.equal(isoManaus, '2026-10-24T16:00:00.000Z');

  // UTC: 14:00 -> 14:00 UTC
  const isoUtc = parseDateTimeInTimezone('2026-10-24', '14:00', 'UTC');
  assert.equal(isoUtc, '2026-10-24T14:00:00.000Z');

  // Formato brasileiro DD/MM/AAAA 24/10/2026 às 15:30
  const isoBr = parseDateTimeInTimezone('24/10/2026', '15:30', 'America/Sao_Paulo');
  assert.equal(isoBr, '2026-10-24T18:30:00.000Z');
});

test('parseDateTimeInTimezone: rejeita lacuna de horário de verão (DST gap) retornando null sem salvar hora alterada', () => {
  const { parseDateTimeInTimezone } = loadFuelEditDateHelper();

  // 00:30 em 2018-11-04 não existiu no fuso America/Sao_Paulo (o relógio adiantou de 00:00 para 01:00)
  const result = parseDateTimeInTimezone('2018-11-04', '00:30', 'America/Sao_Paulo');
  assert.equal(result, null);
});

test('parseDateTimeInTimezone: fuso inválido ou indisponível retorna null no catch sem assumir UTC silenciosamente', () => {
  const { parseDateTimeInTimezone } = loadFuelEditDateHelper();

  const result = parseDateTimeInTimezone('2026-10-24', '15:30', 'Invalid/Timezone');
  assert.equal(result, null);
});

test('412 PRECONDITION_FAILED e recarga da versão mais recente: populateFromEntry atualiza todos os campos, precisão, metadados e versão', async () => {
  const { endpoints } = loadTransport();
  const { stripInsignificantZeros, countSignificantDecimals } = loadFuelEditDateHelper();
  const vehicleId = '11111111-1111-1111-1111-111111111111';
  const entryId = '77777777-7777-7777-7777-777777777777';

  // 1. Simula estado inicial do formulário editado pelo usuário
  let formState = {
    liters: '35.100',
    unitPrice: '5.4300',
    odometerKm: 120500,
    version: 1,
    stationName: 'Posto Antigo',
    latitude: -23.55052,
    longitude: -46.633308,
  };

  // 2. Simula resposta 412 quando tenta salvar com versão defasada
  let putAttempts = 0;
  let getCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      getCalls += 1;
      // Retorna a versão mais recente após alteração externa concorrente
      return new Response(
        JSON.stringify({
          id: entryId,
          vehicleId,
          occurredAt: '2026-10-24T14:00:00Z',
          timezone: 'America/Sao_Paulo',
          odometerKm: 121000,
          fuelType: 'ETHANOL',
          liters: '35.125', // Nova precisão legada
          unitPrice: '5.4321', // Nova precisão legada
          paidTotal: '190.80',
          referenceTotal: '190.80',
          adjustmentAmount: '0.00',
          tankState: 'PARTIAL',
          historyGapBefore: true,
          adjustmentReason: null,
          stationName: 'Posto Concorrente Atualizado',
          notes: 'Alterado externamente',
          version: 2,
          latitude: -23.56000,
          longitude: -46.64000,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"2"' } },
      );
    }

    putAttempts += 1;
    if (putAttempts === 1) {
      assert.equal(init.headers['If-Match'], '"1"');
      return new Response(
        JSON.stringify({ status: 412, title: 'Precondition Failed', code: 'PRECONDITION_FAILED' }),
        { status: 412, headers: { 'Content-Type': 'application/problem+json' } },
      );
    }

    assert.equal(init.headers['If-Match'], '"2"');
    const body = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        id: entryId,
        version: 3,
        ...body,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    // Primeiro PUT falha com 412
    await assert.rejects(
      async () => {
        await endpoints.updateFuelEntry(vehicleId, entryId, formState.version, {
          occurredAt: '2026-10-24T12:00:00Z',
          timezone: 'America/Sao_Paulo',
          odometerKm: formState.odometerKm,
          fuelType: 'GASOLINE_REGULAR',
          liters: '35.1',
          unitPrice: '5.43',
          paidTotal: '190.59',
          tankState: 'FULL',
          historyGapBefore: false,
          stationName: formState.stationName,
          latitude: formState.latitude,
          longitude: formState.longitude,
        });
      },
      (err) => err.status === 412,
    );

    // Na tela, os campos digitados foram preservados antes do clique em Recarregar
    assert.equal(formState.odometerKm, 120500);

    // Usuário clica explicitamente em "Recarregar versão mais recente":
    // Executa GET e populateFromEntry(latest)
    const latest = await endpoints.getFuelEntry(vehicleId, entryId);
    assert.equal(getCalls, 1);
    assert.equal(latest.version, 2);

    // populateFromEntry(latest) atualiza TODOS os campos:
    const cleanLiters = stripInsignificantZeros(latest.liters);
    const cleanUnitPrice = stripInsignificantZeros(latest.unitPrice);
    const lScale = Math.min(3, Math.max(1, countSignificantDecimals(cleanLiters)));
    const pScale = Math.min(4, Math.max(2, countSignificantDecimals(cleanUnitPrice)));

    formState = {
      liters: latest.liters,
      unitPrice: latest.unitPrice,
      odometerKm: latest.odometerKm,
      version: latest.version,
      stationName: latest.stationName,
      latitude: latest.latitude,
      longitude: latest.longitude,
      tankState: latest.tankState,
      historyGapBefore: latest.historyGapBefore,
      notes: latest.notes,
    };

    assert.equal(formState.version, 2);
    assert.equal(formState.odometerKm, 121000);
    assert.equal(formState.stationName, 'Posto Concorrente Atualizado');
    assert.equal(formState.latitude, -23.56000);
    assert.equal(formState.longitude, -46.64000);
    assert.equal(lScale, 3);
    assert.equal(pScale, 4);

    // Próximo PUT agora é enviado com a nova versão no If-Match ("2") e salva com sucesso
    const saved = await endpoints.updateFuelEntry(vehicleId, entryId, formState.version, {
      occurredAt: latest.occurredAt,
      timezone: latest.timezone,
      odometerKm: formState.odometerKm,
      fuelType: latest.fuelType,
      liters: formState.liters,
      unitPrice: formState.unitPrice,
      paidTotal: '190.80',
      tankState: formState.tankState,
      historyGapBefore: formState.historyGapBefore,
      stationName: formState.stationName,
      notes: formState.notes,
      latitude: formState.latitude,
      longitude: formState.longitude,
    });

    assert.equal(saved.version, 3);
    assert.equal(saved.odometerKm, 121000);
    assert.equal(saved.stationName, 'Posto Concorrente Atualizado');
    assert.equal(saved.latitude, -23.56000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
