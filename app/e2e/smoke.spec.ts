import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('deep link protegido sem sessão mostra login sem erro de montagem', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  await page.goto('/history');
  try {
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await page.evaluate(async () => { await Promise.all(Array.from(document.images).map(img => img.decode())); });
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  } finally {
    await mkdir('test-results/qa', { recursive: true });
    await page.screenshot({ path: 'test-results/qa/auth-guard.png', fullPage: true });
    await testInfo.attach('runtime-errors', { body: JSON.stringify({ errors, failedRequests }, null, 2), contentType: 'application/json' });
  }
});
