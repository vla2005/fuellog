import { test, expect, Page, Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { apiURL, createAccount, createVehicle } from './api-fixtures';

// Proxy Playwright para a API configurada viabiliza testes sem alterar CORS.
test.beforeEach(async ({ page, baseURL }) => {
  await page.route(`${new URL(apiURL).origin}/**`, async (route) => {
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
        origin: new URL(baseURL ?? 'http://localhost:8081').origin,
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
  // 1. Cria conta e veículo com enums reais na API configurada.
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

  // 5. Valor efetivamente pago e preço compartilham a linha acima do volume.
  const paidManualInput = page.getByLabel('Valor pago', { exact: true });
  const precoInput = page.getByLabel('Preço por litro', { exact: true });
  const paidManualContainer = paidManualInput.locator('xpath=..');
  const precoContainer = precoInput.locator('xpath=..');

  await expect(paidManualInput).toBeVisible();
  await expect(precoInput).toBeVisible();

  const paidBox = await paidManualInput.boundingBox();
  const precoBox = await precoInput.boundingBox();
  expect(paidBox).not.toBeNull();
  expect(precoBox).not.toBeNull();

  // Devem estar lado a lado (mesmo nível vertical aproximado)
  expect(Math.abs(paidBox!.y - precoBox!.y)).toBeLessThan(15);
  // Pagamento à esquerda do preço
  expect(paidBox!.x).toBeLessThan(precoBox!.x);

  await assertInputWithinSurfaceAndViewport(page, paidManualInput, paidManualContainer, 390, 'Pagamento inicial');
  await assertInputWithinSurfaceAndViewport(page, precoInput, precoContainer, 390, 'Preço inicial');

  // 6. Pagamento usa máscara reversa de centavos; o preço aceita a tarifa decimal.
  await paidManualInput.pressSequentially('15343', { delay: 20 });
  await expect(paidManualInput).toHaveValue('153,43');
  await precoInput.fill('4,58');
  const litersDisplay = page.getByRole('button', { name: /^Litros calculados:/ });
  await expect(litersDisplay).toContainText('33,500');
  const litersCard = page.getByText('Litros calculados', { exact: true }).locator('xpath=..');
  const cardBeforeFocus = await litersCard.boundingBox();
  await litersDisplay.click();
  const litrosInput = page.getByLabel('Litros calculados', { exact: true });
  const litrosContainer = litrosInput.locator('xpath=..');
  await expect(litrosInput).toHaveValue('33,500');
  await expect(litrosInput).toBeEnabled();
  expect(await litersCard.boundingBox()).toEqual(cardBeforeFocus);
  await assertInputWithinSurfaceAndViewport(page, litrosInput, litrosContainer, 390, 'Litros focado');
  await litrosInput.fill('');
  await litrosInput.pressSequentially('35000', { delay: 20 });
  await expect(litrosInput).toHaveValue('35,000');
  await assertInputWithinSurfaceAndViewport(page, litrosInput, litrosContainer, 390, 'Litros após digitar 35000');

  // Backspace apaga o último dígito
  await litrosInput.press('Backspace');
  await expect(litrosInput).toHaveValue('3,500');

  // Redigita 0 e restaura o volume manual, sem recalcular o pagamento.
  await litrosInput.press('0');
  await expect(litrosInput).toHaveValue('35,000');
  await expect(paidManualInput).toHaveValue('153,43');
  await assertInputWithinSurfaceAndViewport(page, litrosInput, litrosContainer, 390, 'Litros restaurado 35,000');

  // 7. A tarifa preserva quatro casas, inclusive após o override do volume.
  await precoInput.click();
  await assertInputWithinSurfaceAndViewport(page, precoInput, precoContainer, 390, 'Preço focado');
  await precoInput.fill('6,1234');
  await expect(precoInput).toHaveValue('6,1234');
  await expect(litersDisplay).toContainText('35,000');
  await expect(paidManualInput).toHaveValue('153,43');
  await assertInputWithinSurfaceAndViewport(page, precoInput, precoContainer, 390, 'Preço com quatro casas');

  // 8. Checkbox declara desconto; pago e volume continuam independentes.
  const discount = page.getByRole('checkbox', { name: 'Houve desconto no abastecimento' });
  await discount.click();
  await expect(discount).toBeChecked();

  await paidManualInput.click();
  await assertInputWithinSurfaceAndViewport(page, paidManualInput, paidManualContainer, 390, 'Valor manual focado');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await paidManualInput.pressSequentially('18000', { delay: 30 });
  await expect(paidManualInput).toHaveValue('180,00');
  await expect(litersDisplay).toContainText('35,000');
  await assertInputWithinSurfaceAndViewport(page, paidManualInput, paidManualContainer, 390, 'Valor manual após digitar 18000');

  // A checkbox fornece motivo padrão; um motivo personalizado continua preservado.
  const reasonInput = page.getByLabel('Motivo do desconto', { exact: true });
  await expect(reasonInput).toBeVisible();
  await expect(reasonInput).toHaveValue('Desconto');
  await reasonInput.fill('Desconto concedido na bomba');
  await discount.click();
  await expect(discount).not.toBeChecked();
  await expect(reasonInput).toBeHidden();
  await expect(paidManualInput).toHaveValue('180,00');
  await expect(litersDisplay).toContainText('35,000');
  await discount.click();
  await expect(discount).toBeChecked();
  await expect(reasonInput).toHaveValue('Desconto concedido na bomba');

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
    liters: '35.000',
    unitPrice: '6.1234',
    paidTotal: '180.00',
    odometerKm: 120542,
    adjustmentReason: 'Desconto concedido na bomba',
  });

  await expect(page).toHaveURL(/\/\/?$/);

  // 13. Verifica que o formulário foi resetado após o envio
  await page.getByRole('button', { name: 'Novo abastecimento', exact: true }).click();
  await expect(page).toHaveURL(/\/fueling\/new$/);
  await expect(page.getByRole('button', { name: /^Litros calculados:/ })).toContainText('0,000');
  await expect(page.getByLabel('Valor pago', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Preço por litro', { exact: true })).toHaveValue('');

  // 14. Digita valor e clica no X do topo (Fechar) -> deve resetar o estado e limpar rascunho
  await page.getByRole('button', { name: /^Litros calculados:/ }).click();
  const litrosField = page.getByLabel('Litros calculados', { exact: true });
  await litrosField.click();
  await litrosField.pressSequentially('20000', { delay: 20 });
  await expect(litrosField).toHaveValue('20,000');

  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page).toHaveURL(/\/\/?$/);

  // Reabre e confirma que voltou limpo sem resquício
  await page.getByRole('button', { name: 'Novo abastecimento', exact: true }).click();
  await expect(page).toHaveURL(/\/fueling\/new$/);
  await expect(page.getByRole('button', { name: /^Litros calculados:/ })).toContainText('0,000');
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

  const paidInput = page.getByLabel('Valor pago', { exact: true });
  const precoInput = page.getByLabel('Preço por litro', { exact: true });
  const odoInput = page.getByLabel('Hodômetro atual (km inteiro)', { exact: true });
  const paidContainer = paidInput.locator('xpath=..');
  const precoContainer = precoInput.locator('xpath=..');
  const odoContainer = odoInput.locator('xpath=..');

  await assertInputWithinSurfaceAndViewport(page, paidInput, paidContainer, 320, '320px Pagamento inicial');
  await assertInputWithinSurfaceAndViewport(page, precoInput, precoContainer, 320, '320px Preço inicial');

  // Digita dados para verificar legibilidade e dimensões
  await paidInput.pressSequentially('15343', { delay: 20 });
  await expect(paidInput).toHaveValue('153,43');
  await precoInput.fill('4,58');
  await page.getByRole('button', { name: /^Litros calculados:/ }).click();
  const litrosInput = page.getByLabel('Litros calculados', { exact: true });
  const litrosContainer = litrosInput.locator('xpath=..');
  await expect(litrosInput).toBeEnabled();
  await assertInputWithinSurfaceAndViewport(page, litrosInput, litrosContainer, 320, '320px Litros focado');
  await litrosInput.fill('');
  await litrosInput.pressSequentially('35000', { delay: 20 });
  await expect(litrosInput).toHaveValue('35,000');
  await assertInputWithinSurfaceAndViewport(page, litrosInput, litrosContainer, 320, '320px Litros digitado');

  await precoInput.click();
  await assertInputWithinSurfaceAndViewport(page, precoInput, precoContainer, 320, '320px Preço focado');
  await precoInput.fill('6,1234');
  await expect(precoInput).toHaveValue('6,1234');
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

  await mkdir('test-results/qa', { recursive: true });
  await page.screenshot({
    path: 'test-results/qa/fueling-form-320px-dark.png',
    fullPage: true,
  });
});
