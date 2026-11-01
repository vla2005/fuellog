import { test, expect, Page } from '@playwright/test';
import { purchaseDashboard, fuelHistoryPage } from './api-fixtures';

// Explicit frontend fixtures; these tests do not claim a real ViKash connection.
const connectionId = '11111111-1111-4111-8111-111111111111';
const choices = { categoryId: 'default:1', paymentMethod: 'CREDIT_CARD', cardId: 'fixture-card', installments: 3 };
const catalog = { apiVersion: '1', currency: 'BRL', categories: [{ id: 'default:1', name: 'Combustível', kind: 'DEFAULT' }],
  accounts: [{ uuid: 'fixture-account', description: 'Carteira de teste', type: 'CARTEIRA' }], cards: [{ uuid: 'fixture-card', description: 'Cartão de teste · final 1234' }],
  paymentMethods: ['PIX', 'CREDIT_CARD'], installments: { min: 1, max: 120, creditOnly: true } };

async function fixture(page: Page, options: { configured?: boolean; catalogError?: boolean; connected?: boolean; theme?: string } = {}) {
  let connected = options.connected ?? true;
  let saved: any = null;
  let failSave = false;
  let authStarts = 0;
  let saveCount = 0;
  const existing = { id: 'fixture-entry', vehicleId: 'fixture-vehicle', version: 0, occurredAt: '2026-10-30T15:30:00Z', timezone: 'America/Sao_Paulo', odometerKm: 120000,
    fuelType: 'ETHANOL', liters: '10.000', unitPrice: '5.0000', paidTotal: '50.00', referenceTotal: '50.00', adjustmentAmount: '0.00', adjustmentReason: null,
    latitude: -23.55052, longitude: -46.633308, idempotentReplay: false,
    vikash: { send: true, connectionId, choices, status: 'SENT', code: null, updatedAt: new Date().toISOString() } };
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
      return reply({ status: options.configured === false ? 'NOT_CONFIGURED' : connected ? 'CONNECTED' : 'DISCONNECTED', configured: options.configured !== false,
        connectionId: connected ? connectionId : null, preferences: connected ? { automaticSend: true, choices } : null });
    }
    if (path.endsWith('/catalog')) return options.catalogError ? reply({ code: 'VIKASH_UNAVAILABLE', detail: 'ViKash indisponível. Os padrões salvos continuam disponíveis.' }, 503) : reply(catalog);
    if (path.endsWith('/deletions')) return reply({ items: [], page: 0, totalElements: 0 });
    if (path.endsWith('/preferences')) return reply(route.request().postDataJSON());
    if (path.endsWith('/authorizations')) {
      if (method === 'DELETE') return route.fulfill({ status: 204, headers });
      authStarts++;
      await new Promise(resolve => setTimeout(resolve, 1200));
      return reply({ authorizationUrl: 'http://127.0.0.1:49579/oauth2/authorize?state=fixture-state', returnUrl: `${new URL(page.url()).origin}/vikash-return` });
    }
    return reply({ code: 'FIXTURE_UNHANDLED', path }, 404);
  });
  return { saved: () => saved, failSave: () => { failSave = true; }, authStarts: () => authStarts, saveCount: () => saveCount };
}

async function openSettings(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Integrações, ViKash', exact: true }).click();
  await expect(page.getByTestId('vikash-settings')).toBeVisible();
}

test('settings matches connected design, dynamic choices and safe disconnect in light/dark at narrow width', async ({ page }, testInfo) => {
  await fixture(page);
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
  await page.getByRole('alert').filter({ hasText: 'Preferências salvas' }).click();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 780 });
    await page.getByText('Integração ViKash', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`settings-${colorScheme}-320.png`), fullPage: true });
    await page.getByRole('button', { name: 'Salvar preferências', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Salvar preferências', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: 'Desconectar conta', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Desconectar conta', exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`settings-${colorScheme}-320-bottom.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
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

test('form keeps approved fields readable in both themes and asks before cancelling an existing financial entry', async ({ page }, testInfo) => {
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
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width: 320, height: 780 });
    await page.getByTestId('vikash-entry-section').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`form-${colorScheme}-320.png`), fullPage: true });
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Salvar alterações', exact: true })).toBeInViewport();
  }
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
