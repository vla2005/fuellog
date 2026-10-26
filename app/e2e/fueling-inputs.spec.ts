import { test, expect, Page, Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createAccount, createVehicle } from './api-fixtures';

// Proxy Playwright para API real localhost:8080 viabiliza testes sem alterar CORS nem interceptar produção
test.beforeEach(async ({ page }) => {
  await page.route('http://localhost:8080/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'Authorization, Content-Type',
          'access-control-expose-headers': 'ETag',
        },
      });
      return;
    }
    const response = await route.fetch({
      headers: {
        ...route.request().headers(),
        origin: 'http://localhost:8081',
      },
    });
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'access-control-allow-origin': '*',
      },
    });
  });
});

async function assertInputWithinSurfaceAndViewport(
  page: Page,
  input: Locator,
  container: Locator,
  viewportWidth: number,
  label: string,
) {
  const inputBox = await input.boundingBox();
  const containerBox = await container.boundingBox();
  expect(inputBox, `${label}: input deve ter boundingBox`).not.toBeNull();
  expect(containerBox, `${label}: container deve ter boundingBox`).not.toBeNull();

  // Input deve estar horizontalmente contido dentro da viewport (x >= 0 e right <= viewportWidth)
  expect(inputBox!.x, `${label}: x do input deve ser >= 0`).toBeGreaterThanOrEqual(0);
  expect(
    inputBox!.x + inputBox!.width,
    `${label}: borda direita do input deve ser <= viewport (${viewportWidth})`,
  ).toBeLessThanOrEqual(viewportWidth + 1);

  // Input deve estar dentro da sua caixa/superfície
  expect(
    inputBox!.x,
    `${label}: x do input deve iniciar dentro do container`,
  ).toBeGreaterThanOrEqual(containerBox!.x - 1);
  expect(
    inputBox!.x + inputBox!.width,
    `${label}: borda direita do input deve terminar dentro do container`,
  ).toBeLessThanOrEqual(containerBox!.x + containerBox!.width + 1);

  // Verifica ausência de deslocamento horizontal (scrollLeft)
  const scrollMetrics = await page.evaluate(() => ({
    scrollX: window.scrollX || document.documentElement.scrollLeft || 0,
    bodyScrollLeft: document.body.scrollLeft || 0,
  }));
  expect(scrollMetrics.scrollX, `${label}: scrollX deve ser 0`).toBe(0);
  expect(scrollMetrics.bodyScrollLeft, `${label}: bodyScrollLeft deve ser 0`).toBe(0);
}

test('formulário de abastecimento real: radios, máscaras, cálculo, desconto e POST', async ({
  page,
  request,
}) => {
  // 1. Cria conta e veículo com enums reais via API real 8080
  const account = await createAccount(request);
  await createVehicle(request, account.headers, 'Civic Flex E2E');

  // 2. Login na interface web real
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);

  // 3. Acessa o formulário de Novo Abastecimento
  await page.getByRole('button', { name: 'Novo abastecimento', exact: true }).click();
  await expect(page).toHaveURL(/\/fueling\/new$/);

  // 4. Validação dos Radios de Combustível no topo
  const gasRadio = page.getByRole('radio', { name: 'Gasolina comum', exact: true });
  const ethRadio = page.getByRole('radio', { name: 'Etanol', exact: true });
  const dieselRadio = page.getByRole('radio', { name: 'Diesel S-10', exact: true });

  await expect(gasRadio).toBeVisible();
  await expect(ethRadio).toBeVisible();
  await expect(dieselRadio).toHaveCount(0); // Não permitido para este veículo
  await expect(gasRadio).toBeChecked();

  // Alterna para Etanol e depois volta para Gasolina
  await ethRadio.click();
  await expect(ethRadio).toBeChecked();
  await expect(gasRadio).not.toBeChecked();

  await gasRadio.click();
  await expect(gasRadio).toBeChecked();

  // 5. Verificação visual de layout: Litros e Preço lado a lado e acima do valor pago
  const litrosInput = page.getByLabel('Litros abastecidos', { exact: true });
  const precoInput = page.getByLabel('Preço por litro', { exact: true });
  const litrosContainer = litrosInput.locator('xpath=..');
  const precoContainer = precoInput.locator('xpath=..');

  await expect(litrosInput).toBeVisible();
  await expect(precoInput).toBeVisible();

  const litrosBox = await litrosInput.boundingBox();
  const precoBox = await precoInput.boundingBox();
  expect(litrosBox).not.toBeNull();
  expect(precoBox).not.toBeNull();

  // Devem estar lado a lado (mesmo nível vertical aproximado)
  expect(Math.abs(litrosBox!.y - precoBox!.y)).toBeLessThan(15);
  // Litros à esquerda do preço
  expect(litrosBox!.x).toBeLessThan(precoBox!.x);

  await assertInputWithinSurfaceAndViewport(page, litrosInput, litrosContainer, 390, 'Litros inicial');
  await assertInputWithinSurfaceAndViewport(page, precoInput, precoContainer, 390, 'Preço inicial');

  // 6. Digitação sequencial em Litros (1 casa decimal): 351 deve exibir 35,1
  await litrosInput.click();
  await assertInputWithinSurfaceAndViewport(page, litrosInput, litrosContainer, 390, 'Litros focado');
  await litrosInput.pressSequentially('351', { delay: 30 });
  await expect(litrosInput).toHaveValue('35,1');
  await assertInputWithinSurfaceAndViewport(page, litrosInput, litrosContainer, 390, 'Litros após digitar 351');

  // Backspace apaga o último dígito
  await litrosInput.press('Backspace');
  await expect(litrosInput).toHaveValue('3,5');

  // Redigita 1 -> volta a 35,1
  await litrosInput.press('1');
  await expect(litrosInput).toHaveValue('35,1');
  await assertInputWithinSurfaceAndViewport(page, litrosInput, litrosContainer, 390, 'Litros restaurado 35,1');

  // 7. Digitação sequencial no Preço por litro (2 casas decimais): 543 deve exibir 5,43
  await precoInput.click();
  await assertInputWithinSurfaceAndViewport(page, precoInput, precoContainer, 390, 'Preço focado');
  await precoInput.pressSequentially('543', { delay: 30 });
  await expect(precoInput).toHaveValue('5,43');
  await assertInputWithinSurfaceAndViewport(page, precoInput, precoContainer, 390, 'Preço após digitar 543');

  // 8. Valor pago calculado automaticamente: 35.1 * 5.43 = 190.59 (HALF_UP)
  await expect(
    page.getByLabel(/^Valor total pago calculado: R\$ 190,59/),
  ).toBeVisible();

  // 9. Edição do valor pago para aplicar desconto de R$ 180,00
  const editPaidBtn = page.getByRole('button', {
    name: 'Editar valor total pago manualmente',
    exact: true,
  });
  await editPaidBtn.click();

  const paidManualInput = page.getByLabel('Valor total pago', { exact: true });
  const paidManualContainer = paidManualInput.locator('xpath=..');
  await expect(paidManualInput).toBeVisible();

  await paidManualInput.click();
  await assertInputWithinSurfaceAndViewport(page, paidManualInput, paidManualContainer, 390, 'Valor manual focado');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await paidManualInput.pressSequentially('18000', { delay: 30 });
  await expect(paidManualInput).toHaveValue('180,00');
  await assertInputWithinSurfaceAndViewport(page, paidManualInput, paidManualContainer, 390, 'Valor manual após digitar 18000');

  // Diferença de R$ 10,59 > R$ 0,05 exige justificativa
  const reasonInput = page.getByLabel('Justificativa do ajuste', { exact: true });
  await expect(reasonInput).toBeVisible();
  await reasonInput.fill('Desconto concedido na bomba');

  // 10. Hodômetro inteiro km escala 0: digitar 120542
  const odoInput = page.getByLabel('Hodômetro atual (km inteiro)', { exact: true });
  const odoContainer = odoInput.locator('xpath=..');
  await odoInput.click();
  await assertInputWithinSurfaceAndViewport(page, odoInput, odoContainer, 390, 'Hodômetro focado');
  await odoInput.pressSequentially('120542', { delay: 30 });
  await expect(odoInput).toHaveValue('120542');
  await assertInputWithinSurfaceAndViewport(page, odoInput, odoContainer, 390, 'Hodômetro preenchido');

  // 11. Captura screenshots para revisão do root sem toast cobrindo e sem scroll lateral
  const toast = page.getByRole('alert');
  if (await toast.isVisible()) {
    await toast.click();
    await expect(toast).toBeHidden({ timeout: 5000 });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => window.scrollX)).toBe(0);

  await mkdir('test-results/qa', { recursive: true });
  await page.screenshot({
    path: 'test-results/qa/fueling-form-390px-light.png',
    fullPage: true,
  });

  // 12. Aguarda localização GPS e salva abastecimento via API real
  await expect(
    page.getByRole('button', { name: 'Recapturar localização atual', exact: true }),
  ).toBeVisible();

  const savePromise = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      /\/vehicles\/.*\/fuel-entries$/.test(res.url()),
  );

  await page.getByRole('button', { name: 'Salvar abastecimento', exact: true }).click();
  const savedResponse = await savePromise;
  expect(savedResponse.status()).toBe(201);

  const payload = savedResponse.request().postDataJSON();
  expect(payload).toMatchObject({
    fuelType: 'GASOLINE_REGULAR',
    liters: '35.1',
    unitPrice: '5.43',
    paidTotal: '180.00',
    odometerKm: 120542,
    adjustmentReason: 'Desconto concedido na bomba',
  });

  await expect(page).toHaveURL(/\/\/?$/);

  // 13. Verifica que o formulário foi resetado após o envio
  await page.getByRole('button', { name: 'Novo abastecimento', exact: true }).click();
  await expect(page).toHaveURL(/\/fueling\/new$/);
  await expect(page.getByLabel('Litros abastecidos', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Preço por litro', { exact: true })).toHaveValue('');

  // 14. Digita valor e clica no X do topo (Fechar) -> deve resetar o estado e limpar rascunho
  const litrosField = page.getByLabel('Litros abastecidos', { exact: true });
  await litrosField.click();
  await litrosField.pressSequentially('200', { delay: 20 });
  await expect(litrosField).toHaveValue('20,0');

  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);

  // Reabre e confirma que voltou limpo sem resquício
  await page.getByRole('button', { name: 'Novo abastecimento', exact: true }).click();
  await expect(page).toHaveURL(/\/fueling\/new$/);
  await expect(page.getByLabel('Litros abastecidos', { exact: true })).toHaveValue('');
});

test('responsividade do formulário a 320px no modo escuro sem overflow', async ({
  page,
  request,
}) => {
  const account = await createAccount(request);
  await createVehicle(request, account.headers, 'Compact Dark');

  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: 'dark' });

  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);

  await page.getByRole('button', { name: 'Novo abastecimento', exact: true }).click();
  await expect(page).toHaveURL(/\/fueling\/new$/);

  const litrosInput = page.getByLabel('Litros abastecidos', { exact: true });
  const precoInput = page.getByLabel('Preço por litro', { exact: true });
  const odoInput = page.getByLabel('Hodômetro atual (km inteiro)', { exact: true });
  const litrosContainer = litrosInput.locator('xpath=..');
  const precoContainer = precoInput.locator('xpath=..');
  const odoContainer = odoInput.locator('xpath=..');

  await assertInputWithinSurfaceAndViewport(page, litrosInput, litrosContainer, 320, '320px Litros inicial');
  await assertInputWithinSurfaceAndViewport(page, precoInput, precoContainer, 320, '320px Preço inicial');

  // Digita dados para verificar legibilidade e dimensões
  await litrosInput.click();
  await assertInputWithinSurfaceAndViewport(page, litrosInput, litrosContainer, 320, '320px Litros focado');
  await litrosInput.pressSequentially('351', { delay: 20 });
  await expect(litrosInput).toHaveValue('35,1');
  await assertInputWithinSurfaceAndViewport(page, litrosInput, litrosContainer, 320, '320px Litros digitado');

  await precoInput.click();
  await assertInputWithinSurfaceAndViewport(page, precoInput, precoContainer, 320, '320px Preço focado');
  await precoInput.pressSequentially('543', { delay: 20 });
  await expect(precoInput).toHaveValue('5,43');
  await assertInputWithinSurfaceAndViewport(page, precoInput, precoContainer, 320, '320px Preço digitado');

  await odoInput.click();
  await assertInputWithinSurfaceAndViewport(page, odoInput, odoContainer, 320, '320px Hodômetro focado');
  await odoInput.pressSequentially('120542', { delay: 20 });
  await expect(odoInput).toHaveValue('120542');
  await assertInputWithinSurfaceAndViewport(page, odoInput, odoContainer, 320, '320px Hodômetro digitado');

  // Verifica ausência de scroll horizontal (overflow)
  const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(docWidth).toBeLessThanOrEqual(320);

  const scrollX = await page.evaluate(() => window.scrollX || document.documentElement.scrollLeft || 0);
  expect(scrollX).toBe(0);

  // Aguarda toast sumir e garante formulário posicionado no topo
  const toast = page.getByRole('alert');
  if (await toast.isVisible()) {
    await toast.click();
    await expect(toast).toBeHidden({ timeout: 5000 });
  }
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.screenshot({
    path: 'test-results/qa/fueling-form-320px-dark.png',
    fullPage: true,
  });
});
