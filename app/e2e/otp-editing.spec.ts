import { expect, test } from '@playwright/test';

for (const flow of ['registration', '2fa'] as const) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`editar e apagar código no ${flow}, tema ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      let confirmations = 0;
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (path.endsWith('/auth/registration-code')) return reply({ verificationId: 'otp-proof', expiresAt: new Date(Date.now() + 600_000).toISOString(), resendAfterSeconds: 60 }, 202);
        if (path.endsWith('/auth/login')) return reply({ mfaRequired: true, challengeToken: 'otp-test-challenge', expiresAt: new Date(Date.now() + 600_000).toISOString() });
        if (/\/auth\/(register|2fa\/verify)$/.test(path)) confirmations++;
        return reply({});
      });
      await page.goto(flow === 'registration' ? '/register' : '/login');
      if (flow === 'registration') await page.getByLabel('Nome', { exact: true }).fill('Condutor');
      await page.getByLabel('E-mail', { exact: true }).fill('otp@example.test');
      await page.getByLabel('Senha', { exact: true }).fill('FuelLog-test-2026!');
      await page.getByRole('button', { name: flow === 'registration' ? 'Criar conta' : 'Entrar', exact: true }).click();
      const input = page.getByLabel(flow === 'registration' ? 'Código de verificação do e-mail' : 'Código de 6 dígitos', { exact: true });
      await input.fill('012345');
      await expect(input).toHaveValue('012345');
      await input.press('Backspace');
      await expect(input).toHaveValue('01234');
      await input.press('Backspace');
      await expect(input).toHaveValue('0123');
      await page.getByRole('button', { name: 'Dígito 2: 1', exact: true }).click();
      await input.press('Backspace');
      await expect(input).toHaveValue('023');
      await input.fill('012345');
      await page.getByRole('button', { name: 'Dígito 3: 2', exact: true }).click();
      await input.press('9');
      await expect(input).toHaveValue('019345');
      await input.press('Backspace');
      await expect(input).toHaveValue('01345');
      await input.press('ControlOrMeta+a');
      await input.press('Backspace');
      await expect(input).toHaveValue('');
      await input.pressSequentially('000123');
      await expect(input).toHaveValue('000123');
      expect(confirmations).toBe(0);
      expect(errors).toEqual([]);
    });
  }
}
