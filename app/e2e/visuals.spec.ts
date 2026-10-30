import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { apiURL, createAccount, createVehicle, fuelEntry } from './api-fixtures';

async function capture(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(image => image.decode()));
    await Promise.all(Array.from(document.querySelectorAll('*')).flatMap(element => {
      const match = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (!match) return [];
      const image = new Image();
      image.src = match[1];
      return [image.decode()];
    }));
  });
  await mkdir('test-results/qa', { recursive: true });
  await page.screenshot({ path: `test-results/qa/${name}-390x844.png`, fullPage: false });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`capturas reais dashboard, formulário e histórico ${colorScheme}`, async ({ page, request }) => {
    const account = await createAccount(request);
    const vehicle = await createVehicle(request, account.headers, 'Carro QA');
    for (const entry of [fuelEntry(1000, 'FULL', 3), fuelEntry(1100, 'PARTIAL', 2), fuelEntry(1200, 'FULL', 1)]) {
      const result = await request.post(`${apiURL}/vehicles/${vehicle.id}/fuel-entries`, { headers: account.headers, data: entry });
      expect(result.status()).toBe(201);
    }
    // O sistema define aparência; preferência permanece 'system'. Seleção por rádio tem teste independente.
    await page.emulateMedia({ colorScheme });
    await page.goto('/login');
    await page.getByLabel('E-mail', { exact: true }).fill(account.email);
    await page.getByLabel('Senha', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/\/?$/);
    await expect(page.getByText('R$ 165,00', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    if (process.env.FUELLOG_QA_FUEL_HISTORY_ONLY !== '1') await capture(page, `dashboard-${colorScheme}`);
    if (process.env.FUELLOG_QA_DASHBOARD_ONLY === '1') return;
    await page.goto('/fueling/new');
    await expect(page.getByRole('button', { name: /^Litros calculados:/ })).toBeVisible();
    await capture(page, `fueling-form-${colorScheme}`);
    await page.goto('/history');
    await expect(page.getByRole('button', { name: /^Abastecimento de R\$ 55,00, Gasolina comum, em / }).first()).toBeVisible();
    await capture(page, `history-${colorScheme}`);
  });
}
