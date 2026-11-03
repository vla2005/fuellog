import { expect, test } from '@playwright/test';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`cadastro confirma código, preserva erro e reenvia em ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ colorScheme });
    await page.clock.install();
    let sent = 0, registered = 0;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (path.endsWith('/auth/registration-code')) {
        expect(route.request().postDataJSON()).toEqual({ email: 'register@example.test' });
        sent++;
        return reply({ verificationId: `proof-${sent}`, expiresAt: new Date(Date.now() + 600_000).toISOString(), resendAfterSeconds: 60 }, 202);
      }
      if (path.endsWith('/auth/register')) {
        registered++;
        expect(route.request().postDataJSON()).toEqual({ name: 'Condutor', email: 'register@example.test', password: 'FuelLog-test-2026!', verificationId: 'proof-1', code: '012345' });
        return reply({ status: 400, code: 'REGISTRATION_CODE_INVALID', detail: 'Código inválido ou expirado.' }, 400);
      }
      return reply({});
    });
    await page.goto('/register');
    await page.getByLabel('Nome', { exact: true }).fill('Condutor');
    await page.getByLabel('E-mail', { exact: true }).fill('register@example.test');
    await page.getByLabel('Senha', { exact: true }).fill('FuelLog-test-2026!');
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    const otp = page.getByLabel('Código de verificação do e-mail', { exact: true });
    await expect(otp).toBeAttached();
    await expect(page.getByText('Confirme seu e-mail', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar e criar conta', exact: true })).toBeDisabled();
    expect(registered).toBe(0);
    // Filling the shared native input exercises the same complete-code paste handler.
    await otp.fill('012345');
    for (const [i, char] of [...'012345'].entries()) await expect(page.getByRole('button', { name: `Dígito ${i + 1}: ${char}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar e criar conta', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Código inválido');
    await expect(otp).toHaveValue('012345');
    await expect(page.getByRole('button', { name: /^Reenviar em/ })).toBeDisabled();
    await page.clock.fastForward(61_000);
    await page.getByRole('button', { name: 'Reenviar código', exact: true }).click();
    await expect(otp).toHaveValue('');
    expect(sent).toBe(2); expect(registered).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/registration-${colorScheme}-320.png`, fullPage: true });
    await page.getByRole('button', { name: 'Alterar dados', exact: true }).click();
    await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('register@example.test');
    expect(errors).toEqual([]);
  });
}
