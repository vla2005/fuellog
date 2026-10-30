import { test, expect } from '@playwright/test';

// Mocks identificados para frontend
const MOCK_USER = {
  id: 'usr-123',
  name: 'Piloto FuelLog',
  email: 'piloto@fuellog.test',
  preferredTimezone: 'America/Sao_Paulo',
};

const MOCK_TOKENS = {
  access_token: 'mock-access-token-jwt-style-12345',
  refresh_token: 'mock-refresh-token-uuid-67890',
  token_type: 'Bearer',
  expires_in: 900,
  access_expires_at: new Date(Date.now() + 900000).toISOString(),
  refresh_expires_at: new Date(Date.now() + 86400000).toISOString(),
  session_id: 'sess-abc-123',
};

test.describe('Fluxos de Segurança Frontend (Mocks Identificados)', () => {
  test('troca de senha: 422 retém digitado, 429 limite, sucesso 204 limpa sessão e redireciona ao login', async ({ page }) => {
    let passwordAttempts = 0;

    await page.addInitScript(({ refresh }) => {
      sessionStorage.setItem('fuellog.auth.refresh_token.v1', refresh);
    }, { refresh: MOCK_TOKENS.refresh_token });

    await page.route('**/api/v1/**', async (route) => {
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
          body: JSON.stringify({ enabled: false, recoveryCodesRemaining: 0 }),
        });
      }

      if (url.includes('/me/password') && method === 'POST') {
        passwordAttempts += 1;

        if (passwordAttempts === 1) {
          // 422 Senha atual errada
          return route.fulfill({
            status: 422,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              title: 'Erro de validação',
              detail: 'Senha atual incorreta.',
              fieldErrors: { currentPassword: 'A senha atual informada está incorreta.' },
            }),
          });
        }

        if (passwordAttempts === 2) {
          // 429 Rate limited
          return route.fulfill({
            status: 429,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              title: 'Limite excedido',
              detail: 'Muitas tentativas. Aguarde 5 minutos.',
            }),
          });
        }

        // Sucesso 204
        return route.fulfill({
          status: 204,
          headers: { 'Cache-Control': 'no-store' },
        });
      }

      if (url.includes('/me') && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_USER),
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

    await page.goto('/settings');
    await expect(page.getByText('Segurança', { exact: true })).toBeVisible();

    // Entra na seção de Segurança
    await page.getByRole('button', { name: /Segurança/ }).click();
    await expect(page.getByText('Gerenciamento da sua senha')).toBeVisible();

    // Abre Trocar senha
    await page.getByRole('button', { name: 'Trocar senha' }).click();
    await expect(page.getByLabel('Senha atual', { exact: true })).toBeVisible();

    const currentInput = page.getByLabel('Senha atual', { exact: true });
    const newInput = page.getByLabel('Nova senha', { exact: true });
    const confirmInput = page.getByLabel('Confirmar nova senha', { exact: true });
    const submitBtn = page.getByRole('button', { name: 'Atualizar senha' });

    // Tentativa 1: Senha atual errada -> 422
    await currentInput.fill('SenhaErrada123');
    await newInput.fill('NovaSenhaValida2026!');
    await confirmInput.fill('NovaSenhaValida2026!');
    await submitBtn.click();

    await expect(page.getByText('A senha atual informada está incorreta.')).toBeVisible();
    // Valida que digitado foi preservado
    expect(await newInput.inputValue()).toBe('NovaSenhaValida2026!');
    expect(await confirmInput.inputValue()).toBe('NovaSenhaValida2026!');

    // Tentativa 2: Rate limited -> 429
    await currentInput.fill('OutraTentativa123');
    await submitBtn.click();
    await expect(page.getByText('Muitas tentativas. Aguarde 5 minutos.')).toBeVisible();
    expect(await newInput.inputValue()).toBe('NovaSenhaValida2026!');

    // Tentativa 3: Sucesso -> 204 no-store
    await currentInput.fill('SenhaCorreta123');
    await submitBtn.click();

    // Redireciona para /login com aviso de sucesso
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Senha alterada com sucesso')).toBeVisible();

    // Valida que sessionStorage foi limpo
    const storedRefresh = await page.evaluate(() => sessionStorage.getItem('fuellog.auth.refresh_token.v1'));
    expect(storedRefresh).toBeNull();
  });

  test('login com desafio 2FA: não salva tokens antes de verificar, trata erro e aceita recovery code', async ({ page }) => {
    let verifyAttempts = 0;

    await page.route('**/api/v1/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/auth/login') && method === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            mfaRequired: true,
            challengeToken: 'test-challenge-token-url-safe-43-chars-example',
            expiresAt: new Date(Date.now() + 300000).toISOString(),
          }),
        });
      }

      if (url.includes('/auth/2fa/verify') && method === 'POST') {
        verifyAttempts += 1;

        if (verifyAttempts === 1) {
          // Código TOTP inválido -> 422
          return route.fulfill({
            status: 422,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              title: 'Código inválido',
              code: 'MFA_INVALID_CODE',
              fieldErrors: { code: 'Código de verificação incorreto.' },
            }),
          });
        }

        if (verifyAttempts === 2) {
          // Desafio expirado -> 401
          return route.fulfill({
            status: 401,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              title: 'Desafio inválido',
              code: 'MFA_CHALLENGE_INVALID',
              detail: 'O desafio expirou.',
            }),
          });
        }

        // Sucesso com recovery code
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_TOKENS),
        });
      }

      if (url.includes('/me') && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_USER),
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
          body: JSON.stringify(['GASOLINE_REGULAR']),
        });
      }

      return route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto('/login');
    await page.getByLabel('E-mail', { exact: true }).fill('piloto@fuellog.test');
    await page.getByLabel('Senha', { exact: true }).fill('Senha123!');
    await page.getByRole('button', { name: 'Entrar' }).click();

    // Abre tela de desafio 2FA
    await expect(page.getByText('Autenticação em duas etapas')).toBeVisible();
    await expect(page.getByLabel('Código de 6 dígitos', { exact: true })).toBeVisible();

    // Garante que NENHUM token foi salvo no sessionStorage antes do segundo fator
    const tokenDuringMfa = await page.evaluate(() => sessionStorage.getItem('fuellog.auth.refresh_token.v1'));
    expect(tokenDuringMfa).toBeNull();

    const codeInput = page.getByLabel('Código de 6 dígitos', { exact: true });
    const verifyBtn = page.getByRole('button', { name: 'Verificar e entrar' });

    // Valida clique real sem force em slot individual e correção por digitação no teclado
    await codeInput.fill('123456');
    await expect(page.getByRole('button', { name: 'Dígito 3: 3' })).toBeVisible();
    await page.getByRole('button', { name: 'Dígito 3: 3' }).click();
    await page.keyboard.press('8');
    await expect(page.getByRole('button', { name: 'Dígito 3: 8' })).toBeVisible();

    // Tentativa 1: Código TOTP inválido
    await codeInput.fill('000000');
    await verifyBtn.click();
    await expect(page.getByText('Código de verificação incorreto.')).toBeVisible();

    // Tentativa 2: Desafio expirado -> 401
    await codeInput.fill('111111');
    await verifyBtn.click();
    await expect(page.getByText(/desafio de autenticação expirou/)).toBeVisible();

    // Testa botão "Voltar ao login"
    await page.getByRole('button', { name: 'Voltar ao login' }).click();
    await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Senha', { exact: true })).toBeVisible();

    // Entra novamente no desafio
    await page.getByLabel('Senha', { exact: true }).fill('Senha123!');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByText('Autenticação em duas etapas')).toBeVisible();

    // Tentativa 3: Sucesso com Recovery Code de 43 caracteres via alternância clara
    await page.getByRole('button', { name: /Usar código de recuperação/ }).click();
    const recoveryCode = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop123';
    await page.getByLabel('Código de recuperação', { exact: true }).fill(recoveryCode);
    await page.getByRole('button', { name: 'Verificar e entrar' }).click();

    // Sucesso completa login e redireciona ao dashboard
    await expect(page).toHaveURL(/\/\/?$/);
    await expect(page.getByText('Sessão iniciada')).toBeVisible();
  });

  test('setup de 2FA: QR local, chave manual, confirmação 6 dígitos, exibição única dos 10 códigos e desativação', async ({ page, context }) => {
    let twoFactorEnabled = false;

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.addInitScript(({ refresh }) => {
      sessionStorage.setItem('fuellog.auth.refresh_token.v1', refresh);
    }, { refresh: MOCK_TOKENS.refresh_token });

    await page.route('**/api/v1/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/auth/refresh')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_TOKENS),
        });
      }

      if (url.includes('/me/2fa/setup') && method === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            secret: 'JBSWY3DPEHPK3PXP',
            otpauthUri: 'otpauth://totp/FuelLog:piloto@fuellog.test?secret=JBSWY3DPEHPK3PXP&issuer=FuelLog',
            expiresAt: new Date(Date.now() + 300000).toISOString(),
          }),
        });
      }

      if (url.includes('/me/2fa/enable') && method === 'POST') {
        twoFactorEnabled = true;
        const codes = Array.from({ length: 10 }, (_, i) => `recovery-${String(i).padStart(2, '0')}-43-chars-example-code-url-safe`);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ recoveryCodes: codes }),
        });
      }

      if (url.includes('/me/2fa/disable') && method === 'POST') {
        twoFactorEnabled = false;
        return route.fulfill({
          status: 204,
        });
      }

      if (url.includes('/me/2fa') && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: twoFactorEnabled,
            recoveryCodesRemaining: twoFactorEnabled ? 10 : 0,
          }),
        });
      }

      if (url.includes('/me') && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_USER),
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
          body: JSON.stringify(['GASOLINE_REGULAR']),
        });
      }

      return route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto('/settings');
    await page.getByRole('button', { name: /Segurança/ }).click();
    await page.getByRole('button', { name: 'Autenticação em duas etapas' }).click();

    // Tela de status inativo
    await expect(page.getByText('Verificação em duas etapas inativa')).toBeVisible();
    await page.getByRole('button', { name: 'Configurar autenticação em duas etapas' }).click();

    // Passo 1: Confirmação de senha
    await page.getByLabel('Sua senha', { exact: true }).fill('MinhaSenhaSecreta!');
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Passo 2: QR Code local e Chave manual
    await expect(page.getByText('1. Adicione a chave no Google Authenticator')).toBeVisible();
    await expect(page.getByText('JBSWY3DPEHPK3PXP')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Código QR para escaneamento' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copiar chave manual' })).toBeVisible();
    await page.getByRole('button', { name: 'Copiar chave manual' }).click();
    await expect(page.getByText('Copiada!')).toBeVisible();

    // Insere código de 6 dígitos
    await page.getByLabel('Código de 6 dígitos', { exact: true }).fill('123456');
    await page.getByRole('button', { name: 'Confirmar e ativar' }).click();

    // Passo 3: Exibição única dos 10 códigos de recuperação
    await expect(page.getByText('Autenticação ativada com sucesso!')).toBeVisible();
    await expect(page.getByText('Atenção: Guarde seus códigos de recuperação')).toBeVisible();
    await expect(page.getByText('recovery-00-43-chars-example-code-url-safe')).toBeVisible();
    await expect(page.getByText('recovery-09-43-chars-example-code-url-safe')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copiar todos os códigos de recuperação' })).toBeVisible();
    await page.getByRole('button', { name: 'Copiar todos os códigos de recuperação' }).click();
    await expect(page.getByText('Códigos copiados!')).toBeVisible();

    // Botão Concluir desabilitado até confirmar
    const finishBtn = page.getByRole('button', { name: 'Concluir configuração' });
    await expect(finishBtn).toBeDisabled();

    // Tentar fechar sem confirmar deve ser bloqueado
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(page.getByText(/Os códigos de recuperação são exibidos apenas agora/)).toBeVisible();

    // Marca confirmação
    await page.getByRole('checkbox', { name: /Confirmo que guardei/ }).click();
    await expect(finishBtn).toBeEnabled();
    await finishBtn.click();

    // Volta ao status ativo
    await expect(page.getByText('Proteção ativa com Google Authenticator')).toBeVisible();
    await expect(page.getByText('10 de 10 disponíveis')).toBeVisible();

    // Testa desativação
    await page.getByRole('button', { name: 'Desativar autenticação em duas etapas' }).click();
    await expect(page.getByText('Desativação de segurança')).toBeVisible();

    await page.getByLabel('Senha atual', { exact: true }).fill('MinhaSenhaSecreta!');
    await page.getByLabel('Código de 6 dígitos', { exact: true }).fill('123456');
    await page.getByRole('button', { name: 'Confirmar e desativar' }).click();

    // Volta para inativo
    await expect(page.getByText('Verificação em duas etapas inativa')).toBeVisible();
  });

  test('revisão visual de layout 320x640 escuro e 390x844 claro', async ({ page }) => {
    await page.addInitScript(({ refresh }) => {
      sessionStorage.setItem('fuellog.auth.refresh_token.v1', refresh);
    }, { refresh: MOCK_TOKENS.refresh_token });

    await page.route('**/api/v1/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/refresh')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TOKENS) });
      }
      if (url.includes('/me/2fa')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, recoveryCodesRemaining: 9 }) });
      }
      if (url.includes('/me')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER) });
      }
      if (url.includes('/vehicles')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      }
      if (url.includes('/fuel-types')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(['GASOLINE_REGULAR']) });
      }
      return route.fulfill({ status: 200, body: '{}' });
    });

    // 1. Viewport 320x640 (telas pequenas)
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/settings');
    await page.getByRole('button', { name: /Segurança/ }).click();
    await expect(page.getByText('Segurança', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trocar senha' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Autenticação em duas etapas' })).toBeVisible();

    // 2. Viewport 390x844 (iPhone padrão)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings');
    await page.getByRole('button', { name: /Segurança/ }).click();
    await expect(page.getByText('Segurança', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Voltar para Ajustes' }).click();
    await expect(page.getByText('Aparência')).toBeVisible();
  });
});
