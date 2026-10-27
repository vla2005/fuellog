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
    tankState: 'FULL',
    historyGapBefore: false,
    adjustmentReason: null,
    stationName: 'Posto Shell Histórico',
    notes: 'Abastecido na rodovia',
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
  let putStatusCode = 200;
  let putErrorBody: any = null;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();

    if (url.includes('/auth/login')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          access_expires_at: '2026-10-27T18:00:00Z',
          refresh_token: 'mock-refresh-token',
          refresh_expires_at: '2026-11-27T18:00:00Z',
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

    if (url.includes('/vehicles') && !url.includes('/fuel-entries') && !url.includes('/summary') && !url.includes('/consumption-cycles')) {
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

    if (url.includes('/fuel-entries')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [currentEntry],
          page: 0,
          size: 30,
          totalElements: 1,
          totalPages: 1,
        }),
      });
    }

    if (url.includes('/consumption-cycles')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
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
  await page.goto('/login');
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
  await expect(page.getByRole('button', { name: 'Editar abastecimento' })).toBeVisible({ timeout: 10_000 });
}

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
  const editBtn = page.getByRole('button', { name: 'Editar abastecimento' });
  await editBtn.click();

  // Verifica que o formulário de edição abriu com título e dados preenchidos
  await expect(page.getByText('Editar abastecimento')).toBeVisible();
  // Valida que o UUID técnico foi removido do subtítulo e o rodapé técnico não está presente
  await expect(page.getByText(/ID [0-9a-fA-F]{8}/)).not.toBeVisible();
  await expect(page.getByText('Preserva dados e versão do abastecimento')).not.toBeVisible();
  const litersInput = page.getByLabel('Litros abastecidos');
  const priceInput = page.getByLabel('Preço por litro');
  const odoInput = page.getByLabel('Hodômetro atual (km inteiro)');

  await expect(litersInput).toHaveValue('45,0');
  await expect(priceInput).toHaveValue('5,89');
  await expect(odoInput).toHaveValue('120500');

  // Altera os valores
  await litersInput.fill('40,0'); // 40,0 L
  await priceInput.fill('6,00'); // 6,00 R$
  await odoInput.fill('120520'); // 120520 km

  // Salva as alterações
  const saveBtn = page.getByRole('button', { name: 'Salvar alterações' });
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();

  // Aguarda retorno ao detalhe
  await expect(page.getByRole('button', { name: 'Editar abastecimento' })).toBeVisible({ timeout: 10_000 });

  // Verifica que o PUT foi executado conforme o contrato
  const put = mockApi.getCapturedPut();
  expect(put).not.toBeNull();
  expect(put!.method).toBe('PUT');
  expect(put!.headers['if-match']).toBe('"3"');
  expect(put!.body.id).toBeUndefined();
  // Conserva exatamente o ISO original com segundos e milissegundos sem recalculá-lo
  expect(put!.body.occurredAt).toBe('2026-10-24T15:30:45.789Z');
  expect(put!.body.occurredAt.endsWith('.789Z')).toBe(true);
  expect(put!.body.timezone).toBe('America/Manaus');
  expect(put!.body.liters).toBe('40.0');
  expect(put!.body.unitPrice).toBe('6.00');
  expect(put!.body.paidTotal).toBe('240.00');
  expect(put!.body.odometerKm).toBe(120520);
  expect(put!.body.fuelType).toBe('GASOLINE_REGULAR');

  // Garante que campos ocultos e GPS histórico foram preservados no payload
  expect(put!.body.tankState).toBe('FULL');
  expect(put!.body.historyGapBefore).toBe(false);
  expect(put!.body.stationName).toBe('Posto Shell Histórico');
  expect(put!.body.notes).toBe('Abastecido na rodovia');
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
  await page.getByRole('button', { name: 'Editar abastecimento' }).click();

  // Verifica precisão preservada nos inputs
  const litersInput = page.getByLabel('Litros abastecidos');
  const priceInput = page.getByLabel('Preço por litro');
  await expect(litersInput).toHaveValue('10,123');
  await expect(priceInput).toHaveValue('6,1234');

  // Verifica que combustível legado fora de allowedFuels está disponível e selecionado
  const dieselRadio = page.getByRole('radio', { name: /Diesel S10/ });
  await expect(dieselRadio).toBeVisible();
  await expect(dieselRadio).toHaveAttribute('aria-checked', 'true');

  // Sem GPS: exibe aviso de coordenadas indisponíveis sem forçar captura
  await expect(
    page.getByText('Localização indisponível para este registro'),
  ).toBeVisible();

  // Salva mantendo os valores
  await page.getByRole('button', { name: 'Salvar alterações' }).click();

  // Aguarda retorno ao detalhe
  await expect(page.getByRole('button', { name: 'Editar abastecimento' })).toBeVisible({ timeout: 10_000 });

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
  await page.getByRole('button', { name: 'Editar abastecimento' }).click();

  const odoInput = page.getByLabel('Hodômetro atual (km inteiro)');
  const litersInput = page.getByLabel('Litros abastecidos');
  const priceInput = page.getByLabel('Preço por litro');

  await odoInput.fill('120999');

  await page.getByRole('button', { name: 'Salvar alterações' }).click();

  // Aviso de 412 visível explicando que a recarga substituirá os dados do formulário
  await expect(page.getByText('Abastecimento alterado')).toBeVisible();
  await expect(
    page.getByText('Ao recarregar a versão mais recente, os dados deste formulário serão substituídos'),
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
    stationName: 'Posto Novo Concorrente',
    notes: 'Nota sincronizada externamente',
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
  await expect(litersInput).toHaveValue('50,0');
  await expect(priceInput).toHaveValue('6,15');

  // Submete novo PUT
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('button', { name: 'Editar abastecimento' })).toBeVisible({ timeout: 10_000 });

  // Valida que o novo PUT utilizou a versão sincronizada no If-Match e os novos campos/GPS
  const put = mockApi.getCapturedPut();
  expect(put).not.toBeNull();
  expect(put!.headers['if-match']).toBe('"4"');
  expect(put!.body.odometerKm).toBe(121000);
  expect(put!.body.liters).toBe('50.0');
  expect(put!.body.stationName).toBe('Posto Novo Concorrente');
  expect(put!.body.notes).toBe('Nota sincronizada externamente');
  expect(put!.body.latitude).toBe(-23.56789);
  expect(put!.body.longitude).toBe(-46.65432);
});

test('Revisão visual e capturas de tela: 320px Dark e 390px Light', async ({
  page,
}) => {
  const initial = createMockEntry();
  await setupMockApi(page, initial);

  const resultsDir = path.resolve(__dirname, '../../test-results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  // 1. Captura 320px Dark Mode
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await loginAndGoToDetail(page);
  // Fecha toast de sessão se ainda estiver visível
  const toast = page.getByRole('alert');
  if (await toast.isVisible()) {
    await toast.click();
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: 'Editar abastecimento' }).click();
  await expect(page.getByText('Editar abastecimento')).toBeVisible();

  await page.screenshot({
    path: path.join(resultsDir, 'fuel-edit-320-dark.png'),
    fullPage: true,
  });

  // 2. Captura 390px Light Mode
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({
    path: path.join(resultsDir, 'fuel-edit-390-light.png'),
    fullPage: true,
  });
});
