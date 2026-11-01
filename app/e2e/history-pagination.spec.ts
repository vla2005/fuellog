import { expect, test, type Page } from '@playwright/test';
import { fuelHistoryPage } from './api-fixtures';

const vehicle = { id: 'history-page-car', nickname: 'Meu carro', allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'], archivedAt: null, version: 0 };
const otherVehicle = { ...vehicle, id: 'history-other-car', nickname: 'Outro carro' };
const purchases = Array.from({ length: 41 }, (_, index) => ({
  id: `history-entry-${index}`, vehicleId: vehicle.id,
  occurredAt: new Date(Date.UTC(2026, 9, 29, 12) - Math.floor(index / 2) * 86_400_000).toISOString(),
  timezone: 'Pacific/Auckland', odometerKm: 10000 - index * 100,
  fuelType: index % 2 ? 'ETHANOL' : 'GASOLINE_REGULAR',
  liters: '36.125', unitPrice: '5.4321', paidTotal: '195.00', referenceTotal: '196.24',
  adjustmentAmount: '-1.24', adjustmentReason: 'Desconto', version: 0, idempotentReplay: false, latitude: null, longitude: null,
}));

async function setup(page: Page, count = 41) {
  let entries = purchases.slice(0, count);
  const calls: URL[] = [];
  let delayed: (() => void) | undefined;
  let delayedStarted = false;
  let delayNext = false;
  let errorNext = false;
  let deletionCount = 0;
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (/\/auth\/(login|refresh)$/.test(path)) return reply({ access_token: 'history-access', refresh_token: 'history-refresh', token_type: 'Bearer',
      expires_in: 3600, access_expires_at: '2099-01-01T00:00:00Z', refresh_expires_at: '2099-02-01T00:00:00Z', session_id: 'history-session' });
    if (path.endsWith('/me')) return reply({ id: 'history-user', name: 'Condutor', email: 'history@example.test', preferredTimezone: 'America/Sao_Paulo' });
    if (path.endsWith('/vehicles')) return reply([vehicle, otherVehicle]);
    if (path.endsWith('/fuel-types')) return reply(vehicle.allowedFuels);
    if (path.endsWith('/dashboard')) return reply({ vehicleId: vehicle.id, purchaseCount: entries.length, paidTotal: '7995.00', purchasedLiters: '1481.125',
      from: null, to: null, timezone: 'America/Sao_Paulo', fuelType: null, months: [], fuels: [], prices: [], weightedUnitPrice: '5.4321' });
    if (path.endsWith('/fuel-entries')) {
      calls.push(url);
      expect(Number(url.searchParams.get('size'))).toBeLessThanOrEqual(20);
      const pageIndex = Number(url.searchParams.get('page'));
      const size = Number(url.searchParams.get('size'));
      const fuel = url.searchParams.get('fuelType');
      const filtered = path.includes(otherVehicle.id) ? [] : entries.filter(entry => !fuel || entry.fuelType === fuel);
      const body = fuelHistoryPage(filtered, pageIndex, size);
      if (delayNext) {
        delayNext = false;
        delayedStarted = true;
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 20_000);
          delayed = () => { clearTimeout(timer); resolve(); };
        });
      }
      if (errorNext) { errorNext = false; return reply({ status: 503, code: 'UNAVAILABLE', detail: 'Falha controlada no histórico.' }, 503); }
      return reply(body);
    }
    const entry = entries.find(item => path.endsWith(`/fuel-entries/${item.id}`));
    if (entry) {
      if (request.method() === 'DELETE') {
        expect(request.headers()['if-match']).toBe('"0"');
        entries = entries.filter(item => item.id !== entry.id);
        deletionCount++;
        return route.fulfill({ status: 204 });
      }
      return reply(entry);
    }
    return /\/fuel-entries\//.test(path) ? reply({ status: 404, code: 'NOT_FOUND', detail: 'Registro excluído.' }, 404) : reply({});
  });
  return { calls, hold: () => { delayNext = true; delayedStarted = false; }, waiting: () => delayedStarted,
    release: () => delayed?.(), fail: () => { errorNext = true; }, deletions: () => deletionCount };
}

async function history(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-30T12:00:00-03:00'));
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill('history@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('FuelLog-test-2026!');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);
  await page.getByRole('tab', { name: 'Histórico', exact: true }).click();
  await expect(rows(page).first()).toBeVisible();
  const toast = page.getByRole('alert').filter({ hasText: 'Sessão iniciada' });
  if (await toast.isVisible()) await toast.click();
}
const rows = (page: Page) => page.getByRole('button', { name: /^Abastecimento de R\$/ });
const footer = (page: Page) => page.getByTestId('history-pagination');
async function size(page: Page, value: number) {
  await footer(page).getByRole('button', { name: /por página/ }).click();
  await page.getByRole('radio', { name: `${value} por página`, exact: true }).click();
}

test('páginas reais substituem linhas, totais globais e contexto retornam do detalhe', async ({ page }) => {
  const api = await setup(page);
  await history(page);
  await expect(rows(page)).toHaveCount(20);
  await expect(footer(page)).toContainText('1–20 de 41');
  await expect(page.getByText('R$ 7.995,00', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel('41 registros no mês, em todo o recorte')).toBeVisible();
  await expect(footer(page).getByRole('button', { name: 'Página anterior', exact: true })).toBeDisabled();
  const initial = api.calls.length;
  await page.mouse.wheel(0, 600);
  await expect.poll(() => api.calls.length).toBe(initial);
  await footer(page).getByRole('button', { name: 'Próxima página', exact: true }).click();
  await expect(rows(page)).toHaveCount(20);
  await expect(footer(page)).toContainText('21–40 de 41');
  expect(api.calls.at(-1)?.searchParams.get('page')).toBe('1');
  await expect(rows(page).first()).toHaveAttribute('aria-label', /19\/10\/2026/);
  await rows(page).first().click({ delay: 80 });
  await expect(page).toHaveURL(/\/fueling\/history-entry-20$/);
  await page.goBack();
  await expect(footer(page)).toContainText('21–40 de 41');
  await footer(page).getByRole('button', { name: 'Próxima página', exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(footer(page)).toContainText('41–41 de 41');
  await expect(page.getByLabel('Página 3 de 3', { exact: true })).toBeVisible();
  await expect(footer(page).getByRole('button', { name: 'Próxima página', exact: true })).toBeDisabled();
  await size(page, 10);
  await expect(rows(page)).toHaveCount(10);
  await expect(footer(page)).toContainText('1–10 de 41');
  await size(page, 5);
  await expect(rows(page)).toHaveCount(5);
  await expect(page.getByLabel('Página 1 de 9', { exact: true })).toBeVisible();
  await footer(page).getByRole('button', { name: 'Próxima página', exact: true }).click();
  await page.getByRole('button', { name: /^Veículo: / }).click();
  await page.getByRole('radio', { name: 'Outro carro', exact: true }).click();
  await expect(page.getByText('Nenhum abastecimento encontrado')).toBeVisible();
  expect(api.calls.at(-1)?.searchParams.get('page')).toBe('0');
  await expect(footer(page)).toContainText('0–0 de 0');
});

test('filtro descarta resposta tardia; falha mostra erro sem resumo artificial e permite retry', async ({ page }) => {
  const api = await setup(page);
  await history(page);
  api.hold();
  await footer(page).getByRole('button', { name: 'Próxima página', exact: true }).click();
  await expect.poll(api.waiting).toBe(true);
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole('button', { name: /^Período: / }).click();
  await page.getByRole('button', { name: 'Etanol', exact: true }).click();
  await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
  await expect(rows(page)).toHaveCount(20);
  await expect(footer(page)).toContainText('1–20 de 20');
  await expect(page.getByText('R$ 3.900,00', { exact: true }).filter({ visible: true })).toBeVisible();
  api.release();
  await expect(rows(page).filter({ hasText: 'Gasolina comum' })).toHaveCount(0);
  api.fail();
  await size(page, 5);
  await expect(page.getByRole('alert').filter({ hasText: 'Falha controlada' })).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText('R$ 0,00', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(rows(page)).toHaveCount(5);
  await expect(footer(page)).toContainText('1–5 de 20');
});

test('excluir único registro final atualiza recorte e volta à página válida', async ({ page }) => {
  const api = await setup(page, 21);
  await history(page);
  await footer(page).getByRole('button', { name: 'Próxima página', exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole('button', { name: /^Ver detalhes de abastecimento/ }).click();
  await expect(page).toHaveURL(/\/fueling\/history-entry-20$/);
  await page.getByRole('button', { name: 'Opções do abastecimento', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Excluir abastecimento', exact: true }).click();
  await page.getByRole('dialog', { name: 'Excluir abastecimento?' }).getByRole('button', { name: 'Excluir abastecimento', exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(rows(page)).toHaveCount(20);
  await expect(footer(page)).toContainText('1–20 de 20');
  await expect(page.getByText('R$ 3.900,00', { exact: true }).filter({ visible: true })).toBeVisible();
  expect(api.deletions()).toBe(1);
  await expect(footer(page).getByRole('button', { name: 'Próxima página', exact: true })).toBeDisabled();
});

for (const width of [320, 390]) for (const theme of ['light', 'dark'] as const) {
  test(`referência visual ${width}px ${theme}, valores completos e rodapé`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    await setup(page, 6);
    await history(page);
    await page.evaluate(async () => {
      await Promise.all([...document.images].map(image => image.decode()));
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await expect(rows(page)).toHaveCount(6);
    for (const row of await rows(page).all()) {
      await expect(row.getByText('R$ 195,00', { exact: true })).toBeVisible();
      await expect(row.getByText('R$ 5,4321/L', { exact: true })).toBeVisible();
      await expect(row.getByText('36,125 L ·', { exact: true })).toBeVisible();
      const overflow = await row.evaluate(node => [...node.querySelectorAll('*')].some(child => child.scrollWidth > child.clientWidth + 1));
      expect(overflow).toBe(false);
    }
    await page.screenshot({ path: `test-results/history-pagination/history-${width}-${theme}.png`, fullPage: false });
    await footer(page).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/history-pagination/history-footer-${width}-${theme}.png`, fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 320 && theme === 'dark') {
      const selectors = ['history-summary', 'history-selectors', 'history-swipe-row', 'history-pagination'];
      await page.evaluate(ids => {
        for (const id of ids) for (const text of document.querySelectorAll<HTMLElement>(`[data-testid="${id}"] [dir="auto"]`)) {
          text.style.fontSize = `${parseFloat(getComputedStyle(text).fontSize) * 1.5}px`;
          text.style.lineHeight = '1.5';
        }
      }, selectors);
      for (const row of await rows(page).all()) expect(await row.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await rows(page).first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'test-results/history-pagination/history-320-dark-text150.png', fullPage: false });
      await footer(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'test-results/history-pagination/history-footer-320-dark-text150.png', fullPage: false });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
