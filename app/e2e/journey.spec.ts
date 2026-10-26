import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { password } from './api-fixtures';

test('cadastro real, veículo, temas, logout e login pela interface', async ({ page }) => {
  // Percorre os controles reais da navegação persistente, sem recarregar o app entre telas.
  test.setTimeout(90_000);
  const email = `ui-${randomUUID()}@example.test`;
  const vehicle = `Carro ${randomUUID().slice(0, 8)}`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByLabel('Nome', { exact: true }).fill('Pessoa E2E');
  await page.getByLabel('E-mail', { exact: true }).filter({ visible: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).filter({ visible: true }).fill(password);
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);
  await page.getByRole('tab', { name: 'Veículos', exact: true }).click();
  await expect(page).toHaveURL(/\/vehicles$/);
  await page.getByRole('button', { name: /^(Novo|Cadastrar) veículo$/ }).filter({ visible: true }).click();
  for (const label of ['Apelido do veículo', 'Marca', 'Ano', 'Placa']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  }
  await page.getByLabel('Modelo', { exact: true }).fill(vehicle);
  await expect(page.getByLabel('Capacidade do tanque (opcional)', { exact: true })).toBeVisible();
  await page.getByLabel('Capacidade do tanque (opcional)', { exact: true }).fill('50,125');
  await page.getByLabel('Quilometragem atual (opcional)', { exact: true }).fill('900');
  const createdVehicle = page.waitForResponse(response => response.request().method() === 'POST' && /\/vehicles$/.test(response.url()));
  await page.getByRole('button', { name: 'Salvar veículo', exact: true }).click();
  expect(await (await createdVehicle).json()).toMatchObject({ nickname: vehicle, model: vehicle, currentOdometerKm: 900, tankCapacityLiters: '50.125' });
  await expect(page.getByLabel(`Trocar veículo ativo. Atual: ${vehicle}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Novo abastecimento', exact: true }).click();
  await expect(page).toHaveURL(/\/fueling\/new$/);
  await page.getByLabel('Litros abastecidos', { exact: true }).fill('10,125');
  await page.getByLabel('Preço por litro', { exact: true }).fill('5,4321');
  await page.getByLabel('Hodômetro atual (km inteiro)', { exact: true }).fill('1000');
  await expect(page.getByRole('button', { name: 'Recapturar localização atual', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Tanque cheio', exact: true })).toHaveCount(0);
  let uncertainPayload: unknown;
  const failureRoute = '**/vehicles/*/fuel-entries';
  await page.route(failureRoute, async route => {
    if (route.request().method() === 'POST') {
      uncertainPayload = route.request().postDataJSON();
      await route.abort('connectionfailed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Salvar abastecimento', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Reenviar abastecimento com mesmo ID', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByLabel('Litros abastecidos', { exact: true })).toHaveValue('10,125');
  await expect(page.getByLabel('Hodômetro atual (km inteiro)', { exact: true })).toHaveValue('1000');
  await page.unroute(failureRoute);
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && /\/fuel-entries$/.test(response.url()));
  await retry.click();
  const response = await saved;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toEqual(uncertainPayload);
  const persisted = await response.json();
  expect(persisted).toMatchObject({ liters: '10.125', unitPrice: '5.4321', paidTotal: '55.00',
    latitude: -23.55052, longitude: -46.633308, tankState: 'UNKNOWN', historyGapBefore: false,
    stationName: null, notes: null });
  await expect(page).toHaveURL(/\/\/?$/);
  await page.getByRole('tab', { name: 'Histórico', exact: true }).click();
  await page.getByRole('button', { name: /^Abastecimento de R\$ 55,00 em / }).click();
  await expect(page).toHaveURL(/\/fueling\/[0-9a-f-]+$/);
  await expect(page.getByText('Litros', { exact: true }).filter({ visible: true })).toBeVisible();
  const readBack = await page.request.get(`${new URL(response.url()).origin}/api/v1/vehicles/${persisted.vehicleId}/fuel-entries/${persisted.id}`, {
    headers: { Authorization: response.request().headers().authorization },
  });
  expect(readBack.status()).toBe(200);
  expect(await readBack.json()).toMatchObject({ latitude: persisted.latitude, longitude: persisted.longitude });
  await expect(page.getByText('10,125 L', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/history$/);
  await page.getByRole('tab', { name: 'Ajustes', exact: true }).click();
  await mkdir('test-results/qa', { recursive: true });
  for (const [label, theme] of [['Modo Claro', 'light'], ['Modo Escuro', 'dark']]) {
    await page.getByRole('button', { name: 'Aparência e tema', exact: true }).click();
    const choice = page.getByRole('radio', { name: label, exact: true });
    await choice.click();
    await page.getByRole('button', { name: 'Aparência e tema', exact: true }).click();
    await expect(choice).toBeChecked();
    await page.getByLabel('Fechar', { exact: true }).click();
    await page.screenshot({ path: `test-results/qa/settings-${theme}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('E-mail', { exact: true }).filter({ visible: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).filter({ visible: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);
  await page.getByRole('tab', { name: 'Veículos', exact: true }).click();
  await expect(page.getByLabel(`Trocar veículo ativo. Atual: ${vehicle}`, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
