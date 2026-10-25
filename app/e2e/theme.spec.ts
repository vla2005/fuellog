import { test, expect } from '@playwright/test';
import { createAccount } from './api-fixtures';

test('preferência de tema publica estado acessível claro e escuro', async ({ page, request }) => {
  const account = await createAccount(request);
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);
  await page.goto('/settings');
  for (const name of ['Modo Claro', 'Modo Escuro']) {
    const choice = page.getByRole('radio', { name, exact: true });
    await choice.click();
    await expect(choice).toBeChecked();
    await expect(page.getByRole('radio', { name: name === 'Modo Claro' ? 'Modo Escuro' : 'Modo Claro', exact: true })).not.toBeChecked();
  }
});
