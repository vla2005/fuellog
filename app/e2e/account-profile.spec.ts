import { test, expect } from '@playwright/test';

// Mocks identificados para frontend
const INITIAL_USER = {
  id: 'usr-profile-test-123',
  name: 'Motorista FuelLog',
  email: 'motorista@fuellog.test',
  preferredTimezone: 'America/Sao_Paulo',
};

const MOCK_TOKENS = {
  access_token: 'mock-access-token-jwt-style-account-123',
  refresh_token: 'mock-refresh-token-uuid-account-456',
  token_type: 'Bearer',
  expires_in: 900,
  access_expires_at: new Date(Date.now() + 900000).toISOString(),
  refresh_expires_at: new Date(Date.now() + 86400000).toISOString(),
  session_id: 'sess-account-test',
};

function setupMockApi(page: any, options: { is2FaEnabled?: boolean } = {}) {
  let currentUser = { ...INITIAL_USER };
  const { is2FaEnabled = false } = options;

  return {
    getCurrentUser: () => currentUser,
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
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              enabled: is2FaEnabled,
              recoveryCodesRemaining: is2FaEnabled ? 10 : 0,
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
          const body = JSON.parse(route.request().postData() || '{}');

          // Valida conflito de e-mail mockado
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

          // Valida senha incorreta se e-mail alterado
          if (
            body.email &&
            body.email.toLowerCase() !== currentUser.email.toLowerCase() &&
            body.currentPassword === 'senha-errada'
          ) {
            return route.fulfill({
              status: 422,
              contentType: 'application/problem+json',
              body: JSON.stringify({
                title: 'Erro de validação',
                code: 'VALIDATION_ERROR',
                detail: 'Senha atual incorreta.',
                fieldErrors: {
                  currentPassword: 'A senha atual informada está incorreta.',
                },
              }),
            });
          }

          // Sucesso 200: atualiza estado e retorna MeResponse
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

        if (url.includes('/vehicles')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
          });
        }

        if (url.includes('/fuel-types')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(['GASOLINE_REGULAR', 'ETHANOL']),
          });
        }

        return route.fulfill({ status: 200, body: '{}' });
      });
    },
  };
}

test.describe('Conta / Perfil do Usuário (E2E Frontend)', () => {
  test('navegação: avatar do header e Minha conta abrem a mesma tela; itens mortos removidos de Ajustes', async ({
    page,
  }) => {
    const mock = setupMockApi(page);
    await mock.init();

    await page.goto('/');

    // 1. Header persistente possui o avatar e não mais a engrenagem
    const headerAvatar = page.getByTestId('header-avatar-button');
    await expect(headerAvatar).toBeVisible();

    // 2. Clicar no avatar do header abre Conta direto
    await headerAvatar.click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('heading', { name: 'Conta', level: 1 }).or(page.getByText('Conta', { exact: true }))).toBeVisible();

    // 3. Voltar retorna para Início
    const backBtn = page.getByTestId('account-back-button');
    await backBtn.click();
    await expect(page).toHaveURL(/\/\/?$/);

    // 4. Ir para Ajustes via bottom dock
    await page.getByLabel('Ajustes').click();
    await expect(page).toHaveURL(/\/settings$/);

    // 5. Itens mortos "Privacidade e termos" e "Sobre o FuelLog" não existem em Ajustes
    await expect(page.getByText('Privacidade e termos')).toHaveCount(0);
    await expect(page.getByText('Sobre o FuelLog')).toHaveCount(0);

    // 6. Botão "Minha conta >" em Ajustes abre a mesma tela Conta
    const minhaContaBtn = page.getByTestId('settings-minha-conta-button');
    await expect(minhaContaBtn).toBeVisible();
    await minhaContaBtn.click();
    await expect(page).toHaveURL(/\/account$/);
  });

  test('edição name-only: não exige senha nem fator, feedback 200 e atualização global sem relogin', async ({
    page,
  }) => {
    const mock = setupMockApi(page);
    await mock.init();

    await page.goto('/account');

    // Valida valores iniciais
    const nameInput = page.getByTestId('account-name-input');
    await expect(nameInput).toHaveValue('Motorista FuelLog');

    // Altera apenas o nome
    await nameInput.fill('Alexandre Motorista');

    // Campo de senha não deve existir
    await expect(page.getByTestId('account-current-password-input')).toHaveCount(0);

    // Salvar alterações
    await page.getByTestId('account-save-button').click();

    // Feedback de sucesso
    await expect(page.getByText('Alterações salvas')).toBeVisible();
    await expect(page.getByText('Seus dados foram atualizados com sucesso.')).toBeVisible();

    // Volta para Ajustes e verifica que o nome atualizou sem relogin
    await page.getByTestId('account-back-button').click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByText('Alexandre Motorista').first()).toBeVisible();
  });

  test('troca de e-mail: exige confirmação de senha, retém digitado em 422 e 409', async ({
    page,
  }) => {
    const mock = setupMockApi(page);
    await mock.init();

    await page.goto('/account');

    const emailInput = page.getByTestId('account-email-input');
    await expect(emailInput).toHaveValue('motorista@fuellog.test');

    // Altera e-mail para um novo endereço
    await emailInput.fill('novo-email@fuellog.test');

    // Campo de senha atual aparece dinamicamente
    const currentPasswordInput = page.getByTestId('account-current-password-input');
    await expect(currentPasswordInput).toBeVisible();

    // Tentar salvar sem senha: erro local
    await page.getByTestId('account-save-button').click();
    await expect(
      page.getByText('Informe sua senha atual para alterar o e-mail.'),
    ).toBeVisible();

    // Preenche senha errada: simula 422 do servidor
    await currentPasswordInput.fill('senha-errada');
    await page.getByTestId('account-save-button').click();
    await expect(page.getByText('A senha atual informada está incorreta.')).toBeVisible();

    // Valida que os valores digitados foram preservados
    await expect(emailInput).toHaveValue('novo-email@fuellog.test');
    await expect(currentPasswordInput).toHaveValue('senha-errada');

    // Tenta e-mail em conflito (409):
    await emailInput.fill('conflito@fuellog.test');
    await currentPasswordInput.fill('senha-correta');
    await page.getByTestId('account-save-button').click();
    await expect(
      page.getByText('Este e-mail já está em uso por outra conta.'),
    ).toBeVisible();

    // Valores ainda preservados
    await expect(emailInput).toHaveValue('conflito@fuellog.test');
    await expect(currentPasswordInput).toHaveValue('senha-correta');
  });

  test('captura de screenshots de revisão: 320px dark e 390px light de Conta', async ({
    page,
  }) => {
    const mock = setupMockApi(page);
    await mock.init();

    // 1. Screenshot 320px viewport, tema escuro
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/account');
    await expect(page.getByTestId('account-name-input')).toBeVisible();

    // Cria diretório se necessário e tira screenshot
    await page.screenshot({
      path: 'test-results/account-profile-review/account-320-dark.png',
      fullPage: true,
    });

    // 2. Screenshot 390px viewport, tema claro
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/account');
    await expect(page.getByTestId('account-name-input')).toBeVisible();

    await page.screenshot({
      path: 'test-results/account-profile-review/account-390-light.png',
      fullPage: true,
    });
  });
});
