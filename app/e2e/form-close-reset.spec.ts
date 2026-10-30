import { test, expect } from '@playwright/test';

// Mocks identificados para frontend
const INITIAL_USER = {
  id: 'usr-reset-test-123',
  name: 'Motorista FuelLog',
  email: 'motorista@fuellog.test',
  preferredTimezone: 'America/Sao_Paulo',
};

const MOCK_TOKENS = {
  access_token: 'mock-access-token-jwt-style-reset-123',
  refresh_token: 'mock-refresh-token-uuid-reset-456',
  token_type: 'Bearer',
  expires_in: 900,
  access_expires_at: new Date(Date.now() + 900000).toISOString(),
  refresh_expires_at: new Date(Date.now() + 86400000).toISOString(),
  session_id: 'sess-reset-test',
};

const mockVehicle = {
  id: 'veh-reset-1',
  userId: INITIAL_USER.id,
  nickname: 'Gol 1.0',
  brand: 'Volkswagen',
  model: 'Gol',
  modelYear: 2022,
  plate: 'ABC1D23',
  tankCapacityLiters: '55.0',
  allowedFuels: ['GASOLINE_REGULAR', 'ETHANOL'],
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface MockApiOptions {
  delayPatchMeMs?: number;
  patchDeferred?: { promise: Promise<void>; onRequested?: () => void };
  second2FaDeferred?: { promise: Promise<void>; onRequested?: () => void };
  initial2FaStatus?: number;
}

function setupMockApi(page: any, options: MockApiOptions = {}) {
  let currentUser = { ...INITIAL_USER };
  const { delayPatchMeMs = 0, patchDeferred, second2FaDeferred, initial2FaStatus = 200 } = options;
  const patchRequests: any[] = [];
  let twoFaCallCount = 0;

  return {
    getCurrentUser: () => currentUser,
    getPatchRequests: () => patchRequests,
    init: async () => {
      await page.addInitScript(
        ({ refresh }) => {
          sessionStorage.setItem('fuellog.auth.refresh_token.v1', refresh);
        },
        { refresh: MOCK_TOKENS.refresh_token },
      );

      await page.route('**/api/v1/**', async (route: any) => {
        const url = route.request().url();
        const method = route.request().method();

        if (url.includes('/auth/refresh')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_TOKENS),
          });
        }

        if (url.includes('/me/2fa') && method === 'GET') {
          twoFaCallCount++;
          if (initial2FaStatus === 500 && twoFaCallCount === 1) {
            return route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'Erro ao verificar status de segurança.' }),
            });
          }

          if (second2FaDeferred && twoFaCallCount === 2) {
            second2FaDeferred.onRequested?.();
            await second2FaDeferred.promise;
          }

          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              enabled: false,
              recoveryCodesRemaining: 0,
            }),
          });
        }

        if (url.endsWith('/me') && method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(currentUser),
          });
        }

        if (url.endsWith('/me') && method === 'PATCH') {
          if (patchDeferred) {
            patchDeferred.onRequested?.();
            await patchDeferred.promise;
          } else if (delayPatchMeMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayPatchMeMs));
          }

          const body = JSON.parse(route.request().postData() || '{}');
          patchRequests.push(body);

          if (body.email === 'conflito@fuellog.test') {
            return route.fulfill({
              status: 409,
              contentType: 'application/problem+json',
              body: JSON.stringify({
                title: 'Conflito de conta',
                code: 'ACCOUNT_CONFLICT',
                detail: 'O e-mail informado já está em uso.',
                fieldErrors: {
                  email: 'Este e-mail já está em uso por outra conta.',
                },
              }),
            });
          }

          currentUser = {
            ...currentUser,
            name: body.name?.trim() || currentUser.name,
            email: body.email?.trim()?.toLowerCase() || currentUser.email,
          };

          return route.fulfill({
            status: 200,
            headers: { 'Cache-Control': 'no-store' },
            contentType: 'application/json',
            body: JSON.stringify(currentUser),
          });
        }

        if (url.includes('/fuel-types')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(['GASOLINE_REGULAR', 'ETHANOL']),
          });
        }

        if (url.includes('/fuel-entries')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [], page: 0, size: 20, total: 0 }),
          });
        }

        if (url.includes('/cycles')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [] }),
          });
        }

        if (url.includes('/summary')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              vehicleId: mockVehicle.id,
              purchaseCount: 0,
              paidTotal: '0.00',
              purchasedLiters: '0.000',
              periodConsumptionKmPerLiter: null,
              lastValidCycle: null,
            }),
          });
        }

        if (/\/vehicles(\/active)?(\?.*)?$/.test(url) || url.endsWith('/vehicles')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([mockVehicle]),
          });
        }

        if (url.includes('/vehicles/')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockVehicle),
          });
        }

        return route.fulfill({ status: 200, body: '{}' });
      });
    },
  };
}

test.describe('Ciclo de vida e descarte de formulários ao fechar/voltar', () => {
  test('Conta: editar sem salvar -> Voltar -> reabrir descarta rascunho e restaura perfil salvo', async ({
    page,
  }) => {
    const mock = setupMockApi(page);
    await mock.init();

    await page.goto('/account');
    const nameInput = page.getByTestId('account-name-input');
    const emailInput = page.getByTestId('account-email-input');

    await expect(nameInput).toHaveValue('Motorista FuelLog');
    await expect(emailInput).toHaveValue('motorista@fuellog.test');

    // 1. Edita nome e email para conflito e tenta salvar
    await nameInput.fill('Motorista Nao Salvo');
    await emailInput.fill('conflito@fuellog.test');

    const passwordInput = page.getByTestId('account-current-password-input');
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill('senha-temporaria');

    // Tenta salvar e gera erro 409
    await page.getByTestId('account-save-button').click();
    await expect(page.getByText('Este e-mail já está em uso por outra conta.')).toBeVisible();

    // 2. Erro de salvar mantém o texto enquanto a tela estiver aberta
    await expect(nameInput).toHaveValue('Motorista Nao Salvo');
    await expect(emailInput).toHaveValue('conflito@fuellog.test');
    await expect(passwordInput).toHaveValue('senha-temporaria');

    // 3. Usuário clica Voltar
    await page.getByTestId('account-back-button').click();
    await expect(page).toHaveURL(/\/settings$/);

    // 4. Reabre Conta
    await page.getByTestId('settings-minha-conta-button').click();
    await expect(page).toHaveURL(/\/account$/);

    // 5. Verifica que retornou exatamente os valores salvos e senha/erros limpos
    await expect(page.getByTestId('account-name-input')).toHaveValue('Motorista FuelLog');
    await expect(page.getByTestId('account-email-input')).toHaveValue('motorista@fuellog.test');
    await expect(page.getByTestId('account-current-password-input')).toHaveCount(0);
    await expect(page.getByText('Este e-mail já está em uso por outra conta.')).toHaveCount(0);
  });

  test('Conta: salvar com sucesso (200) -> fechar -> reabrir reflete o último salvo', async ({
    page,
  }) => {
    const mock = setupMockApi(page);
    await mock.init();

    await page.goto('/account');
    const nameInput = page.getByTestId('account-name-input');
    await expect(nameInput).toHaveValue('Motorista FuelLog');

    // Altera nome e salva
    await nameInput.fill('Motorista Confirmado');
    await page.getByTestId('account-save-button').click();

    await expect(page.getByText('Alterações salvas')).toBeVisible();

    // Fecha a tela voltando para Ajustes
    await page.getByTestId('account-back-button').click();
    await expect(page).toHaveURL(/\/settings$/);

    // Reabre Conta
    await page.getByTestId('settings-minha-conta-button').click();
    await expect(page).toHaveURL(/\/account$/);

    // Mostra o último 200 salvo
    await expect(page.getByTestId('account-name-input')).toHaveValue('Motorista Confirmado');
  });

  test('Conta: resposta atrasada com tela fechada não trava botão de salvar nem sobrescreve nova abertura', async ({
    page,
  }) => {
    const patchDeferred = createDeferred();
    const patchRequested = createDeferred();

    const mock = setupMockApi(page, {
      patchDeferred: {
        promise: patchDeferred.promise,
        onRequested: () => patchRequested.resolve(),
      },
    });
    await mock.init();

    await page.goto('/account');
    const nameInput = page.getByTestId('account-name-input');

    // 1. Digita primeiro nome e clica salvar
    await nameInput.fill('Primeiro Nome');
    await page.getByTestId('account-save-button').click();

    // 2. Aguarda a requisição PATCH começar no servidor
    await patchRequested.promise;

    // 3. Enquanto a requisição está retida em voo, clica Voltar
    await page.getByTestId('account-back-button').click();
    await expect(page).toHaveURL(/\/settings$/);

    // 4. Reabre Conta
    await page.getByTestId('settings-minha-conta-button').click();
    await expect(page).toHaveURL(/\/account$/);

    // 5. Botão de salvar NÃO fica travado em submitting (aria-disabled=true)
    const saveButton = page.getByTestId('account-save-button');
    await expect(saveButton).not.toHaveAttribute('aria-disabled', 'true');

    // 6. Digita o segundo nome enquanto a resposta antiga ainda não foi liberada
    const newNameInput = page.getByTestId('account-name-input');
    await newNameInput.fill('Segundo Nome');

    // 7. Só então libera a resposta atrasada do primeiro PATCH
    patchDeferred.resolve();

    await page.waitForTimeout(300);

    // 8. O input novo permanece 'Segundo Nome' (não é sobrescrito pela resposta 200 antiga)
    await expect(newNameInput).toHaveValue('Segundo Nome');
    await expect(saveButton).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('Conta: consulta de segurança atrasada não envia PATCH antigo nem sobrescreve nova abertura', async ({
    page,
  }) => {
    const second2FaDeferred = createDeferred();
    const second2FaRequested = createDeferred();

    const mock = setupMockApi(page, {
      initial2FaStatus: 500,
      second2FaDeferred: {
        promise: second2FaDeferred.promise,
        onRequested: () => second2FaRequested.resolve(),
      },
    });
    await mock.init();

    await page.goto('/account');

    // 1. Edita nome e e-mail e preenche senha
    await page.getByTestId('account-name-input').fill('Nome Antigo');
    await page.getByTestId('account-email-input').fill('novo@fuellog.test');

    const passwordInput = page.getByTestId('account-current-password-input');
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill('senha123');

    // 2. Clica Salvar: activeTwoFactor é null (500 inicial), dispara o segundo GET /me/2fa
    await page.getByTestId('account-save-button').click();

    // 3. Aguarda o segundo GET começar e ser retido
    await second2FaRequested.promise;

    // 4. Enquanto o GET está retido, sai da tela
    await page.getByTestId('account-back-button').click();
    await expect(page).toHaveURL(/\/settings$/);

    // 5. Reabre Conta e digita outro nome
    await page.getByTestId('settings-minha-conta-button').click();
    await expect(page).toHaveURL(/\/account$/);

    const nameInput = page.getByTestId('account-name-input');
    await nameInput.fill('Outro Nome');

    // 6. Só então libera o segundo GET /me/2fa
    second2FaDeferred.resolve();

    await page.waitForTimeout(300);

    // 7. Confere que zero PATCH antigo foi enviado e a nova digitação foi preservada
    expect(mock.getPatchRequests()).toHaveLength(0);
    await expect(nameInput).toHaveValue('Outro Nome');
  });

  test('Novo abastecimento: sair por navegação (page.goBack) descarta rascunho e reabre limpo', async ({
    page,
  }) => {
    const mock = setupMockApi(page);
    await mock.init();

    await page.goto('/');

    // Abre Novo abastecimento pelo botão '+'
    const newFuelBtn = page.getByLabel('Novo abastecimento');
    await expect(newFuelBtn).toBeVisible();
    await newFuelBtn.click();
    await expect(page).toHaveURL(/\/fueling\/new$/);

    // Preenche Litros
    const litersInput = page.getByLabel('Litros abastecidos');
    await expect(litersInput).toBeVisible();
    await litersInput.fill('45,5');

    // Sai da tela via navegação de voltar (goBack)
    await page.goBack();
    await expect(page).toHaveURL(/\/\/?$/);

    // Reabre pelo botão '+'
    await newFuelBtn.click();
    await expect(page).toHaveURL(/\/fueling\/new$/);

    // O campo de litros foi descartado e inicia vazio
    await expect(page.getByLabel('Litros abastecidos')).toHaveValue('');
  });
});
