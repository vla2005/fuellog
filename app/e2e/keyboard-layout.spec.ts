import { test, expect, type Locator, type Page } from '@playwright/test';
import { createAccount } from './api-fixtures';

// Viewport curto verifica layout web; não representa teclado nativo Android.
async function reachable(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  // Tolerância de 1 CSS px na borda inferior ao alinhar rolagem; clique, foco e digitação foram validados no diagnóstico.
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function fillVisible(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.scrollIntoViewIfNeeded();
  await expect(field).toBeVisible();
  await field.click();
  await expect(field).toBeFocused();
  await reachable(page, field);
  await field.fill(value);
  await expect(field).toHaveValue(value);
}

test('login e cadastro permitem foco, rolagem e ação em 320x480', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/login');
  await fillVisible(page, 'E-mail', 'layout@example.test');
  await fillVisible(page, 'Senha', 'abc123');
  await reachable(page, page.getByRole('button', { name: 'Entrar', exact: true }));
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('layout@example.test');
  await page.goto('/register');
  for (const [label, value] of [['Nome', 'Layout curto'], ['E-mail', 'layout@example.test'], ['Senha', 'abc123']]) {
    await fillVisible(page, label, value);
  }
  await reachable(page, page.getByRole('button', { name: 'Criar conta', exact: true }));
  await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Layout curto');
  await expect(page.getByLabel('Senha', { exact: true })).toHaveValue('abc123');
});

test('veículo, abastecimento e sheet de data preservam inputs em 390x480', async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 480 });
  const account = await createAccount(request);
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);
  await page.goto('/vehicles');
  await page.getByRole('button', { name: /^(Novo|Cadastrar) veículo$/ }).click();
  await fillVisible(page, 'Modelo', 'Layout veículo');
  await fillVisible(page, 'Quilometragem atual (opcional)', '1100');
  await fillVisible(page, 'Capacidade do tanque (opcional)', '50');
  const saveVehicle = page.getByRole('button', { name: 'Salvar veículo', exact: true });
  await reachable(page, saveVehicle);
  await saveVehicle.click();
  await expect(page.getByLabel('Trocar veículo ativo. Atual: Layout veículo', { exact: true })).toBeVisible();
  await page.goto('/fueling/new');
  await fillVisible(page, 'Valor pago', '54,84');
  await fillVisible(page, 'Preço por litro', '5,43');
  await page.getByRole('button', { name: /^Litros calculados:/ }).click();
  await fillVisible(page, 'Litros calculados', '10,100');
  await fillVisible(page, 'Hodômetro atual (km inteiro)', '1200');
  await expect(page.getByLabel('Nome do posto', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Observações', { exact: true })).toHaveCount(0);
  const dateRow = page.getByRole('button', { name: /^Data e hora do abastecimento:/ });
  await dateRow.scrollIntoViewIfNeeded();
  await dateRow.click();
  await fillVisible(page, 'Data do abastecimento', '2026-10-25');
  await fillVisible(page, 'Hora do abastecimento', '12:00');
  await fillVisible(page, 'Fuso horário IANA', 'America/Sao_Paulo');
  const confirmDate = page.getByRole('button', { name: 'Confirmar data e hora', exact: true });
  await reachable(page, confirmDate);
  await confirmDate.click();
  await expect(page.getByLabel('Hodômetro atual (km inteiro)', { exact: true })).toHaveValue('1200');
  await expect(page.getByRole('button', { name: /^Litros calculados:/ })).toContainText('10,100');
  await reachable(page, page.getByRole('button', { name: 'Salvar abastecimento', exact: true }));
});
