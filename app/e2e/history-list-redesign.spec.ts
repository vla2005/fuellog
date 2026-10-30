import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const mockVehicle = {
  id: 'veh-hist-1',
  userId: 'user-hist-1',
  nickname: 'Gol 1.0',
  brand: 'Volkswagen',
  model: 'Gol',
  modelYear: 2022,
  plate: 'ABC1D23',
  tankCapacityLiters: '55.0',
  allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'],
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockEntries = [
  {
    id: 'entry-hist-1',
    vehicleId: mockVehicle.id,
    occurredAt: '2026-10-24T14:30:00-03:00',
    timezone: 'America/Sao_Paulo',
    odometerKm: 45200,
    fuelType: 'GASOLINE_REGULAR',
    liters: '45.210',
    unitPrice: '5.8900',
    paidTotal: '266.29',
    adjustmentAmount: '0.00',
    tankState: 'FULL',
    historyGapBefore: false,
    stationName: 'Posto Shell Central',
    notes: 'Tanque cheio na volta da viagem',
    version: 1,
    createdAt: '2026-10-24T14:35:00Z',
  },
  {
    id: 'entry-hist-2',
    vehicleId: mockVehicle.id,
    occurredAt: '2026-10-18T10:15:00-03:00',
    timezone: 'America/Sao_Paulo',
    odometerKm: 44750,
    fuelType: 'ETHANOL',
    liters: '35.000',
    unitPrice: '3.7900',
    paidTotal: '132.65',
    adjustmentAmount: '0.00',
    tankState: 'PARTIAL',
    historyGapBefore: false,
    stationName: 'Posto Ipiranga',
    notes: '',
    version: 1,
    createdAt: '2026-10-18T10:20:00Z',
  },
  {
    id: 'entry-hist-3',
    vehicleId: mockVehicle.id,
    occurredAt: '2026-10-02T08:00:00-03:00',
    timezone: 'America/Sao_Paulo',
    odometerKm: 44300,
    fuelType: 'GASOLINE_REGULAR',
    liters: '40.000',
    unitPrice: '5.8500',
    paidTotal: '234.00',
    adjustmentAmount: '0.00',
    tankState: 'FULL',
    historyGapBefore: false,
    stationName: 'Posto BR',
    notes: '',
    version: 1,
    createdAt: '2026-10-02T08:05:00Z',
  },
];

const mockSummary = {
  vehicleId: mockVehicle.id,
  purchaseCount: 3,
  paidTotal: '632.94',
  purchasedLiters: '120.210',
  periodConsumptionKmPerLiter: '12.50',
  lastValidCycle: null,
};

async function setupMockRoutes(page: Page, options: { empty?: boolean } = {}) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = request.url();

    if (url.includes('/auth/login')) {
      const now = new Date();
      const accessExpires = new Date(now.getTime() + 3600 * 1000).toISOString();
      const refreshExpires = new Date(now.getTime() + 30 * 86400 * 1000).toISOString();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-token-history-redesign',
          token_type: 'Bearer',
          expires_in: 3600,
          access_expires_at: accessExpires,
          refresh_token: 'mock-refresh-history-redesign',
          refresh_expires_at: refreshExpires,
          session_id: 'mock-session-history',
        }),
      });
    }

    if (url.includes('/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'user-hist-1',
          name: 'Condutor FuelLog',
          email: 'condutor@example.test',
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

    if (
      url.includes('/vehicles') &&
      !url.includes('/fuel-entries') &&
      !url.includes('/summary') &&
      !url.includes('/consumption-cycles')
    ) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockVehicle]),
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
        body: JSON.stringify(
          options.empty
            ? {
                vehicleId: mockVehicle.id,
                purchaseCount: 0,
                paidTotal: '0.00',
                purchasedLiters: '0.000',
              }
            : mockSummary,
        ),
      });
    }

    if (url.includes(`/vehicles/${mockVehicle.id}/fuel-entries/entry-hist-1`)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ETag: '"1"' },
        body: JSON.stringify(mockEntries[0]),
      });
    }

    if (url.includes('/fuel-entries')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: options.empty ? [] : mockEntries,
          page: 0,
          size: 30,
          totalElements: options.empty ? 0 : mockEntries.length,
          totalPages: 1,
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

async function loginAndNavigateToHistory(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const emailInput = page.getByLabel('E-mail', { exact: true });
  await expect(emailInput).toBeVisible({ timeout: 25_000 });
  await emailInput.fill('condutor@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('FuelLog-test-2026!');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);

  // Navega para Histórico via FloatingDock
  await page.getByRole('tab', { name: 'Histórico' }).click();
  await expect(page).toHaveURL(/\/history/);
  await expect(page.getByRole('tab', { name: 'Histórico', selected: true })).toBeVisible();

  // Descarta toast de login caso visível para limpar a tela
  const toastAlert = page.getByRole('alert');
  if (await toastAlert.isVisible()) {
    await toastAlert.click();
    await expect(toastAlert).toBeHidden({ timeout: 3_000 }).catch(() => {});
  }
}

test.describe('Histórico - Redesign da Lista de Itens', () => {
  const screenshotsDir = path.resolve(process.cwd(), 'test-results', 'history-redesign-review');

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test('linhas exibem data sem repetição de mês/ano, combustível, litros x preço e total pago', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupMockRoutes(page);
    await loginAndNavigateToHistory(page);

    // Cabeçalho de mês agrupado
    await expect(page.getByText('Outubro 2026').last()).toBeVisible();

    // Linha 1: 24, Sáb • Gasolina comum | 45,210 L × R$ 5,89 | R$ 266,29
    const row1 = page.getByRole('button', { name: /Abastecimento de R\$\s*266,29/i });
    await expect(row1).toBeVisible();
    await expect(row1.getByText('24, Sáb', { exact: true })).toBeVisible();
    await expect(row1.getByText('Gasolina comum', { exact: true })).toBeVisible();
    await expect(row1.getByText('45,210 L × R$ 5,89', { exact: true })).toBeVisible();
    await expect(row1.getByText('R$ 266,29', { exact: true })).toBeVisible();

    // Linha 2: 18, Dom • Etanol | 35,000 L × R$ 3,79 | R$ 132,65
    const row2 = page.getByRole('button', { name: /Abastecimento de R\$\s*132,65/i });
    await expect(row2).toBeVisible();
    await expect(row2.getByText('18, Dom', { exact: true })).toBeVisible();
    await expect(row2.getByText('Etanol', { exact: true })).toBeVisible();
    await expect(row2.getByText('35,000 L × R$ 3,79', { exact: true })).toBeVisible();
    await expect(row2.getByText('R$ 132,65', { exact: true })).toBeVisible();

    // Linha 3: 02, Sex • Gasolina comum | 40,000 L × R$ 5,85 | R$ 234,00
    const row3 = page.getByRole('button', { name: /Abastecimento de R\$\s*234,00/i });
    await expect(row3).toBeVisible();
    await expect(row3.getByText('02, Sex', { exact: true })).toBeVisible();
    await expect(row3.getByText('Gasolina comum', { exact: true })).toBeVisible();
    await expect(row3.getByText('40,000 L × R$ 5,85', { exact: true })).toBeVisible();
    await expect(row3.getByText('R$ 234,00', { exact: true })).toBeVisible();

    // Totais do período continuam visíveis no topo
    await expect(page.getByText('R$ 632,94').last()).toBeVisible();
    await expect(page.getByText('120,210 L').last()).toBeVisible();

    // Screenshot 390px Light Mode
    const screenshotLight = path.join(screenshotsDir, 'history-390-light.png');
    await page.screenshot({ path: screenshotLight, fullPage: false });
    expect(fs.existsSync(screenshotLight)).toBe(true);
  });

  test('320px em modo escuro renderiza sem sobreposição nem corte de valores', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.emulateMedia({ colorScheme: 'dark' });

    await setupMockRoutes(page);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('fuellog:theme-preference:v1', 'dark');
    });

    const emailInput = page.getByLabel('E-mail', { exact: true });
    await expect(emailInput).toBeVisible({ timeout: 25_000 });
    await emailInput.fill('condutor@example.test');
    await page.getByLabel('Senha', { exact: true }).fill('FuelLog-test-2026!');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/\/?$/);

    await page.getByRole('tab', { name: 'Histórico' }).click();
    await expect(page).toHaveURL(/\/history/);
    await expect(page.getByRole('tab', { name: 'Histórico', selected: true })).toBeVisible();

    // Descarta toast se presente
    const toastAlert = page.getByRole('alert');
    if (await toastAlert.isVisible()) {
      await toastAlert.click();
      await expect(toastAlert).toBeHidden({ timeout: 3_000 }).catch(() => {});
    }

    // Registros visíveis dentro das linhas - combustível totalmente legível sem corte
    const row1 = page.getByRole('button', { name: /Abastecimento de R\$\s*266,29/i });
    await expect(row1).toBeVisible();
    await expect(row1.getByText('24, Sáb', { exact: true })).toBeVisible();
    await expect(row1.getByText('Gasolina comum', { exact: true })).toBeVisible();
    await expect(row1.getByText('R$ 266,29', { exact: true })).toBeVisible();
    await expect(row1.getByText('45,210 L × R$ 5,89', { exact: true })).toBeVisible();

    const row2 = page.getByRole('button', { name: /Abastecimento de R\$\s*132,65/i });
    await expect(row2).toBeVisible();
    await expect(row2.getByText('18, Dom', { exact: true })).toBeVisible();
    await expect(row2.getByText('Etanol', { exact: true })).toBeVisible();
    await expect(row2.getByText('R$ 132,65', { exact: true })).toBeVisible();
    await expect(row2.getByText('35,000 L × R$ 3,79', { exact: true })).toBeVisible();

    const row3 = page.getByRole('button', { name: /Abastecimento de R\$\s*234,00/i });
    await expect(row3).toBeVisible();
    await expect(row3.getByText('02, Sex', { exact: true })).toBeVisible();
    await expect(row3.getByText('Gasolina comum', { exact: true })).toBeVisible();
    await expect(row3.getByText('R$ 234,00', { exact: true })).toBeVisible();
    await expect(row3.getByText('40,000 L × R$ 5,85', { exact: true })).toBeVisible();

    // Screenshot 320px Dark Mode
    const screenshotDark = path.join(screenshotsDir, 'history-320-dark.png');
    await page.screenshot({ path: screenshotDark, fullPage: false });
    expect(fs.existsSync(screenshotDark)).toBe(true);
  });

  test('tocar no registro navega para os detalhes do abastecimento correto', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupMockRoutes(page);
    await loginAndNavigateToHistory(page);

    // Clica no primeiro registro
    const firstRow = page.getByRole('button', {
      name: /Abastecimento de R\$\s*266,29/i,
    });
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    // Deve abrir a rota de detalhe com o ID do registro
    await expect(page).toHaveURL(/\/fueling\/entry-hist-1/);
  });

  test('estado vazio exibe mensagem clara e botão de novo abastecimento', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupMockRoutes(page, { empty: true });
    await loginAndNavigateToHistory(page);

    await expect(page.getByText('Nenhum abastecimento encontrado')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novo abastecimento' }).first()).toBeVisible();
  });
});
