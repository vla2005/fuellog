import { test, expect, type Page } from '@playwright/test';
import { createAccount, createVehicle } from './api-fixtures';

async function expectRenderedMap(page: Page, tiles: Set<string>, screenshotPath: string) {
  const map = page.getByTestId('location-map').filter({ visible: true });
  await map.scrollIntoViewIfNeeded();
  const frameElement = map.locator('iframe');
  await expect(frameElement).toBeVisible();
  const bounds = await frameElement.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThan(200);
  expect(Math.abs(bounds!.width - bounds!.height)).toBeLessThan(3);
  const frame = frameElement.contentFrame();
  await expect(frame.locator('.maplibregl-marker')).toBeVisible({ timeout: 20_000 });
  await expect(frame.getByRole('region', { name: 'Mapa', exact: true })).toBeVisible();
  await expect.poll(() => tiles.size, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(map.getByRole('link', { name: 'Direitos autorais do OpenStreetMap', exact: true })).toBeVisible();
  await expect(map.getByRole('button', { name: 'Tentar carregar o mapa novamente', exact: true })).toHaveCount(0);
  await map.screenshot({ path: screenshotPath });
}

test('OpenStreetMap real mostra tiles e marcador em Novo e Detalhe com coordenadas persistidas', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  // Somente o sensor do navegador é controlado no playwright.config; API e OSM são reais.
  const account = await createAccount(request);
  await createVehicle(request, account.headers);
  const tiles = new Set<string>();
  page.on('response', response => {
    if (new URL(response.url()).hostname === 'tile.openstreetmap.org' && response.ok()) tiles.add(response.url());
  });
  const opened = await page.goto('/login');
  expect(opened?.status(), 'Metro deve servir o app antes de verificar o mapa').toBe(200);
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);
  await page.getByRole('button', { name: 'Novo abastecimento', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recapturar localização atual', exact: true })).toBeVisible();
  await expectRenderedMap(page, tiles, testInfo.outputPath('map-new.png'));
  await page.getByLabel('Valor pago', { exact: true }).fill('50,00');
  await page.getByLabel('Preço por litro', { exact: true }).fill('5');
  await expect(page.getByRole('button', { name: /^Litros calculados:/ })).toContainText('10,000');
  await page.getByLabel('Hodômetro atual (km inteiro)', { exact: true }).fill('1000');
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && /\/fuel-entries$/.test(response.url()));
  await page.getByRole('button', { name: 'Salvar abastecimento', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  expect(await response.json()).toMatchObject({ latitude: -23.55052, longitude: -46.633308 });
  await expect(page).toHaveURL(/\/\/?$/);
  await page.getByRole('tab', { name: 'Histórico', exact: true }).click();
  await page.getByRole('button', { name: /^Abastecimento de R\$ 50,00, Gasolina comum, em / }).click();
  await expect(page).toHaveURL(/\/fueling\/[0-9a-f-]+$/);
  await expectRenderedMap(page, tiles, testInfo.outputPath('map-detail.png'));
});
