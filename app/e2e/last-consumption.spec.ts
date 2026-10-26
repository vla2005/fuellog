import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { apiURL, createAccount, createVehicle } from './api-fixtures';

test('resumo separa média mensal de 20 km/L do último ciclo global de 30 km/L', async ({ page, request }) => {
  const account = await createAccount(request);
  const vehicle = await createVehicle(request, account.headers, 'Último consumo E2E');
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  for (const [index, odometerKm] of [1000, 1100, 1400].entries()) {
    const response = await request.post(`${apiURL}/vehicles/${vehicle.id}/fuel-entries`, {
      headers: account.headers,
      data: { id: randomUUID(), occurredAt: `${year}-${month}-0${index + 1}T12:00:00-03:00`,
        timezone: 'America/Sao_Paulo', odometerKm, fuelType: 'GASOLINE_REGULAR', liters: '10.000',
        unitPrice: '5.0000', paidTotal: '50.00', tankState: 'FULL', historyGapBefore: false,
        latitude: -23.55052, longitude: -46.633308 },
    });
    expect(response.status()).toBe(201);
  }
  const to = new Date(year, now.getMonth() + 1, 0).getDate();
  const summaryResponse = await request.get(`${apiURL}/vehicles/${vehicle.id}/summary`, {
    headers: account.headers, params: { from: `${year}-${month}-01`, to: `${year}-${month}-${to}` },
  });
  expect(summaryResponse.status()).toBe(200);
  const summary = await summaryResponse.json();
  expect(summary).toMatchObject({ validCycleCount: 2, periodConsumptionKmPerLiter: '20.00',
    lastValidCycle: { consumptionKmPerLiter: '30.00', distanceKm: 300, liters: '10.000' } });

  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);
  await page.getByRole('button', { name: 'Ver resumo do mês', exact: true }).click();
  await expect(page.getByText('20,00 km/L', { exact: true })).toBeVisible();
  await expect(page.getByText('30,00 km/L', { exact: true })).toHaveCount(0);

  const previous = new Date(year, now.getMonth() - 1, 1);
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(previous)
    .replace(' de ', ' ');
  const previousMonth = String(previous.getMonth() + 1).padStart(2, '0');
  const previousSummary = await request.get(`${apiURL}/vehicles/${vehicle.id}/summary`, {
    headers: account.headers, params: { from: `${previous.getFullYear()}-${previousMonth}-01`,
      to: `${previous.getFullYear()}-${previousMonth}-${new Date(previous.getFullYear(), previous.getMonth() + 1, 0).getDate()}` },
  });
  expect(previousSummary.status()).toBe(200);
  expect(await previousSummary.json()).toMatchObject({ purchaseCount: 0, periodConsumptionKmPerLiter: null,
    lastValidCycle: { consumptionKmPerLiter: '30.00' } });
  await page.getByRole('button', { name: /^Mês:/ }).click();
  const refreshedSummary = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/vehicles/${vehicle.id}/summary`)
      && url.searchParams.get('from') === `${previous.getFullYear()}-${previousMonth}-01`;
  });
  await page.getByText(new RegExp(`^${label}$`, 'i')).click();
  const browserSummary = await refreshedSummary;
  expect(browserSummary.status()).toBe(200);
  const selectedSummary = await browserSummary.json();
  expect(selectedSummary).toMatchObject({ purchaseCount: 0, periodConsumptionKmPerLiter: null,
    lastValidCycle: { consumptionKmPerLiter: '30.00', startedAt: summary.lastValidCycle.startedAt,
      endedAt: summary.lastValidCycle.endedAt } });
  await expect(page.getByText('Consumo não disponível', { exact: true })).toBeVisible();
  await expect(page.getByText('20,00 km/L', { exact: true })).toHaveCount(0);
});
