import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { password } from './api-fixtures';

test('cadastro real, veículo, temas, logout e login pela interface', async ({ page }) => {
  // Jornada completa com vários cold reloads do Metro medidos em cerca de 6 s cada.
  test.setTimeout(90_000);
  const email = `ui-${randomUUID()}@example.test`;
  const vehicle = `Carro ${randomUUID().slice(0, 8)}`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/register');
  await page.getByLabel('Nome', { exact: true }).fill('Pessoa E2E');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByLabel('Confirmar senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);
  await page.goto('/vehicles');
  await page.getByRole('button', { name: 'Novo veículo', exact: true }).click();
  await page.getByLabel('Apelido do veículo', { exact: true }).fill(vehicle);
  await page.getByRole('button', { name: 'Salvar veículo', exact: true }).click();
  await expect(page.getByLabel(`Selecionar veículo ${vehicle}`, { exact: true })).toBeVisible();
  await page.goto('/fueling/new');
  await page.getByLabel('Litros abastecidos', { exact: true }).fill('10,125');
  await page.getByLabel('Preço por litro', { exact: true }).fill('5,4321');
  await page.getByLabel('Hodômetro atual (km inteiro)', { exact: true }).fill('1000');
  await page.getByRole('radio', { name: 'Tanque cheio', exact: true }).click();
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
  expect(await response.json()).toMatchObject({ liters: '10.125', unitPrice: '5.4321', paidTotal: '55.00' });
  await expect(page).toHaveURL(/\/\/?$/);
  await page.goto('/history');
  await page.getByRole('button', { name: /^Abastecimento de R\$ 55,00 em / }).click();
  await expect(page).toHaveURL(/\/fueling\/[0-9a-f-]+$/);
  await expect(page.getByText('Volume abastecido', { exact: true })).toBeVisible();
  await expect(page.getByText('10,125 L', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.goto('/settings');
  await mkdir('test-results/qa', { recursive: true });
  for (const [label, theme] of [['Modo Claro', 'light'], ['Modo Escuro', 'dark']]) {
    const choice = page.getByRole('radio', { name: label, exact: true });
    await choice.click();
    await expect(choice).toBeChecked();
    await page.screenshot({ path: `test-results/qa/settings-${theme}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);
  await page.goto('/vehicles');
  await expect(page.getByLabel(`Selecionar veículo ${vehicle}`, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
