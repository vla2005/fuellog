import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const mockVehicle = {
  id: 'veh-filt-1',
  userId: 'user-filt-1',
  nickname: 'Polo TSI',
  brand: 'Volkswagen',
  model: 'Polo',
  modelYear: 2024,
  plate: 'BRA2E19',
  tankCapacityLiters: '52.0',
  allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'],
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockEntries = [
  {
    id: 'entry-filt-1',
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
    notes: '',
    version: 1,
    createdAt: '2026-10-24T14:35:00Z',
  },
  {
    id: 'entry-filt-2',
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
];

const mockSummary = {
  vehicleId: mockVehicle.id,
  purchaseCount: 2,
  paidTotal: '398.94',
  purchasedLiters: '80.210',
  periodConsumptionKmPerLiter: '12.50',
  lastValidCycle: null,
};

let lastListQueryParams: Record<string, string> = {};
let fuelEntriesRequestsCount = 0;

async function setupMockRoutes(page: Page) {
  lastListQueryParams = {};
  fuelEntriesRequestsCount = 0;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = request.url();

    if (url.includes('/auth/login')) {
      const now = new Date();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-token-filter',
          token_type: 'Bearer',
          expires_in: 3600,
          access_expires_at: new Date(now.getTime() + 3600 * 1000).toISOString(),
          refresh_token: 'mock-refresh-filter',
          refresh_expires_at: new Date(now.getTime() + 30 * 86400 * 1000).toISOString(),
          session_id: 'mock-session-filter',
        }),
      });
    }

    if (url.includes('/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'user-filt-1',
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
        body: JSON.stringify(['GASOLINE_REGULAR', 'ETHANOL']),
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
        body: JSON.stringify({
          vehicleId: mockVehicle.id,
          items: [],
          currentUnavailableReason: null,
        }),
      });
    }

    if (url.includes('/summary')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockSummary),
      });
    }

    if (url.includes('/fuel-entries')) {
      fuelEntriesRequestsCount++;
      const parsedUrl = new URL(url);
      const querySnapshot: Record<string, string> = {};
      parsedUrl.searchParams.forEach((val, key) => {
        querySnapshot[key] = val;
      });
      lastListQueryParams = querySnapshot;

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: mockEntries,
          page: 0,
          size: 30,
          totalElements: mockEntries.length,
          totalPages: 1,
        }),
      });
    }

    return route.continue();
  });
}

async function loginAndNavigateToHistory(page: Page) {
  // Fixa relógio do browser em 15/10/2026 para que calendário/asserts em outubro nunca quebrem
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00-03:00'));

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const emailInput = page.getByLabel('E-mail', { exact: true });
  await expect(emailInput).toBeVisible({ timeout: 25_000 });
  await emailInput.fill('condutor@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('FuelLog-test-2026!');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);

  await page.getByRole('tab', { name: 'Histórico' }).click();
  await expect(page).toHaveURL(/\/history/);
  await expect(page.getByRole('tab', { name: 'Histórico', selected: true })).toBeVisible();

  const toastAlert = page.getByRole('alert');
  if (await toastAlert.isVisible()) {
    await toastAlert.click();
    await expect(toastAlert).toBeHidden({ timeout: 3_000 }).catch(() => {});
  }
}

test.describe('Filtros do Histórico e Calendário de Período', () => {
  const screenshotsDir = path.join(__dirname, '..', 'test-results', 'screenshots');

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test('abre modal de filtros reutilizando AppSheet, sem tanque na UI', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupMockRoutes(page);
    await loginAndNavigateToHistory(page);

    // Clica no botão de Período para abrir o sheet
    const periodPill = page.getByRole('button', { name: /Período:/i });
    await expect(periodPill).toBeVisible();
    await periodPill.click();

    // Modal aberto: título "Filtrar histórico" e botão fechar do AppSheet
    await expect(page.getByText('Filtrar histórico')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fechar', exact: true })).toBeVisible();

    // Seção Período
    await expect(page.getByText('Período', { exact: true })).toBeVisible();

    // Seção Combustível: "Todos", "Gasolina comum", "Etanol"
    await expect(page.getByText('Tipo de combustível', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Todos os combustíveis' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gasolina comum', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Etanol', exact: true })).toBeVisible();

    // Regra: "Remover tanque UI, manter combustível."
    await expect(page.getByText('Estado do tanque')).not.toBeVisible();

    // Seção Accordion: 3 itens sanfonados
    await expect(page.getByText('Valor pago')).toBeVisible();
    await expect(page.getByText('Quantidade de litros')).toBeVisible();
    await expect(page.getByText('Preço por litro')).toBeVisible();

    // Botões inferiores: Limpar e Aplicar filtros
    await expect(page.getByRole('button', { name: 'Limpar filtros' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aplicar filtros' })).toBeVisible();

    // Screenshot 390px Light Mode da tela de filtros (AppSheet inalterado)
    const screenshotSheet = path.join(screenshotsDir, 'history-filters-step1-light.png');
    await page.screenshot({ path: screenshotSheet });
    expect(fs.existsSync(screenshotSheet)).toBe(true);
  });

  test('navega para Selecionar período, seleciona intervalo e confirma com Usar período', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupMockRoutes(page);
    await loginAndNavigateToHistory(page);

    await page.getByRole('button', { name: /Período:/i }).click();
    await expect(page.getByText('Filtrar histórico')).toBeVisible();

    // Clica no card de Período para avançar à etapa 2
    await page.getByRole('button', { name: /Selecionar período\./i }).click();

    // Etapa 2: Selecionar período com botão voltar no conteúdo
    await expect(page.getByText('Selecionar período')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voltar para filtros' })).toBeVisible();
    await expect(page.getByText('Início', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Fim', { exact: true }).last()).toBeVisible();

    // Dias da semana: Seg, Ter, Qua, Qui, Sex, Sáb, Dom
    await expect(page.getByText('Seg', { exact: true })).toBeVisible();
    await expect(page.getByText('Dom', { exact: true })).toBeVisible();

    // Seleciona dia 1 e dia 30
    const day1Btn = page.getByRole('button', { name: /^1 de /i });
    const day30Btn = page.getByRole('button', { name: /^30 de /i });
    await day1Btn.click();
    await day30Btn.click();

    // Instrução presente
    await expect(page.getByText('Toque na data inicial e depois na final.')).toBeVisible();

    // Screenshot do calendário
    const screenshotCalendar = path.join(screenshotsDir, 'history-filters-calendar-light.png');
    await page.screenshot({ path: screenshotCalendar });
    expect(fs.existsSync(screenshotCalendar)).toBe(true);

    // Clica em "Usar período" para voltar à etapa 1 com o rascunho de período
    await page.getByRole('button', { name: 'Usar período' }).click();
    await expect(page.getByText('Filtrar histórico')).toBeVisible();
    await expect(page.getByText(/01\/10\/2026 — 30\/10\/2026/)).toBeVisible();
  });

  test('cancelamento no calendário via Voltar e fechar não consulta API até Aplicar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupMockRoutes(page);
    await loginAndNavigateToHistory(page);

    // Registra requisições de carga inicial
    const initialRequests = fuelEntriesRequestsCount;
    expect(initialRequests).toBeGreaterThanOrEqual(1);

    await page.getByRole('button', { name: /Período:/i }).click();
    await expect(page.getByText('Filtrar histórico')).toBeVisible();

    // Avança ao calendário
    await page.getByRole('button', { name: /Selecionar período\./i }).click();
    await expect(page.getByText('Selecionar período')).toBeVisible();

    // Seleciona dia 5 no calendário
    await page.getByRole('button', { name: /^5 de /i }).click();

    // Clica em "Voltar para filtros"
    await page.getByRole('button', { name: 'Voltar para filtros' }).click();
    await expect(page.getByText('Filtrar histórico')).toBeVisible();

    // Fecha o modal via (X) sem aplicar
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(page.getByText('Filtrar histórico')).not.toBeVisible();

    // Nenhuma requisição nova foi disparada durante o fluxo de cancelamento
    expect(fuelEntriesRequestsCount).toBe(initialRequests);

    // Reabre e confirma que rascunho não foi aplicado
    await page.getByRole('button', { name: /Período:/i }).click();
    await expect(page.getByText('Filtrar histórico')).toBeVisible();
    await expect(page.getByText('05/10/2026')).not.toBeVisible();
  });

  test('aplicar filtros e depois limpar retira parâmetros da query na API', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupMockRoutes(page);
    await loginAndNavigateToHistory(page);

    await page.getByRole('button', { name: /Período:/i }).click();
    await expect(page.getByText('Filtrar histórico')).toBeVisible();

    // Seleciona Etanol usando match exato
    await page.getByRole('button', { name: 'Etanol', exact: true }).click();

    // Preenche Valor pago: min 100, max 250
    await page.getByLabel('Valor pago mínimo').fill('100,00');
    await page.getByLabel('Valor pago máximo').fill('250,00');

    // Clica em Aplicar filtros
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(page.getByText('Filtrar histórico')).not.toBeVisible();

    // Verifica parâmetros enviados para a API (inclusive timezone explicitado)
    expect(lastListQueryParams.fuelType).toBe('ETHANOL');
    expect(lastListQueryParams.minTotalPaid).toBe('100.00');
    expect(lastListQueryParams.maxTotalPaid).toBe('250.00');
    expect(lastListQueryParams.timezone).toBe('America/Sao_Paulo');

    // Agora reabre, clica em Limpar filtros e Aplica
    await page.getByRole('button', { name: /Período:/i }).click();
    await expect(page.getByText('Filtrar histórico')).toBeVisible();
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(page.getByText('Filtrar histórico')).not.toBeVisible();

    // Snapshot da requisição mais recente NÃO contém mais chaves de filtros
    expect(lastListQueryParams.fuelType).toBeUndefined();
    expect(lastListQueryParams.minTotalPaid).toBeUndefined();
    expect(lastListQueryParams.maxTotalPaid).toBeUndefined();
  });

  test('validação: mínimo maior que máximo bloqueia aplicação com erro visível mesmo se recolhida', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupMockRoutes(page);
    await loginAndNavigateToHistory(page);

    await page.getByRole('button', { name: /Período:/i }).click();
    await expect(page.getByText('Filtrar histórico')).toBeVisible();

    // Preenche min 300, max 200 (inválido)
    await page.getByLabel('Valor pago mínimo').fill('300,00');
    await page.getByLabel('Valor pago máximo').fill('200,00');

    // Recolhe a seção "Valor pago" expandindo "Quantidade de litros"
    await page.getByRole('button', { name: /Quantidade de litros\./i }).click();

    // Clica em Aplicar filtros com a seção com erro recolhida
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();

    // Mensagem de erro fica visível (seja por renderização ou auto-expansão)
    await expect(page.getByText('Valor pago: valor mínimo não pode ser maior que o máximo')).toBeVisible();
    await expect(page.getByText('Filtrar histórico')).toBeVisible();

    // Rascunho permanece preservado nos inputs
    await expect(page.getByLabel('Valor pago mínimo')).toHaveValue('300,00');
    await expect(page.getByLabel('Valor pago máximo')).toHaveValue('200,00');
  });

  test('320px em modo escuro: input focado em viewport reduzido permite rolar até Aplicar/Limpar', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
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

    const toastAlert = page.getByRole('alert');
    if (await toastAlert.isVisible()) {
      await toastAlert.click();
      await expect(toastAlert).toBeHidden({ timeout: 3_000 }).catch(() => {});
    }

    // Abre filtros em 320px Dark Mode
    await page.getByRole('button', { name: /Período:/i }).click();
    await expect(page.getByText('Filtrar histórico')).toBeVisible();

    const screenshotDarkStep1 = path.join(screenshotsDir, 'history-filters-step1-dark-320.png');
    await page.screenshot({ path: screenshotDarkStep1 });
    expect(fs.existsSync(screenshotDarkStep1)).toBe(true);

    // Foca input de valor mínimo
    const minPaidInput = page.getByLabel('Valor pago mínimo');
    await minPaidInput.focus();

    // Simula viewport reduzido representando teclado virtual sem alegar teste nativo
    await page.setViewportSize({ width: 320, height: 320 });

    // Verifica que ações Limpar e Aplicar continuam alcançáveis por rolagem
    const applyBtn = page.getByRole('button', { name: 'Aplicar filtros' });
    const clearBtn = page.getByRole('button', { name: 'Limpar filtros' });
    await applyBtn.scrollIntoViewIfNeeded();
    await expect(applyBtn).toBeVisible();
    await expect(clearBtn).toBeVisible();

    // Restaura viewport para 320x568 e abre calendário
    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole('button', { name: /Selecionar período\./i }).click();
    await expect(page.getByText('Selecionar período')).toBeVisible();

    const screenshotDarkCalendar = path.join(screenshotsDir, 'history-filters-calendar-dark-320.png');
    await page.screenshot({ path: screenshotDarkCalendar });
    expect(fs.existsSync(screenshotDarkCalendar)).toBe(true);
  });
});
