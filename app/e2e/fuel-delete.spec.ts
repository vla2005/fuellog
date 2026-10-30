import { expect, Page, test } from '@playwright/test';

const vehicle = { id: 'delete-vehicle', nickname: 'Carro exclusão', allowedFuels: ['GASOLINE_REGULAR'], archivedAt: null, version: 0 };
const original = {
  id: 'delete-entry', vehicleId: vehicle.id, occurredAt: '2026-10-24T12:00:00Z', timezone: 'America/Sao_Paulo',
  odometerKm: 120500, fuelType: 'GASOLINE_REGULAR', liters: '10.000', unitPrice: '6.0000', paidTotal: '60.00',
  referenceTotal: '60.00', adjustmentAmount: '0.00', tankState: 'PARTIAL', historyGapBefore: false,
  stationName: 'Posto exclusão', notes: null, version: 3, idempotentReplay: false, latitude: null, longitude: null,
};

async function setup(page: Page) {
  let entry = { ...original };
  let deleted = false;
  let status = 204;
  let calls = 0;
  let listCalls = 0;
  let summaryCalls = 0;
  let release: (() => void) | null = null;
  let gate: Promise<void> | null = null;
  const captured: Array<Record<string, string>> = [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const reply = (body: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/auth/login') || path.endsWith('/auth/refresh')) return reply({
      access_token: 'delete-test-access', refresh_token: 'delete-test-refresh', token_type: 'Bearer',
      expires_in: 3600, access_expires_at: '2099-01-01T00:00:00Z', refresh_expires_at: '2099-02-01T00:00:00Z', session_id: 'delete-session',
    });
    if (path.endsWith('/me')) return reply({ id: 'delete-user', name: 'Teste exclusão', email: 'delete@example.test', preferredTimezone: 'America/Sao_Paulo' });
    if (path.endsWith('/fuel-types')) return reply(['GASOLINE_REGULAR']);
    if (path.endsWith('/vehicles')) return reply([vehicle]);
    if (path.endsWith(`/fuel-entries/${entry.id}`)) {
      if (request.method() === 'DELETE') {
        calls++;
        captured.push(request.headers());
        if (gate) await gate;
        if (status !== 204) return reply({ status, code: status === 412 ? 'PRECONDITION_FAILED' : 'INTERNAL_ERROR', detail: 'Falha controlada na exclusão.' }, status);
        deleted = true;
        return route.fulfill({ status: 204 });
      }
      return deleted ? reply({ status: 404, code: 'NOT_FOUND', detail: 'Registro excluído.' }, 404) : reply(entry);
    }
    if (path.endsWith('/fuel-entries')) {
      listCalls++;
      return reply({ items: deleted ? [] : [entry], page: 0, size: 30, totalElements: deleted ? 0 : 1, totalPages: deleted ? 0 : 1 });
    }
    if (path.endsWith('/summary')) {
      summaryCalls++;
      return reply({ vehicleId: vehicle.id, purchaseCount: deleted ? 0 : 1, paidTotal: deleted ? '0.00' : entry.paidTotal,
        purchasedLiters: deleted ? '0.000' : entry.liters, validCycleCount: 0, periodConsumptionKmPerLiter: null,
        periodUnavailableReason: 'NEEDS_FULL_TANK_BASELINE', lastValidCycle: null, lastCycleUnavailableReason: 'NEEDS_FULL_TANK_BASELINE' });
    }
    if (path.endsWith('/consumption-cycles')) return reply({ items: [], currentUnavailableReason: 'NEEDS_FULL_TANK_BASELINE' });
    return reply({});
  });
  return {
    calls: () => calls, listCalls: () => listCalls, summaryCalls: () => summaryCalls, captured,
    setStatus: (value: number) => { status = value; },
    update: () => { entry = { ...entry, version: 4, paidTotal: '59.00' }; },
    hold: () => { gate = new Promise<void>(resolve => { release = resolve; }); },
    release: () => { release?.(); },
  };
}

async function history(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail', { exact: true }).fill('delete@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('FuelLog-test-2026!');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);
  await page.getByRole('tab', { name: 'Histórico', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Abastecimento de R\$/ }).first()).toBeVisible();
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Excluir abastecimento?' });
async function captureConfirmation(page: Page, name: string) {
  await expect.poll(() => dialog(page).getByRole('button', { name: 'Cancelar', exact: true }).evaluate(node => {
    let opacity = 1;
    for (let current: Element | null = node; current; current = current.parentElement) {
      opacity *= Number(getComputedStyle(current).opacity);
    }
    return opacity;
  })).toBe(1);
  await page.screenshot({ path: test.info().outputPath(name) });
}
async function reveal(page: Page) {
  await page.getByRole('button', { name: /^Ações: abastecimento/ }).first().click();
  await page.getByRole('button', { name: /^Excluir abastecimento de/ }).first().click();
  await expect(dialog(page)).toBeVisible();
}

test('swipe only reveals; accessible alternative, cancel, focus trap and dark theme', async ({ page }) => {
  const api = await setup(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await history(page);
  const row = page.getByTestId('history-swipe-row').first();
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 12, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/history$/);
  expect(api.calls()).toBe(0);
  const action = page.getByRole('button', { name: /^Excluir abastecimento de/ }).first();
  await expect(action).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('swipe-dark.png') });
  await action.click();
  await expect(dialog(page)).toContainText('Carro exclusão');
  await expect(dialog(page)).toContainText('Posto exclusão');
  await captureConfirmation(page, 'confirm-dark.png');
  await expect(dialog(page).getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', /Fechar|Excluir/);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(api.calls()).toBe(0);
  await reveal(page);
  await dialog(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(api.calls()).toBe(0);
  await expect(page.getByRole('button', { name: /^Abastecimento de R\$/ }).first()).toBeVisible();
});

test('detail failure retains entry; retry sends once, awaits 204, invalidates and exits deleted detail', async ({ page }) => {
  const api = await setup(page);
  await history(page);
  const homeTabBox = (await page.getByRole('tab', { name: 'Início', exact: true }).boundingBox())!;
  await page.getByRole('button', { name: /^Abastecimento de R\$/ }).first().click();
  await page.getByRole('button', { name: 'Opções do abastecimento', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Excluir abastecimento', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(api.calls()).toBe(0);
  await page.getByRole('button', { name: 'Opções do abastecimento', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Excluir abastecimento', exact: true }).click();
  api.setStatus(500);
  await dialog(page).getByRole('button', { name: 'Excluir abastecimento', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toBeVisible();
  expect(api.calls()).toBe(1);
  await expect(page).toHaveURL(/\/fueling\/delete-entry$/);
  api.setStatus(204);
  api.hold();
  const beforeLists = api.listCalls(), beforeSummaries = api.summaryCalls();
  const button = dialog(page).getByRole('button', { name: 'Excluir abastecimento', exact: true });
  await button.dblclick({ force: true });
  await expect(button).toBeDisabled();
  await expect(dialog(page).getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
  await expect(dialog(page)).toContainText('Aguarde a confirmação do servidor');
  await page.mouse.click(homeTabBox.x + homeTabBox.width / 2, homeTabBox.y + homeTabBox.height / 2);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeVisible();
  await expect(page).toHaveURL(/\/fueling\/delete-entry$/);
  expect(api.calls()).toBe(2);
  expect(api.listCalls()).toBe(beforeLists);
  api.release();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByText('Nenhum abastecimento encontrado')).toBeVisible();
  expect(api.listCalls()).toBeGreaterThan(beforeLists);
  expect(api.summaryCalls()).toBeGreaterThan(beforeSummaries);
  expect(api.captured.every(headers => headers['if-match'] === '"3"')).toBe(true);
  await page.getByRole('tab', { name: 'Início', exact: true }).click();
  await expect(page.getByText('R$ 0,00', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.goto('/fueling/delete-entry', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Registro indisponível', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar abastecimento', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Opções do abastecimento', exact: true })).toBeDisabled();
});

test('detail menu is compact, dismisses without click-through and restores keyboard focus in both themes', async ({ page }) => {
  await setup(page);
  await history(page);
  await page.getByRole('button', { name: /^Abastecimento de R\$/ }).first().click();
  const options = page.getByRole('button', { name: 'Opções do abastecimento', exact: true });
  await expect(options).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Editar abastecimento', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Excluir abastecimento', exact: true })).toHaveCount(0);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await options.click();
    const menu = page.getByRole('menu', { name: 'Opções do abastecimento' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(2);
    await expect(menu.getByRole('menuitem', { name: 'Editar abastecimento' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Excluir abastecimento' })).toBeFocused();
    await page.screenshot({ path: test.info().outputPath(`detail-menu-${theme}.png`) });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(options).toBeFocused();
  }
  await options.click();
  const back = (await page.getByRole('button', { name: 'Voltar', exact: true }).boundingBox())!;
  await page.mouse.click(back.x + back.width / 2, back.y + back.height / 2);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page).toHaveURL(/\/fueling\/delete-entry$/);
  await options.click();
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page).toHaveURL(/\/history$/);
  await page.getByRole('button', { name: /^Abastecimento de R\$/ }).first().click();
  await expect(options).toBeEnabled();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await options.click();
  const triggerBox = (await options.boundingBox())!;
  const menuBox = (await page.getByRole('menu').boundingBox())!;
  expect(Math.abs(menuBox.x + menuBox.width - triggerBox.x - triggerBox.width)).toBeLessThan(2);
  expect(menuBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
  await page.screenshot({ path: test.info().outputPath('detail-menu-wide.png') });
  await page.keyboard.press('Escape');
});

test('detail actions stay unavailable while loading and after failed retrieval', async ({ page }) => {
  await setup(page);
  await history(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/fuel-entries/delete-entry', async route => {
    await gate;
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ status: 404, code: 'NOT_FOUND', detail: 'Registro indisponível.' }) });
  });
  await page.getByRole('button', { name: /^Abastecimento de R\$/ }).first().click();
  const options = page.getByRole('button', { name: 'Opções do abastecimento', exact: true });
  await expect(page.getByText('Carregando registro...')).toBeVisible();
  await expect(options).toBeDisabled();
  await expect(page.getByRole('menu')).toHaveCount(0);
  release();
  await expect(page.getByText('Registro indisponível', { exact: true })).toBeVisible();
  await expect(options).toBeDisabled();
  await expect(page.getByRole('menuitem')).toHaveCount(0);
});

test('history success keeps period and vehicle while refreshing totals', async ({ page }) => {
  const api = await setup(page);
  await history(page);
  const vehicleButton = page.getByRole('button', { name: /^Veículo:/ }).first();
  const periodButton = page.getByRole('button', { name: /^Período:/ }).first();
  const vehicleLabel = await vehicleButton.getAttribute('aria-label');
  const periodLabel = await periodButton.getAttribute('aria-label');
  await reveal(page);
  await captureConfirmation(page, 'confirm-light.png');
  await dialog(page).getByRole('button', { name: 'Excluir abastecimento', exact: true }).click();
  await expect(page.getByText('Nenhum abastecimento encontrado')).toBeVisible();
  await expect(vehicleButton).toHaveAttribute('aria-label', vehicleLabel!);
  await expect(periodButton).toHaveAttribute('aria-label', periodLabel!);
  await expect(page.getByText('R$ 0,00', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  expect(api.calls()).toBe(1);
});

test('stale version requires refreshed data and a new explicit confirmation', async ({ page }) => {
  const api = await setup(page);
  await history(page);
  await reveal(page);
  api.update();
  api.setStatus(412);
  await dialog(page).getByRole('button', { name: 'Excluir abastecimento', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: 'Excluir abastecimento', exact: true })).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Atualizar dados', exact: true }).click();
  await expect(dialog(page)).toContainText('R$ 59,00');
  expect(api.calls()).toBe(1);
  api.setStatus(204);
  await dialog(page).getByRole('button', { name: 'Excluir abastecimento', exact: true }).click();
  await expect(page.getByText('Nenhum abastecimento encontrado')).toBeVisible();
  expect(api.captured[1]['if-match']).toBe('"4"');
});
