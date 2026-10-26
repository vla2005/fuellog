import { test, expect } from '@playwright/test';
import { createAccount, createVehicle } from './api-fixtures';

test('logout com falha de remoção limpa tela, avisa e não rejeita globalmente', async ({ page, request }, testInfo) => {
  const account = await createAccount(request);
  await createVehicle(request, account.headers, 'Veículo privado logout');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);
  await page.goto('/settings');
  await page.getByText('Minha conta >', { exact: true }).click();
  await expect(page.getByText(account.email, { exact: false })).toBeVisible();
  await page.evaluate(() => {
    const captured: string[] = [];
    (window as unknown as { logoutRejections: string[] }).logoutRejections = captured;
    window.addEventListener('unhandledrejection', event => captured.push(String(event.reason)));
    const originalRemove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) {
      if (this === window.sessionStorage && key === 'fuellog.auth.refresh_token.v1') {
        throw new Error('Storage removal denied by E2E');
      }
      return originalRemove.call(this, key);
    };
  });
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await expect(page.getByText(account.email, { exact: false })).toHaveCount(0);
  await expect(page.getByText('Falha ao limpar credencial persistida', { exact: true })).toBeVisible();
  const rejections = await page.evaluate(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    return (window as unknown as { logoutRejections: string[] }).logoutRejections;
  });
  await testInfo.attach('logout-errors', { body: JSON.stringify({ errors, rejections }, null, 2), contentType: 'application/json' });
  expect(rejections).toEqual([]);
  expect(errors).toEqual([]);
});
