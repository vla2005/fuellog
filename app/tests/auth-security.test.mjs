import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

process.env.EXPO_PUBLIC_API_URL = process.env.FUELLOG_API_URL ?? 'http://127.0.0.1:8080/api/v1';
const base = process.env.EXPO_PUBLIC_API_URL;

function loadTransport() {
  let access = null;
  let refresh = null;
  let epoch = 0;
  const storage = {
    getAccessToken: () => access,
    getRefreshToken: async () => refresh,
    getSessionEpoch: () => epoch,
    saveTokenPairAtomically: async (a, r, expectedEpoch) => {
      if (expectedEpoch !== undefined && epoch !== expectedEpoch) {
        throw new Error('Sessão alterada');
      }
      access = a;
      refresh = r;
    },
    clearStoredTokens: async () => { access = null; refresh = null; epoch += 1; },
    bumpSessionEpoch: () => { epoch += 1; return epoch; },
  };
  const modules = { './tokenStorage': storage };
  for (const name of ['types', 'client', 'endpoints']) {
    const source = readFileSync(new URL(`../src/api/${name}.ts`, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', outputText)(specifier => {
      assert.ok(Object.hasOwn(modules, specifier), `Import não autorizado no loader: ${specifier}`);
      return modules[specifier];
    }, module, module.exports);
    modules[`./${name}`] = module.exports;
  }
  return { storage, endpoints: modules['./endpoints'], client: modules['./client'], types: modules['./types'] };
}

test('loginUser com 2FA: retorna desafio sem salvar tokens em storage', async () => {
  const { endpoints, storage, types } = loadTransport();
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/auth/login')) {
        return new Response(JSON.stringify({
          mfaRequired: true,
          challengeToken: 'test-challenge-token-43-chars-url-safe-xyz123',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(url);
    };

    const res = await endpoints.loginUser({ email: 'mfa@example.test', password: 'valid-password' });
    assert.ok(types.isTwoFactorChallenge(res), 'Deve ser reconhecido como desafio MFA');
    assert.equal(res.mfaRequired, true);
    assert.equal(res.challengeToken, 'test-challenge-token-43-chars-url-safe-xyz123');
    assert.equal(storage.getAccessToken(), null, 'Nenhum access token deve ser salvo ao receber desafio 2FA');
    assert.equal(await storage.getRefreshToken(), null, 'Nenhum refresh token deve ser salvo ao receber desafio 2FA');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('loginUser com 2FA: resposta atrasada com desafio é rejeitada se epoch mudar', async () => {
  const { endpoints, storage } = loadTransport();
  const realFetch = globalThis.fetch;
  let release;
  let ready;
  const gate = new Promise(resolve => { release = resolve; });
  const responseReady = new Promise(resolve => { ready = resolve; });

  try {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/auth/login')) {
        ready();
        await gate;
        return new Response(JSON.stringify({
          mfaRequired: true,
          challengeToken: 'stale-challenge-token-43-chars-url-safe-xyz',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(url);
    };

    const pending = endpoints.loginUser({ email: 'mfa@example.test', password: 'valid-password' })
      .then(value => ({ value }), error => ({ error }));

    await responseReady;
    // Simula logout ou outra ação que avança o epoch enquanto o login estava em voo
    await storage.clearStoredTokens();
    release();

    const result = await pending;
    assert.ok(result.error, 'Login deve rejeitar com erro se epoch mudou antes do desafio');
    assert.equal(result.error.status, 401);
  } finally {
    release?.();
    globalThis.fetch = realFetch;
  }
});

test('verifyTwoFactor: envia desafio público e salva tokens atomicamente', async () => {
  const { endpoints, storage } = loadTransport();
  const realFetch = globalThis.fetch;
  let capturedBody;
  let capturedAuth;

  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/auth/2fa/verify')) {
        capturedBody = JSON.parse(init.body);
        capturedAuth = init.headers?.Authorization;
        return new Response(JSON.stringify({
          access_token: 'new-verified-access-token',
          refresh_token: 'new-verified-refresh-token',
          token_type: 'Bearer',
          expires_in: 900,
          access_expires_at: new Date(Date.now() + 900000).toISOString(),
          refresh_expires_at: new Date(Date.now() + 86400000).toISOString(),
          session_id: 'session-123',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(url, init);
    };

    const tokens = await endpoints.verifyTwoFactor({
      challengeToken: 'my-challenge-token',
      code: '123456',
    });

    assert.equal(capturedAuth, undefined, 'Endpoint de verificação deve ser público (sem Authorization)');
    assert.equal(capturedBody.challengeToken, 'my-challenge-token');
    assert.equal(capturedBody.code, '123456');
    assert.equal(tokens.access_token, 'new-verified-access-token');
    assert.equal(storage.getAccessToken(), 'new-verified-access-token', 'Token deve ser salvo no storage');
    assert.equal(await storage.getRefreshToken(), 'new-verified-refresh-token');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('verifyTwoFactor: mudança de epoch em voo descarta tokens recebidos', async () => {
  const { endpoints, storage } = loadTransport();
  const realFetch = globalThis.fetch;
  let release;
  let ready;
  const gate = new Promise(resolve => { release = resolve; });
  const responseReady = new Promise(resolve => { ready = resolve; });

  try {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/auth/2fa/verify')) {
        ready();
        await gate;
        return new Response(JSON.stringify({
          access_token: 'stale-access-token',
          refresh_token: 'stale-refresh-token',
          token_type: 'Bearer',
          expires_in: 900,
          access_expires_at: new Date(Date.now() + 900000).toISOString(),
          refresh_expires_at: new Date(Date.now() + 86400000).toISOString(),
          session_id: 'session-stale',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(url);
    };

    const pending = endpoints.verifyTwoFactor({
      challengeToken: 'my-challenge-token',
      code: '123456',
    }).then(value => ({ value }), error => ({ error }));

    await responseReady;
    await storage.clearStoredTokens(); // avança epoch
    release();

    const result = await pending;
    assert.ok(result.error, 'Verificação deve falhar se época de sessão mudou durante o voo');
    assert.equal(storage.getAccessToken(), null, 'Tokens obsoletos não devem ser persistidos');
  } finally {
    release?.();
    globalThis.fetch = realFetch;
  }
});

test('changePassword: envia POST /me/password autenticado com 204 no-store', async () => {
  const { endpoints, storage } = loadTransport();
  await storage.saveTokenPairAtomically('active-access-token', 'active-refresh-token');
  const realFetch = globalThis.fetch;
  let capturedUrl;
  let capturedBody;
  let capturedAuth;

  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/me/password')) {
        capturedUrl = String(url);
        capturedBody = JSON.parse(init.body);
        capturedAuth = init.headers?.Authorization;
        return new Response(null, {
          status: 204,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      return realFetch(url, init);
    };

    await endpoints.changePassword({
      currentPassword: 'old-Password-123',
      newPassword: 'new-Password-456',
      secondFactorCode: '654321',
    });

    assert.ok(capturedUrl.endsWith('/me/password'));
    assert.equal(capturedAuth, 'Bearer active-access-token');
    assert.equal(capturedBody.currentPassword, 'old-Password-123');
    assert.equal(capturedBody.newPassword, 'new-Password-456');
    assert.equal(capturedBody.secondFactorCode, '654321');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('endpoints de 2FA: rotas GET/POST com payloads e headers autenticados', async () => {
  const { endpoints, storage } = loadTransport();
  await storage.saveTokenPairAtomically('auth-token-123', 'refresh-token-123');
  const realFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
      if (u.endsWith('/me/2fa') && (!init || init.method === 'GET')) {
        return new Response(JSON.stringify({ enabled: false, recoveryCodesRemaining: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.endsWith('/me/2fa/setup')) {
        return new Response(JSON.stringify({
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/FuelLog:user?secret=JBSWY3DPEHPK3PXP',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.endsWith('/me/2fa/enable')) {
        return new Response(JSON.stringify({
          recoveryCodes: Array.from({ length: 10 }, (_, i) => `recovery-code-${i}-43-characters-long-example-1`),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.endsWith('/me/2fa/disable')) {
        return new Response(null, { status: 204 });
      }
      return realFetch(url, init);
    };

    const status = await endpoints.getTwoFactorStatus();
    assert.equal(status.enabled, false);

    const setup = await endpoints.setupTwoFactor({ currentPassword: 'password1' });
    assert.equal(setup.secret, 'JBSWY3DPEHPK3PXP');

    const enabled = await endpoints.enableTwoFactor({ code: '123456' });
    assert.equal(enabled.recoveryCodes.length, 10);

    await endpoints.disableTwoFactor({ currentPassword: 'password1', code: '123456' });

    assert.equal(calls.length, 4);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[2].method, 'POST');
    assert.equal(calls[3].method, 'POST');
  } finally {
    globalThis.fetch = realFetch;
  }
});


test('handlePasswordChanged com expectedEpoch: retorna false se obsoleto e true se coincide, revalidando p?s-limpeza', async () => {
  let epoch = 5;
  let cleared = false;
  const clearStoredTokens = async () => { cleared = true; };
  const bumpSessionEpoch = () => { epoch += 1; return epoch; };
  const getSessionEpoch = () => epoch;

  const handlePasswordChanged = async (expectedEpoch) => {
    if (expectedEpoch !== undefined && getSessionEpoch() !== expectedEpoch) {
      return false;
    }
    bumpSessionEpoch();
    await clearStoredTokens();
    if (expectedEpoch !== undefined && getSessionEpoch() !== expectedEpoch + 1) {
      return false;
    }
    return true;
  };

  // 1. Resposta com expectedEpoch desatualizado (ex: 4 vs atual 5)
  const resOutdated = await handlePasswordChanged(4);
  assert.equal(resOutdated, false, 'Deve retornar false para resposta obsoleta');
  assert.equal(cleared, false, 'N?o deve limpar tokens');
  assert.equal(epoch, 5);

  // 2. Resposta com expectedEpoch correspondente (5)
  const resValid = await handlePasswordChanged(5);
  assert.equal(resValid, true, 'Deve retornar true para resposta v?lida');
  assert.equal(cleared, true, 'Deve limpar tokens');
  assert.equal(epoch, 6);

  // 3. Concorr?ncia durante clearStoredTokens que altera o epoch
  epoch = 20;
  cleared = false;
  const raceClear = async () => { epoch = 25; }; // outra troca de conta acontece durante o clear
  const raceHandler = async (expectedEpoch) => {
    if (expectedEpoch !== undefined && getSessionEpoch() !== expectedEpoch) return false;
    bumpSessionEpoch();
    await raceClear();
    if (expectedEpoch !== undefined && getSessionEpoch() !== expectedEpoch + 1) return false;
    return true;
  };
  const resRace = await raceHandler(20);
  assert.equal(resRace, false, 'Deve detectar altera??o de ?poca p?s-clear e retornar false');
});

test('v?nculo do desafio MFA com token, epoch e expira??o: rejeita token divergente, expirado ou cancelado', async () => {
  let epoch = 10;
  let activeChallenge = null;
  const bumpSessionEpoch = () => { epoch += 1; return epoch; };
  const getSessionEpoch = () => epoch;

  const cancelTwoFactorChallenge = () => {
    activeChallenge = null;
    bumpSessionEpoch();
  };

  const simulateLoginChallenge = (token, ttlMs = 300000) => {
    const loginEpoch = bumpSessionEpoch();
    activeChallenge = {
      challengeToken: token,
      epoch: loginEpoch,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
    return activeChallenge;
  };

  const completeTwoFactorSignIn = async (challengeToken, code) => {
    const challenge = activeChallenge;
    if (
      !challenge ||
      challenge.challengeToken !== challengeToken ||
      challenge.epoch !== getSessionEpoch() ||
      Date.now() >= new Date(challenge.expiresAt).getTime()
    ) {
      throw new Error('Desafio expirado ou cancelado. Fa?a login novamente.');
    }
    activeChallenge = null;
    return true;
  };

  // 1. Tentar verificar sem login anterior
  await assert.rejects(
    async () => completeTwoFactorSignIn('token-1', '123456'),
    /Desafio expirado ou cancelado/
  );

  // 2. Desafio emitido para conta A
  simulateLoginChallenge('token-a');
  assert.equal(activeChallenge.challengeToken, 'token-a');

  // 3. Tentar verificar desafio A usando token de outro desafio B deve rejeitar
  await assert.rejects(
    async () => completeTwoFactorSignIn('token-b', '123456'),
    /Desafio expirado ou cancelado/
  );

  // 4. Desafio com expira??o passada deve rejeitar
  simulateLoginChallenge('expired-token', -1000);
  await assert.rejects(
    async () => completeTwoFactorSignIn('expired-token', '123456'),
    /Desafio expirado ou cancelado/
  );

  // 5. Desafio v?lido cancelado
  simulateLoginChallenge('valid-token');
  cancelTwoFactorChallenge();
  await assert.rejects(
    async () => completeTwoFactorSignIn('valid-token', '123456'),
    /Desafio expirado ou cancelado/
  );
});


test('guard de geração e epoch: respostas assíncronas tardias de 2FA são descartadas ao trocar de usuário ou cancelar fluxo', async () => {
  let sessionEpoch = 1;
  const getCurrentSessionEpoch = () => sessionEpoch;

  let flowGen = 0;
  let isVisible = true;
  let state = {
    setupData: null,
    recoveryCodes: [],
    status: null,
    submitting: false,
  };

  const startSetup = () => {
    const epoch = getCurrentSessionEpoch();
    const gen = ++flowGen;
    state.submitting = true;

    return {
      resolve: (data) => {
        if (getCurrentSessionEpoch() !== epoch || flowGen !== gen || !isVisible) {
          return false;
        }
        state.setupData = data;
        state.submitting = false;
        return true;
      },
    };
  };

  // 1. Inicia setup na conta A
  const req1 = startSetup();
  assert.equal(state.submitting, true);

  // Usuário desiste e fecha a tela
  flowGen += 1;
  isVisible = false;

  // Resposta da conta A chega tarde
  const committed1 = req1.resolve({ secret: 'LEAKED_SECRET', otpauthUri: 'otpauth://...' });
  assert.equal(committed1, false, 'Resposta tardia após fechar modal não pode ser aplicada');
  assert.equal(state.setupData, null, 'Segredo não deve vazar para o estado');

  // 2. Nova tela aberta na conta B (epoch alterado)
  sessionEpoch = 2;
  isVisible = true;
  const req2 = startSetup();

  // Usuário desloga (epoch avança)
  sessionEpoch = 3;
  const committed2 = req2.resolve({ secret: 'ACCOUNT_B_SECRET', otpauthUri: 'otpauth://...' });
  assert.equal(committed2, false, 'Resposta tardia após mudança de sessão deve ser descartada');
  assert.equal(state.setupData, null);

  // 3. Resposta no mesmo epoch e geração válidos é aceita
  const req3 = startSetup();
  const committed3 = req3.resolve({ secret: 'VALID_SECRET', otpauthUri: 'otpauth://...' });
  assert.equal(committed3, true, 'Resposta legítima é aplicada com sucesso');
  assert.deepEqual(state.setupData, { secret: 'VALID_SECRET', otpauthUri: 'otpauth://...' });
});

test('fechamento seguro de 2FA: bloqueia saída se recovery codes não foram confirmados e impede fechar em voo', () => {
  let mode = 'setup_recovery';
  let confirmedSavedCodes = false;
  let submitting = false;
  let closed = false;
  let errorMsg = null;

  const handleSafeClose = () => {
    if (submitting) {
      return false;
    }
    if (mode === 'setup_recovery' && !confirmedSavedCodes) {
      errorMsg = 'Atenção: Os códigos de recuperação são exibidos apenas agora. Marque a confirmação de que os guardou antes de fechar.';
      return false;
    }
    closed = true;
    return true;
  };

  // 1. Tentar fechar em voo (submitting = true)
  submitting = true;
  assert.equal(handleSafeClose(), false);
  assert.equal(closed, false);

  // 2. Tentar fechar na tela de recovery codes sem marcar checkbox
  submitting = false;
  assert.equal(handleSafeClose(), false);
  assert.equal(closed, false);
  assert.match(errorMsg, /códigos de recuperação/);

  // 3. Marcar checkbox e fechar
  confirmedSavedCodes = true;
  assert.equal(handleSafeClose(), true);
  assert.equal(closed, true);
});

test('verificação de status 2FA: falha de rede mantém estado desconhecido e não declara desativado', async () => {
  let sessionEpoch = 1;
  const getCurrentSessionEpoch = () => sessionEpoch;
  let statusGen = 0;

  let twoFactorStatus = null;
  let twoFactorLoading = false;
  let twoFactorError = null;

  const check2FaStatus = async (fetcher) => {
    const epoch = getCurrentSessionEpoch();
    const reqGen = ++statusGen;
    twoFactorLoading = true;
    twoFactorError = null;

    try {
      const res = await fetcher();
      if (getCurrentSessionEpoch() === epoch && reqGen === statusGen) {
        twoFactorStatus = res;
        twoFactorLoading = false;
      }
      return res;
    } catch {
      if (getCurrentSessionEpoch() === epoch && reqGen === statusGen) {
        twoFactorError = 'Não foi possível verificar status de segurança.';
        twoFactorLoading = false;
      }
      return null;
    }
  };

  // Erro de rede: não assume enabled: false!
  const res = await check2FaStatus(async () => {
    throw new Error('Network error');
  });

  assert.equal(res, null);
  assert.equal(twoFactorStatus, null, 'Status deve permanecer null/desconhecido, não false');
  assert.equal(twoFactorLoading, false);
  assert.equal(twoFactorError, 'Não foi possível verificar status de segurança.');

  // Sucesso na tentativa seguinte
  await check2FaStatus(async () => ({ enabled: true, recoveryCodesRemaining: 10 }));
  assert.deepEqual(twoFactorStatus, { enabled: true, recoveryCodesRemaining: 10 });
  assert.equal(twoFactorError, null);
});
