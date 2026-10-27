import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const INITIAL_VEHICLE = {
  id: '77777777-7777-7777-7777-777777777777',
  nickname: 'Captur Turbo',
  brand: 'Renault',
  model: 'Captur Turbo',
  modelYear: 2022,
  plate: 'BRA2E19',
  tankCapacityLiters: '50.000',
  allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'],
  archivedAt: null,
  version: 1,
  currentOdometerKm: 45000,
};

function setupMockApi(page: Page, vehicleState: { current: typeof INITIAL_VEHICLE }) {
  const recordedPuts: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const recordedPosts: Array<{ url: string; body: any }> = [];

  let failNextPutWithStatus: number | null = null;

  page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();

    if (url.includes('/auth/login') || url.includes('/auth/register')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'fake-jwt-token-for-e2e',
          refresh_token: 'fake-refresh-token-for-e2e',
          token_type: 'Bearer',
          expires_in: 900,
          access_expires_at: '2026-10-27T14:00:00Z',
          refresh_expires_at: '2026-11-27T14:00:00Z',
          session_id: 'session-e2e',
        }),
      });
    }

    if (url.includes('/auth/refresh')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'fake-jwt-token-for-e2e-refreshed',
          refresh_token: 'fake-refresh-token-for-e2e-refreshed',
          token_type: 'Bearer',
          expires_in: 900,
          access_expires_at: '2026-10-27T14:00:00Z',
          refresh_expires_at: '2026-11-27T14:00:00Z',
          session_id: 'session-e2e',
        }),
      });
    }

    if (url.includes('/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'user-e2e-uuid',
          name: 'Usuário E2E',
          email: 'e2e@fuellog.test',
          preferredTimezone: 'America/Sao_Paulo',
        }),
      });
    }

    if (url.includes('/fuel-types')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          'GASOLINE_REGULAR',
          'GASOLINE_ADDITIVE',
          'ETHANOL',
          'DIESEL_S10',
          'DIESEL_S500',
        ]),
      });
    }

    if (url.endsWith('/vehicles') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([vehicleState.current]),
      });
    }

    if (url.endsWith('/vehicles') && method === 'POST') {
      const data = JSON.parse(request.postData() ?? '{}');
      recordedPosts.push({ url, body: data });
      const newVehicle = {
        id: '88888888-8888-8888-8888-888888888888',
        nickname: data.model || data.nickname,
        model: data.model,
        brand: data.brand ?? null,
        modelYear: data.modelYear ?? null,
        plate: data.plate ?? null,
        tankCapacityLiters: data.tankCapacityLiters ?? null,
        allowedFuels: data.allowedFuels ?? ['GASOLINE_REGULAR'],
        archivedAt: null,
        version: 1,
        currentOdometerKm: data.currentOdometerKm ?? null,
      };
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: { ETag: '"1"' },
        body: JSON.stringify(newVehicle),
      });
    }

    if (url.includes(`/vehicles/${vehicleState.current.id}`) && method === 'PUT') {
      const headers = request.headers();
      const body = JSON.parse(request.postData() ?? '{}');
      recordedPuts.push({ url, headers, body });

      if (failNextPutWithStatus === 422) {
        failNextPutWithStatus = null;
        return route.fulfill({
          status: 422,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            title: 'Erro de validação',
            status: 422,
            detail: 'Verifique os dados informados.',
            fieldErrors: { model: 'Modelo não aceito pelo servidor.' },
          }),
        });
      }

      if (failNextPutWithStatus === 412) {
        failNextPutWithStatus = null;
        return route.fulfill({
          status: 412,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            title: 'Precondition Failed',
            code: 'PRECONDITION_FAILED',
            status: 412,
            detail: 'Veículo alterado; recarregue antes de salvar.',
          }),
        });
      }

      const ifMatch = headers['if-match'];
      if (!ifMatch) {
        return route.fulfill({
          status: 428,
          contentType: 'application/problem+json',
          body: JSON.stringify({ title: 'Precondition Required', status: 428 }),
        });
      }

      const expectedVersion = `"${vehicleState.current.version}"`;
      if (ifMatch !== expectedVersion) {
        return route.fulfill({
          status: 412,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            title: 'Precondition Failed',
            code: 'PRECONDITION_FAILED',
            status: 412,
            detail: 'Veículo alterado; recarregue antes de salvar.',
          }),
        });
      }

      const newVersion = vehicleState.current.version + 1;
      vehicleState.current = {
        ...vehicleState.current,
        model: body.model,
        nickname: body.model,
        allowedFuels: body.allowedFuels,
        currentOdometerKm: body.currentOdometerKm ?? null,
        tankCapacityLiters: body.tankCapacityLiters ?? null,
        version: newVersion,
      };

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ETag: `"${newVersion}"` },
        body: JSON.stringify(vehicleState.current),
      });
    }

    if (url.includes(`/vehicles/${vehicleState.current.id}`) && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ETag: `"${vehicleState.current.version}"` },
        body: JSON.stringify(vehicleState.current),
      });
    }

    if (url.includes('/summary')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totalLiters: '0',
          totalSpent: '0',
          averageConsumptionKmPerLiter: null,
          distanceTraveledKm: 0,
        }),
      });
    }

    if (url.includes('/consumption-cycles')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cycles: [],
          currentUnavailableReason: 'NEEDS_FULL_TANK_BASELINE',
        }),
      });
    }

    if (url.includes('/fuel-entries')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          total: 0,
          page: 0,
          size: 3,
          totalPages: 0,
        }),
      });
    }

    return route.fulfill({ status: 404 });
  });

  return {
    recordedPuts,
    recordedPosts,
    setFailNextPut: (status: number | null) => {
      failNextPutWithStatus = status;
    },
  };
}

test.describe('Edição de Veículo (Frontend)', () => {
  test('fluxo completo de edição com validação, PUT+IfMatch, e captura visual em lote 320dark e 390light', async ({
    page,
  }) => {
    const vehicleState = { current: { ...INITIAL_VEHICLE } };
    const api = setupMockApi(page, vehicleState);

    await mkdir('test-results', { recursive: true });

    // 0. Login inicial
    await page.goto('/login');
    await page.getByLabel('E-mail', { exact: true }).fill('e2e@fuellog.test');
    await page.getByLabel('Senha', { exact: true }).fill('FuelLog-test-2026!');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/\/?$/);

    // 1. REVISÃO VISUAL 320 DARK
    await page.setViewportSize({ width: 320, height: 600 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/vehicles');

    await expect(page.getByText('Meus veículos')).toBeVisible();
    await expect(page.getByText('Captur Turbo').first()).toBeVisible();

    // Clicar em "Editar veículo >"
    const editBtn = page.getByTestId('edit-vehicle-button');
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Verificar título da modalidade
    await expect(page.getByText('Editar veículo', { exact: true })).toBeVisible();
    await expect(page.getByText('Atualize os dados e combustíveis aceitos')).toBeVisible();

    // Verificar que os 4 campos estão preenchidos com os dados do veículo
    const modelInput = page.getByTestId('vehicle-model-input');
    await expect(modelInput).toHaveValue('Captur Turbo');

    // Verificar que não há overflow horizontal no viewport 320
    const scrollWidth320 = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth320).toBeLessThanOrEqual(320);

    // Verificar alcance por rolagem do botão Salvar a 320px
    const submitBtn320 = page.getByTestId('vehicle-form-submit-button');
    await submitBtn320.scrollIntoViewIfNeeded();
    await expect(submitBtn320).toBeVisible();

    // Capturar screenshot 320 dark
    await page.screenshot({
      path: 'test-results/vehicle-edit-320dark.png',
      fullPage: false,
    });

    // Fechar sheet pelo botão de fechar
    await page.getByLabel('Fechar', { exact: true }).click();
    await expect(page.getByText('Editar veículo', { exact: true })).not.toBeVisible();

    // 2. REVISÃO VISUAL 390 LIGHT
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });

    await editBtn.click();
    await expect(page.getByText('Editar veículo', { exact: true })).toBeVisible();

    // Verificar que não há overflow horizontal no viewport 390
    const scrollWidth390 = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth390).toBeLessThanOrEqual(390);

    // Capturar screenshot 390 light
    await page.screenshot({
      path: 'test-results/vehicle-edit-390light.png',
      fullPage: false,
    });

    // 3. EDITAR CAMPOS E SALVAR COM SUCESSO
    await modelInput.fill('Captur Iconic Turbo');

    const odometerInput = page.getByTestId('vehicle-current-odometer-input');
    await odometerInput.fill('48500');

    const capacityInput = page.getByTestId('vehicle-tank-capacity-input');
    await capacityInput.fill('53,5');

    // Clicar em "Salvar alterações"
    const submitBtn = page.getByTestId('vehicle-form-submit-button');
    await expect(submitBtn).toHaveText('Salvar alterações');
    await submitBtn.click();

    // Verificar chamada PUT e If-Match
    await expect(async () => {
      expect(api.recordedPuts.length).toBe(1);
    }).toPass();

    const put = api.recordedPuts[0];
    expect(put.headers['if-match']).toBe('"1"');
    expect(put.body.model).toBe('Captur Iconic Turbo');
    expect(put.body.currentOdometerKm).toBe(48500);
    expect(put.body.tankCapacityLiters).toBe('53.5');
    expect(put.body.allowedFuels).toEqual(['GASOLINE_REGULAR', 'ETHANOL']);

    // Verificar que a sheet fechou e a tela atualizou
    await expect(page.getByText('Editar veículo', { exact: true })).not.toBeVisible();
    await expect(page.getByText('Captur Iconic Turbo').first()).toBeVisible();

    // 4. TESTE DE CONFLITO 412 PRECONDITION_FAILED
    await editBtn.click();
    await expect(page.getByText('Editar veículo', { exact: true })).toBeVisible();

    // Simular que o próximo PUT retornará 412
    api.setFailNextPut(412);
    await modelInput.fill('Tentativa Conflitante');
    await submitBtn.click();

    // Verificar que o formulário NÃO fechou e exibiu aviso de conflito
    await expect(page.getByText('Veículo alterado em outra sessão')).toBeVisible();
    await expect(modelInput).toHaveValue('Tentativa Conflitante');

    // Atualizar estado no mock server para simular outra versão concorrente
    vehicleState.current = {
      ...vehicleState.current,
      model: 'Captur Servidor Concorrente',
      nickname: 'Captur Servidor Concorrente',
      version: 5,
    };

    // Clicar em "Carregar versão atual"
    const reloadBtn = page.getByTestId('vehicle-conflict-reload-button');
    await expect(reloadBtn).toBeVisible();
    await reloadBtn.click();

    // Verificar que o formulário atualizou com os dados do servidor e o conflito sumiu
    await expect(modelInput).toHaveValue('Captur Servidor Concorrente');
    await expect(page.getByText('Veículo alterado em outra sessão')).not.toBeVisible();

    // Fechar sheet
    await page.getByLabel('Fechar', { exact: true }).click();

    // 5. TESTE DE ERRO 422 - DADOS PRESERVADOS
    await editBtn.click();
    await expect(page.getByText('Editar veículo', { exact: true })).toBeVisible();

    api.setFailNextPut(422);
    await modelInput.fill('Modelo Rejeitado 422');
    await submitBtn.click();

    await expect(page.getByText('Modelo não aceito pelo servidor.')).toBeVisible();
    await expect(modelInput).toHaveValue('Modelo Rejeitado 422');

    await page.getByLabel('Fechar', { exact: true }).click();

    // 6. TESTE DE CRIAÇÃO INALTERADA
    const newBtn = page.getByRole('button', { name: 'Novo veículo', exact: true });
    await expect(newBtn).toBeVisible();
    await newBtn.click();

    await expect(page.getByText('Cadastre o veículo e os combustíveis aceitos')).toBeVisible();
    await expect(modelInput).toHaveValue('');
    await expect(page.getByTestId('vehicle-form-submit-button')).toHaveText('Salvar veículo');

    await modelInput.fill('Novo Carro Teste');
    await page.getByTestId('vehicle-form-submit-button').click();

    await expect(async () => {
      expect(api.recordedPosts.length).toBe(1);
    }).toPass();
    expect(api.recordedPosts[0].body.model).toBe('Novo Carro Teste');
  });
});
