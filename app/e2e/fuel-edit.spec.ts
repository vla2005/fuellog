import { fuelHistoryPage, purchaseDashboard } from './api-fixtures';
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const mockVehicle = {
  id: 'veh-1234-5678',
  nickname: 'Civic 2020',
  brand: 'Honda',
  model: 'Civic',
  modelYear: 2020,
  plate: 'ABC1D23',
  tankCapacityLiters: '50',
  allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'],
  archivedAt: null,
  version: 1,
  currentOdometerKm: 120500,
};

function createMockEntry(overrides = {}) {
  return {
    id: 'entry-9999-8888',
    vehicleId: mockVehicle.id,
    occurredAt: '2026-10-24T12:00:00Z',
    timezone: 'America/Sao_Paulo',
    odometerKm: 120500,
    fuelType: 'GASOLINE_REGULAR',
    liters: '45.0',
    unitPrice: '5.89',
    paidTotal: '265.05',
    referenceTotal: '265.05',
    adjustmentAmount: '0.00',


    adjustmentReason: null,


    version: 3,
    idempotentReplay: false,
    latitude: -23.55052,
    longitude: -46.633308,
    ...overrides,
  };
}

async function setupMockApi(page: Page, initialEntry: ReturnType<typeof createMockEntry>) {
  let currentEntry = { ...initialEntry };
  let capturedPutRequest: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any;
  } | null = null;
  const posts: any[] = [];
  const puts: any[] = [];
  let putStatusCode = 200;
  let putErrorBody: any = null;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.includes('/dashboard')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(purchaseDashboard()) });
    const method = request.method();

    if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          access_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          refresh_token: 'mock-refresh-token',
          refresh_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          session_id: 'mock-sess-1',
        }),
      });
    }

    if (url.includes('/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'user-1',
          name: 'Motorista Teste',
          email: 'motorista@example.test',
          preferredTimezone: 'America/Sao_Paulo',
        }),
      });
    }

    if (url.includes('/fuel-types')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(['GASOLINE_REGULAR', 'GASOLINE_ADDITIVE', 'ETHANOL', 'DIESEL_S10', 'DIESEL_S500']),
      });
    }

    if (url.includes('/vehicles') && !url.includes('/fuel-entries') && !url.includes('/summary')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockVehicle]),
      });
    }

    if (url.includes(`/vehicles/${mockVehicle.id}/fuel-entries/${currentEntry.id}`)) {
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { ETag: `"${currentEntry.version}"` },
          body: JSON.stringify(currentEntry),
        });
      }

      if (method === 'PUT') {
        capturedPutRequest = {
          url,
          method,
          headers: request.headers(),
          body: JSON.parse(request.postData() || '{}'),
        };

        puts.push(capturedPutRequest);
        if (putStatusCode !== 200) {
          return route.fulfill({
            status: putStatusCode,
            contentType: 'application/problem+json',
            body: JSON.stringify(putErrorBody),
          });
        }

        currentEntry = {
          ...currentEntry,
          ...capturedPutRequest.body,
          version: currentEntry.version + 1,
        };

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { ETag: `"${currentEntry.version}"` },
          body: JSON.stringify(currentEntry),
        });
      }
    }

    if (url.includes('/fuel-entries') && method === 'POST') {
      const body = request.postDataJSON();
      posts.push(body);
      return route.fulfill({ status: 201, contentType: 'application/json',
        body: JSON.stringify({ ...currentEntry, ...body, idempotentReplay: false, version: 0 }) });
    }
    if (url.includes('/fuel-entries')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fuelHistoryPage([currentEntry])),
      });
    }


    if (url.includes('/summary')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          vehicleId: mockVehicle.id,
          purchaseCount: 1,
          paidTotal: currentEntry.paidTotal,
          purchasedLiters: currentEntry.liters,
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  return {
    getCapturedPut: () => capturedPutRequest,
    posts, puts,
    setPutResponse: (status: number, body?: any) => {
      putStatusCode = status;
      putErrorBody = body;
    },
    getCurrentEntry: () => currentEntry,
    setCurrentEntry: (entry: any) => {
      currentEntry = { ...entry };
    },
  };
}

async function loginAndGoToDetail(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail', { exact: true }).fill('motorista@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('FuelLog-test-2026!');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  // Aguarda autenticar e carregar a Home
  await expect(page).toHaveURL(/\/\/?$/);

  // Navega pela aba Histórico para abrir o abastecimento
  await page.getByRole('tab', { name: 'Histórico', exact: true }).click();
  const entryCard = page.getByRole('button', { name: /^Abastecimento de R\$/ }).first();
  await expect(entryCard).toBeVisible({ timeout: 10_000 });
  await entryCard.click();

  // Aguarda carregar a tela de Detalhe
  await expect(page.getByRole('button', { name: 'Opções do abastecimento' })).toBeEnabled({ timeout: 10_000 });
}

async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Opções do abastecimento' }).click();
  await page.getByRole('menuitem', { name: 'Editar abastecimento' }).click();
  await expect(page.getByText('Editar abastecimento', { exact: true })).toBeVisible();
}

async function trackGpsRequests(page: Page) {
  await page.addInitScript(() => {
    (window as any).__gpsRequests = 0;
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (...args) => {
      (window as any).__gpsRequests += 1;
      return original(...args);
    };
  });
}

test('API mock: cancelar descarta edição; erro 422 preserva texto e permite tentar novamente sem POST ou GPS novo', async ({ page }) => {
  await trackGpsRequests(page);
  const initial = createMockEntry();
  const api = await setupMockApi(page, initial);
  await loginAndGoToDetail(page);
  await openEditor(page);
  const paid = page.getByLabel('Valor pago', { exact: true });
  await paid.fill('200,00');
  await page.getByRole('button', { name: 'Cancelar edição', exact: true }).click();
  expect(api.puts).toHaveLength(0);
  expect(api.posts).toHaveLength(0);
  await openEditor(page);
  await expect(paid).toHaveValue('265,05');
  const odometer = page.getByLabel('Hodômetro atual (km inteiro)');
  await odometer.fill('120999');
  api.setPutResponse(422, { status: 422, title: 'Validation error', detail: 'Verifique os campos.', code: 'VALIDATION_ERROR',
    fieldErrors: { odometerKm: 'Hodômetro deve ficar entre os vizinhos cronológicos.' } });
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Hodômetro deve ficar entre os vizinhos cronológicos.')).toBeVisible();
  await expect(odometer).toHaveValue('120999');
  await expect(paid).toHaveValue('265,05');
  api.setPutResponse(200);
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('button', { name: 'Opções do abastecimento' })).toBeEnabled();
  expect(api.puts).toHaveLength(2);
  expect(api.posts).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).__gpsRequests)).toBe(0);
});

for (const paidTotal of ['60.00', '63.00']) {
  test(`API mock: salvar legado divergente sem editar preserva total ${paidTotal}, precisão, desconto, data e campos ocultos`, async ({ page }) => {
    await trackGpsRequests(page);
    const initial = createMockEntry({ liters: '10.123', unitPrice: '6.1234', paidTotal, referenceTotal: '61.99',
      occurredAt: '2026-10-24T15:30:45.789Z', timezone: 'America/Manaus',
      adjustmentReason: paidTotal === '60.00' ? 'Cupom especial' : 'Ajuste histórico',
       latitude: -23.55052123, longitude: -46.63330876 });
    const api = await setupMockApi(page, initial);
    await loginAndGoToDetail(page);
    await openEditor(page);
    await expect(page.getByLabel('Valor pago', { exact: true })).toHaveValue(paidTotal.replace('.', ','));
    const checkbox = page.getByRole('checkbox', { name: 'Houve desconto no abastecimento' });
    if (paidTotal === '60.00') {
      await expect(checkbox).toBeChecked();
      await expect(page.getByLabel('Motivo do desconto')).toHaveValue('Cupom especial');
    } else {
      await expect(checkbox).not.toBeChecked();
      await expect(page.getByText(/Valores históricos preservados/)).toBeVisible();
    }
    await page.getByRole('button', { name: /^Data e hora do abastecimento:/ }).click();
    await expect(page.getByLabel('Data do abastecimento')).toHaveValue('2026-10-24');
    await expect(page.getByLabel('Hora do abastecimento', { exact: true })).toHaveValue('11:30');
    await expect(page.getByLabel('Fuso horário IANA')).toHaveValue('America/Manaus');
    await expect(page.getByLabel('Fuso horário IANA')).not.toBeEditable();
    await page.getByRole('button', { name: 'Confirmar data e hora' }).click();
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('button', { name: 'Opções do abastecimento' })).toBeEnabled();
    const { id, vehicleId, version, idempotentReplay, referenceTotal, adjustmentAmount, ...expected } = initial;
    expect(api.getCapturedPut()!.body).toEqual(expected);
    expect(api.posts).toHaveLength(0);
    expect(await page.evaluate(() => (window as any).__gpsRequests)).toBe(0);
  });
}

test('API mock: novo e editar compartilham ordem, geometria, estilos, máscaras e temas; criação mantém POST e GPS', async ({ page }) => {
  test.setTimeout(90_000);
  await trackGpsRequests(page);
  const api = await setupMockApi(page, createMockEntry());
  await loginAndGoToDetail(page);
  const resultsDir = path.resolve(__dirname, '../test-results');
  fs.mkdirSync(resultsDir, { recursive: true });

  const formMetrics = async () => {
    const selectors = [
      page.getByRole('radiogroup', { name: 'Combustível', exact: true }),
      page.getByLabel('Valor pago', { exact: true }),
      page.getByLabel('Preço por litro', { exact: true }),
      page.getByRole('checkbox', { name: 'Houve desconto no abastecimento' }),
      page.getByRole('button', { name: /^Litros calculados:/ }),
      page.getByLabel('Hodômetro atual (km inteiro)'),
      page.getByRole('button', { name: /^Data e hora do abastecimento:/ }),
    ];
    return Promise.all(selectors.map(locator => locator.filter({ visible: true }).evaluate(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const surface = getComputedStyle(element.parentElement!);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        color: style.color, fontSize: style.fontSize, fontFamily: style.fontFamily,
        padding: style.padding, borderRadius: style.borderRadius,
        background: surface.backgroundColor, border: surface.borderColor };
    })));
  };

  for (const [scheme, width, height] of [['light', 390, 844], ['dark', 320, 640]] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/fueling/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Novo abastecimento', { exact: true })).toBeVisible();
    await page.getByLabel('Valor pago', { exact: true }).fill('265,05');
    await page.getByLabel('Preço por litro', { exact: true }).fill('5,89');
    await page.getByLabel('Hodômetro atual (km inteiro)').fill('120500');
    await page.getByText('Novo abastecimento', { exact: true }).click();
    await expect(page.getByRole('button', { name: /^Litros calculados:/ })).toContainText('45,000');
    await expect(page.getByRole('button', { name: 'Salvar abastecimento', exact: true })).toBeEnabled();
    await expect(page.getByRole('tab')).toHaveCount(0);
    const fresh = await formMetrics();
    expect(fresh[0].y).toBeLessThan(fresh[1].y);
    expect(fresh[1].y).toBe(fresh[2].y);
    expect(fresh[1].x).toBeLessThan(fresh[2].x);
    expect(fresh[2].y).toBeLessThan(fresh[3].y);
    expect(fresh[3].y).toBeLessThan(fresh[4].y);
    expect(fresh[4].y).toBeLessThan(fresh[5].y);
    for (const metric of fresh) expect(metric.x + metric.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: path.join(resultsDir, `fuel-form-new-${width}-${scheme}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Salvar abastecimento', exact: true }).click();
    await expect(page).toHaveURL(/\/\/?$/);
    await page.getByRole('tab', { name: 'Histórico', exact: true }).click();
    await page.getByRole('button', { name: /^Abastecimento de R\$/ }).first().click();
    await openEditor(page);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Veículo:/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Recapturar localização atual' })).toHaveCount(0);
    const edited = await formMetrics();
    expect(edited).toEqual(fresh);
    await page.screenshot({ path: path.join(resultsDir, `fuel-form-edit-${width}-${scheme}.png`), fullPage: true });
    await page.getByRole('button', { name: /^Litros calculados:/ }).click();
    const liters = page.getByLabel('Litros calculados', { exact: true });
    await liters.fill('');
    await liters.pressSequentially('35000');
    await expect(liters).toHaveValue('35,000');
    await liters.press('Backspace');
    await expect(liters).toHaveValue('3,500');
    await page.getByRole('button', { name: 'Cancelar edição', exact: true }).click();
  }
  expect(api.posts).toHaveLength(2);
  expect(api.puts).toHaveLength(0);
  for (const body of api.posts) {
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.paidTotal).toBe('265.05');
    expect(body.unitPrice).toBe('5.89');
    expect(body.liters).toBe('45.000');
    expect(body.latitude).toBe(-23.55052);
    expect(body.longitude).toBe(-46.633308);
  }
  expect(api.posts[0].id).not.toBe(api.posts[1].id);
  expect(await page.evaluate(() => (window as any).__gpsRequests)).toBeGreaterThan(0);
});

test('Edição de abastecimento: abre form preenchido, envia PUT com If-Match preservando occurredAt com segundos/ms de outro fuso, dados ocultos/GPS e atualiza detalhe', async ({
  page,
}) => {
  // Registro original com segundos, milissegundos e fuso America/Manaus; navegador roda em America/Sao_Paulo
  const initial = createMockEntry({
    occurredAt: '2026-10-24T15:30:45.789Z',
    timezone: 'America/Manaus',
  });
  const mockApi = await setupMockApi(page, initial);

  await loginAndGoToDetail(page);

  // Valida que estamos no Detalhe do abastecimento
  await expect(page.getByText('R$ 265,05').filter({ visible: true })).toBeVisible();

  // Clica no botão "Editar abastecimento"
  await page.getByRole('button', { name: 'Opções do abastecimento' }).click();
  const editBtn = page.getByRole('menuitem', { name: 'Editar abastecimento' });
  await editBtn.click();

  // Verifica que o formulário de edição abriu com título e dados preenchidos
  await expect(page.getByText('Editar abastecimento')).toBeVisible();
  // Valida que o UUID técnico foi removido do subtítulo e o rodapé técnico não está presente
  await expect(page.getByText(/ID [0-9a-fA-F]{8}/)).not.toBeVisible();
  await expect(page.getByText('Preserva dados e versão do abastecimento')).not.toBeVisible();
  await page.getByRole('button', { name: /^Litros calculados:/ }).click();
  const litersInput = page.getByLabel('Litros calculados', { exact: true });
  const priceInput = page.getByLabel('Preço por litro', { exact: true });
  const odoInput = page.getByLabel('Hodômetro atual (km inteiro)');

  await expect(litersInput).toHaveValue('45,000');
  await expect(priceInput).toHaveValue('5,89');
  await expect(odoInput).toHaveValue('120500');

  // Altera os valores
  await litersInput.fill('40,0'); // 40,0 L
  await priceInput.fill('6,00'); // 6,00 R$
  await page.getByLabel('Valor pago', { exact: true }).fill('240,00');
  await odoInput.fill('120520'); // 120520 km

  // Salva as alterações
  const saveBtn = page.getByRole('button', { name: 'Salvar alterações' });
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();

  // Aguarda retorno ao detalhe
  await expect(page.getByRole('button', { name: 'Opções do abastecimento' })).toBeEnabled({ timeout: 10_000 });

  // Verifica que o PUT foi executado conforme o contrato
  const put = mockApi.getCapturedPut();
  expect(put).not.toBeNull();
  expect(put!.method).toBe('PUT');
  expect(mockApi.posts).toHaveLength(0);
  expect(put!.headers['if-match']).toBe('"3"');
  expect(put!.body.id).toBeUndefined();
  // Conserva exatamente o ISO original com segundos e milissegundos sem recalculá-lo
  expect(put!.body.occurredAt).toBe('2026-10-24T15:30:45.789Z');
  expect(put!.body.occurredAt.endsWith('.789Z')).toBe(true);
  expect(put!.body.timezone).toBe('America/Manaus');
  expect(put!.body.liters).toBe('40.000');
  expect(put!.body.unitPrice).toBe('6.00');
  expect(put!.body.paidTotal).toBe('240.00');
  expect(put!.body.odometerKm).toBe(120520);
  expect(put!.body.fuelType).toBe('GASOLINE_REGULAR');

  // Garante que campos ocultos e GPS histórico foram preservados no payload
  expect(put!.body.latitude).toBe(-23.55052);
  expect(put!.body.longitude).toBe(-46.633308);

  // Retornou ao detalhe com os dados atualizados
  await expect(page.getByText('Abastecimento atualizado')).toBeVisible();
  await expect(page.getByText('R$ 240,00', { exact: true }).filter({ visible: true })).toBeVisible();
});

test('Edição de abastecimento: preserva alta precisão legada (3 casas litros, 4 preço) e combustível legado', async ({
  page,
}) => {
  const legacyEntry = createMockEntry({
    id: 'entry-legacy-precise',
    liters: '10.123',
    unitPrice: '6.1234',
    paidTotal: '61.99',
    referenceTotal: '61.99',
    fuelType: 'DIESEL_S10', // Não está em mockVehicle.allowedFuels
    latitude: null, // Legado sem GPS
    longitude: null,
  });

  const mockApi = await setupMockApi(page, legacyEntry);
  await loginAndGoToDetail(page);

  // Clica em Editar
  await page.getByRole('button', { name: 'Opções do abastecimento' }).click();
  await page.getByRole('menuitem', { name: 'Editar abastecimento' }).click();

  // Verifica precisão preservada nos inputs
  await page.getByRole('button', { name: /^Litros calculados:/ }).click();
  const litersInput = page.getByLabel('Litros calculados', { exact: true });
  const priceInput = page.getByLabel('Preço por litro', { exact: true });
  await expect(litersInput).toHaveValue('10,123');
  await expect(priceInput).toHaveValue('6,1234');

  // Verifica que combustível legado fora de allowedFuels está disponível e selecionado
  const dieselRadio = page.getByRole('radio', { name: /Diesel S-?10/ });
  await expect(dieselRadio).toBeVisible();
  await expect(dieselRadio).toHaveAttribute('aria-checked', 'true');

  // Sem GPS: exibe aviso de coordenadas indisponíveis sem forçar captura
  await expect(
    page.getByText(/Localização indisponível para este registro/),
  ).toBeVisible();

  // Salva mantendo os valores
  await page.getByRole('button', { name: 'Salvar alterações' }).click();

  // Aguarda retorno ao detalhe
  await expect(page.getByRole('button', { name: 'Opções do abastecimento' })).toBeEnabled({ timeout: 10_000 });

  const put = mockApi.getCapturedPut();
  expect(put).not.toBeNull();
  expect(put!.body.liters).toBe('10.123');
  expect(put!.body.unitPrice).toBe('6.1234');
  expect(put!.body.fuelType).toBe('DIESEL_S10');
  expect(put!.body.latitude).toBeNull();
  expect(put!.body.longitude).toBeNull();
});

test('Edição de abastecimento: erro 412 PRECONDITION_FAILED retém digitação, recarga atualiza todos os campos/GPS e novo PUT usa versão sincronizada', async ({
  page,
}) => {
  const initial = createMockEntry();
  const mockApi = await setupMockApi(page, initial);
  mockApi.setPutResponse(412, {
    status: 412,
    code: 'PRECONDITION_FAILED',
    title: 'Precondition Failed',
    detail: 'Abastecimento alterado; consulte novamente antes de editar.',
  });

  await loginAndGoToDetail(page);
  await page.getByRole('button', { name: 'Opções do abastecimento' }).click();
  await page.getByRole('menuitem', { name: 'Editar abastecimento' }).click();

  const odoInput = page.getByLabel('Hodômetro atual (km inteiro)');
  const litersInput = page.getByLabel('Litros calculados', { exact: true });
  const priceInput = page.getByLabel('Preço por litro', { exact: true });

  await odoInput.fill('120999');

  await page.getByRole('button', { name: 'Salvar alterações' }).click();

  // Aviso de 412 visível explicando que a recarga substituirá os dados do formulário
  await expect(page.getByText(/Abastecimento alterado/).first()).toBeVisible();
  await expect(
    page.getByText(/Ao recarregar a versão mais recente/),
  ).toBeVisible();

  // Valores digitados pelo usuário foram retidos antes da ação de recarga
  await expect(odoInput).toHaveValue('120999');

  // Simula que o backend agora possui nova versão concorrente (v4) com novo hodômetro, GPS e posto
  mockApi.setCurrentEntry({
    ...initial,
    version: 4,
    odometerKm: 121000,
    liters: '50.0',
    unitPrice: '6.15',
    paidTotal: '307.50',
    referenceTotal: '307.50',


    latitude: -23.56789,
    longitude: -46.65432,
  });
  mockApi.setPutResponse(200);

  // Ação explícita de recarregar versão mais recente
  const reloadBtn = page.getByRole('button', { name: 'Recarregar versão mais recente' });
  await expect(reloadBtn).toBeVisible();
  await reloadBtn.click();

  // Todos os campos visíveis foram atualizados com o GET concorrente
  await expect(odoInput).toHaveValue('121000');
  await page.getByRole('button', { name: /^Litros calculados:/ }).click();
  await expect(litersInput).toHaveValue('50,000');
  await expect(priceInput).toHaveValue('6,15');

  // Submete novo PUT
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('button', { name: 'Opções do abastecimento' })).toBeEnabled({ timeout: 10_000 });

  // Valida que o novo PUT utilizou a versão sincronizada no If-Match e os novos campos/GPS
  const put = mockApi.getCapturedPut();
  expect(put).not.toBeNull();
  expect(put!.headers['if-match']).toBe('"4"');
  expect(put!.body.odometerKm).toBe(121000);
  expect(put!.body.liters).toBe('50.0');
  expect(put!.body.latitude).toBe(-23.56789);
  expect(put!.body.longitude).toBe(-46.65432);
});
