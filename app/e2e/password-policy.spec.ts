import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiURL } from './api-fixtures';

test('cadastro rejeita cinco e aceita exatamente seis caracteres', async ({ page }) => {
  test.setTimeout(90_000);
  const email = `password-six-${randomUUID()}@example.test`;
  let registrations = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && /\/auth\/register$/.test(request.url())) registrations += 1;
  });
  await page.goto('/register');
  await page.getByLabel('Nome', { exact: true }).fill('Limite senha');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  const password = page.getByLabel('Senha', { exact: true });
  const submit = page.getByRole('button', { name: 'Criar conta', exact: true });
  await password.fill('Ab1!x');
  await submit.click();
  await expect(page.getByText(/A senha deve ter entre 6 e 128 caracteres/)).toBeVisible();
  expect(registrations).toBe(0);
  await password.fill('Ab1!xy');
  const registered = page.waitForResponse(response => /\/auth\/register$/.test(response.url()) && response.request().method() === 'POST');
  await submit.click();
  expect((await registered).status()).toBe(201);
  await expect(page).toHaveURL(/\/\/?$/);
  await page.goto('/settings');
  await page.getByText('Minha conta >', { exact: true }).click();
  await expect(page.getByText(email, { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Ab1!xy');
  const loggedIn = page.waitForResponse(response => /\/auth\/login$/.test(response.url()) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  expect((await loggedIn).status()).toBe(200);
  await expect(page).toHaveURL(/\/\/?$/);
  expect(registrations).toBe(1);
});

test('cadastro preserva máximo de 128 caracteres na UI e no servidor', async ({ page, request }) => {
  const email = `password-max-${randomUUID()}@example.test`;
  const password = 'Ab1!'.repeat(32);
  const excessive = await request.post(`${apiURL}/auth/register`, {
    data: { name: 'Limite superior', email, password: `${password}x` },
  });
  expect(excessive.status()).toBe(422);
  await page.goto('/register');
  await page.getByLabel('Nome', { exact: true }).fill('Limite superior');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(`${password}x`);
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByText(/A senha deve ter entre 6 e 128 caracteres/)).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  const registered = page.waitForResponse(response => /\/auth\/register$/.test(response.url()) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  expect((await registered).status()).toBe(201);
  await expect(page).toHaveURL(/\/\/?$/);
});
