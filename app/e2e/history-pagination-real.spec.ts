import { expect, test } from '@playwright/test';
import { apiURL, createAccount, createVehicle, fuelEntry } from './api-fixtures';

test('histórico integrado: 21 compras, totais completos, segunda página e exclusão final', async ({ page, request }) => {
  test.setTimeout(90_000);
  const owner = await createAccount(request);
  const vehicle = await createVehicle(request, owner.headers, 'Histórico integrado');
  const occurredAt = new Date(Date.now() - 3_600_000).toISOString();
  for (let index = 0; index < 21; index++) {
    const response = await request.post(`${apiURL}/vehicles/${vehicle.id}/fuel-entries`, {
      headers: owner.headers, data: { ...fuelEntry(1000, 1), occurredAt },
    });
    expect(response.status()).toBe(201);
  }
  const first = await request.get(`${apiURL}/vehicles/${vehicle.id}/fuel-entries`, { headers: owner.headers });
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({ size: 20, totalElements: 21, totalPages: 2,
    summary: { paidTotal: '1155.00', purchasedLiters: '212.625' } });
  // Keep the journey on the local API even when the user's Metro points to a device LAN address.
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url());
    return route.continue({ url: `${apiURL}${url.pathname.split('/api/v1')[1]}${url.search}` });
  });
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(owner.email);
  await page.getByLabel('Senha', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);
  await page.getByRole('tab', { name: 'Histórico', exact: true }).click();
  const rows = page.getByRole('button', { name: /^Abastecimento de R\$/ });
  const footer = page.getByTestId('history-pagination');
  await expect(rows).toHaveCount(20);
  await expect(page.getByTestId('history-summary')).toContainText('R$ 1.155,00');
  await expect(footer).toContainText('1–20 de 21');
  await footer.getByRole('button', { name: 'Próxima página', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(footer).toContainText('21–21 de 21');
  await page.getByRole('button', { name: /^Ver detalhes de abastecimento/ }).click();
  await expect(page).toHaveURL(/\/fueling\/[a-f0-9-]+$/);
  await page.getByRole('button', { name: 'Opções do abastecimento', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Excluir abastecimento', exact: true }).click();
  await page.getByRole('dialog', { name: 'Excluir abastecimento?' }).getByRole('button', { name: 'Excluir abastecimento', exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(rows).toHaveCount(20);
  await expect(footer).toContainText('1–20 de 20');
  await expect(page.getByTestId('history-summary')).toContainText('R$ 1.100,00');
  const after = await request.get(`${apiURL}/vehicles/${vehicle.id}/fuel-entries`, { headers: owner.headers });
  expect(await after.json()).toMatchObject({ totalElements: 20, totalPages: 1,
    summary: { paidTotal: '1100.00', purchasedLiters: '202.500' } });
});
