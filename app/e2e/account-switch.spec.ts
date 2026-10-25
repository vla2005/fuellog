import { test, expect, type Page } from '@playwright/test';
import { createAccount, createVehicle } from './api-fixtures';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('login inválido não mostra dados; logout A e login B isolam veículos', async ({ page, request }) => {
  // Jornada completa com vários cold reloads do Metro medidos em cerca de 6 s cada.
  test.setTimeout(90_000);
  const a = await createAccount(request);
  const b = await createAccount(request);
  await createVehicle(request, a.headers, 'Privado conta A');
  await createVehicle(request, b.headers, 'Privado conta B');
  const rejectedLogin = page.waitForResponse(response => /\/auth\/login$/.test(response.url()) && response.request().method() === 'POST');
  await login(page, a.email, 'wrong-password');
  expect((await rejectedLogin).status()).toBe(401);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Privado conta A', { exact: true })).toHaveCount(0);
  await login(page, a.email, a.password);
  await expect(page).toHaveURL(/\/\/?$/);
  await page.goto('/vehicles');
  await expect(page.getByLabel('Selecionar veículo Privado conta A', { exact: true })).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, b.email, b.password);
  await expect(page).toHaveURL(/\/\/?$/);
  await page.goto('/vehicles');
  await expect(page.getByLabel('Selecionar veículo Privado conta B', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Selecionar veículo Privado conta A', { exact: true })).toHaveCount(0);
});
