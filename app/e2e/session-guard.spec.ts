import { test, expect } from '@playwright/test';
import { apiURL, createAccount } from './api-fixtures';

for (const state of ['invalid', 'revoked'] as const) {
  test(`boot com refresh ${state} redireciona login sem dados protegidos`, async ({ page, request }) => {
    let refresh = 'invalid-refresh-token';
    if (state === 'revoked') {
      const account = await createAccount(request);
      refresh = account.tokens.refresh_token;
      const logout = await request.post(`${apiURL}/auth/logout`, { headers: account.headers });
      expect(logout.status()).toBe(204);
    }
    await page.addInitScript(value => sessionStorage.setItem('fuellog.auth.refresh_token.v1', value), refresh);
    await page.goto('/history');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Filtrar histórico', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('fuellog.auth.refresh_token.v1'))).toBeNull();
  });
}
