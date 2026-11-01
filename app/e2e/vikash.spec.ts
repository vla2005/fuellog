import { test, expect, Page } from '@playwright/test';
import { purchaseDashboard, fuelHistoryPage } from './api-fixtures';

// Explicit frontend fixtures; these tests do not claim a real ViKash connection.
const connectionId = '11111111-1111-4111-8111-111111111111';
const choices = { categoryId: 'default:1', paymentMethod: 'CREDIT_CARD', cardId: 'fixture-card', installments: 3 };
const catalog = { apiVersion: '1', currency: 'BRL', categories: [{ id: 'default:1', name: 'Combustível', kind: 'DEFAULT' }],
  accounts: [{ uuid: 'fixture-account', description: 'Carteira de teste', type: 'CARTEIRA' }], cards: [{ uuid: 'fixture-card', description: 'Cartão de teste · final 1234' }],
  paymentMethods: ['PIX', 'CREDIT_CARD'], installments: { min: 1, max: 120, creditOnly: true } };

async function fixture(page: Page, options: { configured?: boolean; catalogError?: boolean; connected?: boolean; theme?: string;
  status?: string; invalidChoices?: boolean; syncStatus?: string; syncCode?: string; deletions?: boolean } = {}) {
  let connected = options.connected ?? true;
  let saved: any = null;
  let failSave = false;
  let authStarts = 0;
  let saveCount = 0;
  let preferencesSaved: any = null;
  let resolution: any = null;
  const selected = options.invalidChoices ? { ...choices, cardId: 'archived-card' } : choices;
  const existing = { id: 'fixture-entry', vehicleId: 'fixture-vehicle', version: 0, occurredAt: '2026-10-30T15:30:00Z', timezone: 'America/Sao_Paulo', odometerKm: 120000,
    fuelType: 'ETHANOL', liters: '10.000', unitPrice: '5.0000', paidTotal: '50.00', referenceTotal: '50.00', adjustmentAmount: '0.00', adjustmentReason: null,
    latitude: -23.55052, longitude: -46.633308, idempotentReplay: false,
    vikash: { send: true, connectionId, choices: selected, status: options.syncStatus ?? 'SENT', code: options.syncCode ?? null, updatedAt: new Date().toISOString() } };
  await page.context().route('http://127.0.0.1:49579/oauth2/authorize**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="pt-BR"><title>ViKash fixture</title><body>Autorização de teste ViKash</body></html>' }));
  await page.addInitScript(({ theme }) => {
    sessionStorage.setItem('fuellog.auth.refresh_token.v1', 'fixture-refresh');
    if (theme) localStorage.setItem('fuellog:theme-preference:v1', theme);
  }, { theme: options.theme });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const method = route.request().method();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Content-Type, If-Match', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' };
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/auth/refresh') return reply({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'Bearer', expires_in: 900, access_expires_at: new Date(Date.now() + 900000).toISOString(), refresh_expires_at: new Date(Date.now() + 86400000).toISOString(), session_id: 'fixture-session' });
    if (path === '/me') return reply({ id: 'fixture-user', name: 'Motorista de teste', email: 'fuellog@example.test', preferredTimezone: 'America/Sao_Paulo' });
    if (path === '/me/2fa') return reply({ enabled: false, recoveryCodesRemaining: 0 });
    if (path === '/fuel-types') return reply(['ETHANOL']);
    if (path === '/vehicles') return reply([{ id: 'fixture-vehicle', nickname: 'Carro de teste', allowedFuels: ['ETHANOL'], archivedAt: null, version: 0 }]);
    if (path.endsWith('/dashboard')) return reply(purchaseDashboard());
    if (path.endsWith('/summary')) return reply({ purchaseCount: 0, paidTotal: '0.00', purchasedLiters: '0.000', weightedPaidPrice: null });
    if (path.endsWith('/fuel-entries')) {
      if (method === 'POST') {
        saveCount++;
        saved = route.request().postDataJSON();
        if (failSave) return reply({ detail: 'Falha temporária de teste', code: 'TEST_UNAVAILABLE' }, 503);
        return reply({ ...saved, vehicleId: 'fixture-vehicle', version: 0, idempotentReplay: false,
          referenceTotal: saved.paidTotal, adjustmentAmount: '0.00', adjustmentReason: null,
          vikash: saved.vikash?.send ? { ...saved.vikash, status: 'PENDING', code: null, updatedAt: new Date().toISOString() } : null }, 201);
      }
      return reply(fuelHistoryPage([]));
    }
    if (path.endsWith('/fuel-entries/fixture-entry')) {
      if (method === 'PUT') { saved = route.request().postDataJSON(); saveCount++; return reply({ ...existing, ...saved, version: 1, vikash: { ...saved.vikash, status: 'PENDING' } }); }
      return reply(existing);
    }
    if (path === '/integrations/vikash') {
      if (method === 'DELETE') { connected = false; return reply({ remoteRevoked: true }); }
      return reply({ status: options.status ?? (options.configured === false ? 'NOT_CONFIGURED' : connected ? 'CONNECTED' : 'DISCONNECTED'), configured: options.configured !== false,
        connectionId: connected ? connectionId : null, preferences: connected ? { automaticSend: true, choices: selected } : null });
    }
    if (path.endsWith('/catalog')) return options.catalogError ? reply({ code: 'VIKASH_UNAVAILABLE', detail: 'ViKash indisponível. Os padrões salvos continuam disponíveis.' }, 503) : reply(catalog);
    if (path.endsWith('/deletions')) return reply({ items: options.deletions ? [{ entryId: 'deleted-fixture', occurredAt: existing.occurredAt,
      paidTotal: '50.00', status: 'ACTION_REQUIRED', code: 'FINANCIAL_RESTRICTION' }] : [], page: 0, totalElements: options.deletions ? 1 : 0 });
    if (path.endsWith('/preferences')) { preferencesSaved = route.request().postDataJSON(); return reply(preferencesSaved); }
    if (path.endsWith('/remote')) return reply({ status: 'ACTIVE', version: 2, manuallyModified: true, etag: 'fixture-etag' });
    if (path.endsWith('/retry')) { resolution = route.request().postDataJSON(); return route.fulfill({ status: 204, headers }); }
    if (path.endsWith('/authorizations')) {
      if (method === 'DELETE') return route.fulfill({ status: 204, headers });
      authStarts++;
      await new Promise(resolve => setTimeout(resolve, 1200));
      return reply({ authorizationUrl: 'http://127.0.0.1:49579/oauth2/authorize?state=fixture-state', returnUrl: `${new URL(page.url()).origin}/vikash-return` });
    }
    return reply({ code: 'FIXTURE_UNHANDLED', path }, 404);
  });
  return { saved: () => saved, failSave: () => { failSave = true; }, authStarts: () => authStarts, saveCount: () => saveCount,
    preferences: () => preferencesSaved, resolution: () => resolution };
}

async function openSettings(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Integrações, ViKash', exact: true }).click();
  await expect(page.getByTestId('vikash-settings')).toBeVisible();
}

test('settings preserves dynamic payment destinations and safe disconnect', async ({ page }) => {
  const state = await fixture(page);
  await openSettings(page);
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible();
  await expect(page.getByTestId('vikash-cardId')).toContainText('Cartão de teste');
  await page.getByTestId('vikash-paymentMethod').click();
  await expect(page.getByRole('radio', { name: 'Pix', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Pix', exact: true }).click();
  await expect(page.getByTestId('vikash-cardId')).toHaveCount(0);
  await page.getByTestId('vikash-accountId').click();
  await page.getByRole('radio', { name: 'Carteira de teste', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar preferências', exact: true }).click();
  await expect(page.getByText('Preferências salvas', { exact: true })).toBeVisible();
  expect(state.preferences().choices).toEqual({ categoryId: 'default:1', paymentMethod: 'PIX', cardId: null, accountId: 'fixture-account', installments: 1 });
  await page.getByRole('alert').filter({ hasText: 'Preferências salvas' }).click();
  await page.getByRole('button', { name: 'Desconectar conta', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Desconectar ViKash?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Manter conexão' }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('unconfigured state has honest explanation and no connect action', async ({ page }) => {
  await fixture(page, { configured: false, connected: false }); await openSettings(page);
  await expect(page.getByText('Ainda não disponível', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar ao ViKash', exact: true })).toHaveCount(0);
});

test('catalog outage preserves defaults and saves paidTotal once as pending', async ({ page }) => {
  const state = await fixture(page, { catalogError: true });
  await page.goto('/fueling/new');
  await page.getByLabel('Valor pago', { exact: true }).fill('153,43');
  await page.getByLabel('Preço por litro', { exact: true }).fill('4,58');
  await page.getByLabel('Hodômetro atual (km inteiro)', { exact: true }).fill('120542');
  await expect(page.getByTestId('vikash-entry-section')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar abastecimento', exact: true }).click();
  await expect.poll(() => state.saved()?.paidTotal).toBe('153.43');
  expect(state.saved().vikash).toEqual({ send: true, connectionId, choices });
  expect(state.saveCount()).toBe(1);
  await expect(page).toHaveURL(/\/$/);
});

test('form asks before cancelling an existing financial entry', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/fueling/fixture-entry');
  await page.getByRole('button', { name: 'Opções do abastecimento' }).click();
  await page.getByRole('menuitem', { name: 'Excluir abastecimento' }).click();
  const deletion = page.getByRole('dialog', { name: 'Excluir abastecimento?' });
  await expect(deletion.getByText(/Excluir também solicita o cancelamento/)).toBeVisible();
  await deletion.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Opções do abastecimento' }).click();
  await page.getByRole('menuitem', { name: 'Editar abastecimento' }).click();
  await expect(page.getByTestId('vikash-entry-section')).toBeVisible();
  await page.getByRole('switch', { name: 'Enviar ao ViKash' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Desativar envio ao ViKash?' });
  await expect(confirmation).toBeVisible(); expect(state.saveCount()).toBe(0);
  await confirmation.getByRole('button', { name: 'Manter envio ao ViKash' }).click();
  await expect(page.getByRole('switch', { name: 'Enviar ao ViKash' })).toBeChecked();
  await page.getByRole('switch', { name: 'Enviar ao ViKash' }).click();
  await confirmation.getByRole('button', { name: 'Desativar envio ao salvar' }).click();
  await expect(page.getByRole('switch', { name: 'Enviar ao ViKash' })).not.toBeChecked(); expect(state.saveCount()).toBe(0);
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect.poll(() => state.saved()?.vikash?.send).toBe(false); expect(state.saveCount()).toBe(1);
});

test('delayed authorization prepares URL before direct continuation click opens system browser popup', async ({ page }) => {
  const state = await fixture(page, { connected: false }); await openSettings(page);
  await page.getByRole('button', { name: 'Conectar ao ViKash', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continuar ao ViKash', exact: true })).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continuar ao ViKash', exact: true }).click();
  const popup = await popupPromise;
  await expect.poll(() => popup.url()).toContain('/oauth2/authorize');
  expect(state.authStarts()).toBe(1);
  await popup.close();
});

test('entry disclosure keeps changes and the draft after a failed save', async ({ page }) => {
  const state = await fixture(page);
  state.failSave();
  await page.goto('/fueling/new');
  const panel = page.getByTestId('vikash-entry-section');
  await expect(panel.getByTestId('vikash-fields')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Ajustar destino ViKash' }).click();
  await panel.getByTestId('vikash-installments').click();
  await page.getByRole('radio', { name: '5x', exact: true }).click();
  await expect(panel.getByTestId('vikash-destination')).toContainText('5x');
  await panel.getByTestId('vikash-paymentMethod').click();
  await page.getByRole('radio', { name: 'Pix', exact: true }).click();
  await expect(panel.getByTestId('vikash-cardId')).toHaveCount(0);
  await expect(panel.getByTestId('vikash-installments')).toHaveCount(0);
  await panel.getByTestId('vikash-accountId').click();
  await page.getByRole('radio', { name: 'Carteira de teste', exact: true }).click();
  await panel.getByRole('button', { name: 'Recolher escolhas ViKash' }).click();
  await expect(panel.getByTestId('vikash-fields')).toHaveCount(0);
  await page.getByLabel('Valor pago', { exact: true }).fill('153,43');
  await page.getByLabel('Preço por litro', { exact: true }).fill('4,58');
  await page.getByLabel('Hodômetro atual (km inteiro)', { exact: true }).fill('120542');
  await page.getByRole('button', { name: 'Salvar abastecimento', exact: true }).click();
  await expect(page.getByText('Falha temporária de teste', { exact: true })).toBeVisible();
  expect(state.saved().vikash.choices).toEqual({ categoryId: 'default:1', paymentMethod: 'PIX', cardId: null, accountId: 'fixture-account', installments: 1 });
  await page.reload();
  await expect(page.getByLabel('Valor pago', { exact: true })).toHaveValue('153,43');
  await expect(panel.getByTestId('vikash-destination')).toContainText('Carteira de teste');
  await expect(panel.getByTestId('vikash-destination')).toContainText('Pix');
  await expect(panel.getByTestId('vikash-fields')).toHaveCount(0);
});

test('invalid saved choices open immediately and can be corrected', async ({ page }) => {
  await fixture(page, { invalidChoices: true });
  await page.goto('/fueling/new');
  const panel = page.getByTestId('vikash-entry-section');
  await expect(panel.getByTestId('vikash-fields')).toBeVisible();
  await expect(panel.getByText('Cartão indisponível', { exact: true })).toBeVisible();
  await panel.getByTestId('vikash-cardId').click();
  await page.getByRole('radio', { name: 'Cartão de teste · final 1234', exact: true }).click();
  await expect(panel.getByTestId('vikash-destination')).toContainText('Cartão de teste · final 1234');
  await expect(panel.getByTestId('vikash-fields')).toBeVisible();
  await expect(panel.getByTestId('vikash-cardId')).toBeFocused();
  await panel.getByRole('button', { name: 'Recolher escolhas ViKash' }).click();
  await expect(panel.getByTestId('vikash-fields')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Ajustar destino ViKash' })).toBeVisible();
});

test('expired state stays honest in the menu and integration', async ({ page }) => {
  await fixture(page, { status: 'EXPIRED', connected: false });
  await page.goto('/settings');
  await expect(page.getByTestId('vikash-menu-card')).toContainText('Conexão expirada');
  await page.getByTestId('vikash-menu-card').click();
  await expect(page.getByRole('button', { name: 'Conectar novamente ao ViKash', exact: true })).toBeVisible();
  await expect(page.getByTestId('vikash-destination')).toHaveCount(0);
});

test('conflict review keeps the safe choice and only overwrites after explicit action', async ({ page }) => {
  const state = await fixture(page, { syncStatus: 'ACTION_REQUIRED', syncCode: 'PRECONDITION_FAILED' });
  await page.goto('/fueling/fixture-entry');
  await expect(page.getByTestId('vikash-sync-status')).toContainText('Precisa da sua atenção');
  await page.getByRole('button', { name: 'Revisar conflito ViKash' }).click();
  const dialog = page.getByRole('dialog', { name: 'Conflito no ViKash' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Manter lançamento no ViKash' }).click();
  expect(state.resolution()).toBeNull();
  await page.getByRole('button', { name: 'Revisar conflito ViKash' }).click();
  await dialog.getByRole('button', { name: 'Enviar versão FuelLog' }).click();
  await expect.poll(() => state.resolution()).toEqual({ resolution: 'OVERWRITE', remoteEtag: 'fixture-etag' });
});

test('cancellation panel preserves paid-invoice restrictions and real fixture values', async ({ page }) => {
  await fixture(page, { deletions: true });
  await openSettings(page);
  const panel = page.getByTestId('vikash-deletions');
  await expect(panel).toContainText('50,00');
  await expect(panel).toContainText('pagamentos não serão desfeitos');
  await expect(panel.getByRole('button', { name: 'Tentar cancelamento novamente' })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) for (const width of [320, 390]) {
  test(`visual batch ${theme} ${width}: menu, integration and entry`, async ({ page }, testInfo) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    await fixture(page, { theme });
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/settings');
    await expect(page.getByTestId('vikash-menu-card')).toContainText('Conectado');
    await page.screenshot({ path: testInfo.outputPath(`menu-${theme}-${width}.png`), fullPage: true });
    await page.getByTestId('vikash-menu-card').click();
    await expect(page.getByTestId('vikash-cardId')).toContainText('Cartão de teste');
    const settingsSwitch = page.getByRole('switch', { name: 'Envio automático ao ViKash' });
    const switchBox = await settingsSwitch.boundingBox();
    expect(switchBox!.width).toBeGreaterThanOrEqual(44);
    expect(switchBox!.height).toBeGreaterThanOrEqual(44);
    expect(await settingsSwitch.evaluate(input => getComputedStyle(input.previousElementSibling!).backgroundColor)).toBe('rgb(255, 255, 255)');
    const category = await page.getByTestId('vikash-categoryId').boundingBox();
    const payment = await page.getByTestId('vikash-paymentMethod').boundingBox();
    expect(width === 390 ? Math.abs(category!.y - payment!.y) < 1 : payment!.y > category!.y).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`integration-${theme}-${width}.png`), fullPage: true });
    const save = page.getByRole('button', { name: 'Salvar preferências', exact: true });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    const dock = await page.getByRole('tab', { name: 'Ajustes', exact: true }).boundingBox();
    const saveBox = await save.boundingBox();
    if (dock) expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(dock.y);
    await page.screenshot({ path: testInfo.outputPath(`integration-bottom-${theme}-${width}.png`), fullPage: true });
    await page.goto('/fueling/new');
    await expect(page.getByTestId('vikash-entry-section')).toContainText('Cartão de teste');
    await page.getByRole('button', { name: 'Salvar abastecimento', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`entry-${theme}-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(await page.getByTestId('vikash-entry-section').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    if (theme === 'dark' && width === 320) {
      await page.getByRole('button', { name: 'Ajustar destino ViKash' }).click();
      // Browser text enlargement exercises wrapping; native fontScale needs a device.
      await page.addStyleTag({ content: '[data-testid="vikash-entry-section"] [dir="auto"] { font-size: 150% !important; line-height: 1.4 !important; }' });
      await page.getByTestId('vikash-entry-section').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: testInfo.outputPath('entry-expanded-top-text150-dark-320.png'), fullPage: true });
      await page.getByTestId('vikash-fields').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('entry-expanded-text150-dark-320.png'), fullPage: true });
      expect(await page.getByTestId('vikash-entry-section').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    expect(runtimeErrors).toEqual([]);
  });
}
