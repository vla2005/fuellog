import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function extractCallbackFromSessionContext(callbackName) {
  const sourceText = readFileSync(
    new URL('../src/state/SessionContext.tsx', import.meta.url),
    'utf8',
  );
  const sourceFile = ts.createSourceFile(
    'SessionContext.tsx',
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );

  let arrowNode = null;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === callbackName &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.arguments.length > 0
    ) {
      arrowNode = node.initializer.arguments[0];
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert.ok(
    arrowNode,
    `VariableDeclaration ${callbackName} com useCallback(arrow) não encontrada no AST de SessionContext.tsx`,
  );

  const arrowCode = arrowNode.getText(sourceFile);
  const transpiled = ts.transpileModule(`exports.run = ${arrowCode};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  return function createCallbackInstance(scope) {
    const module = { exports: {} };
    const keys = Object.keys(scope);
    const values = Object.values(scope);
    const fn = new Function('require', 'module', 'exports', ...keys, transpiled.outputText);
    fn(() => {}, module, module.exports, ...values);
    return module.exports.run;
  };
}

class MockApiError extends Error {
  constructor({ message, kind, status }) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

test('bootstrapSession real AST: carrega capacidade biométrica com guard de época', async () => {
  const factory = extractCallbackFromSessionContext('bootstrapSession');

  let currentEpoch = 10;
  let status = 'initial';
  let bootError = null;
  let biometricDeviceInfo = null;
  let hasBiometricLock = false;
  let isBiometricActive = false;
  let user = null;

  const mockDeviceInfo = {
    isSupported: true,
    isEnrolled: true,
    biometricType: 'fingerprint',
    biometricLabel: 'Impressão digital',
    isExpoGoIos: false,
  };

  const bootstrap = factory({
    getSessionEpoch: () => currentEpoch,
    setStatus: (s) => { status = s; },
    setBootError: (e) => { bootError = e; },
    getBiometricDeviceInfo: async () => mockDeviceInfo,
    setBiometricDeviceInfo: (info) => { biometricDeviceInfo = info; },
    getStoredSessionType: async () => 'plain',
    isBiometricSessionUnlocked: () => false,
    setHasBiometricLock: (v) => { hasBiometricLock = v; },
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    clearInMemoryUserData: () => {},
    getAccessToken: () => 'valid-access',
    getRefreshToken: async () => 'valid-refresh',
    refreshSession: async () => {},
    getMe: async () => ({ id: 'usr-1', name: 'Motorista', email: 'motorista@exemplo.com' }),
    loadUserWorkspace: async () => {},
    setUser: (u) => { user = u; },
    clearStoredTokens: async () => {},
    ApiError: MockApiError,
  });

  await bootstrap();

  assert.equal(status, 'authenticated');
  assert.equal(biometricDeviceInfo?.isSupported, true);
  assert.equal(biometricDeviceInfo?.biometricLabel, 'Impressão digital');
  assert.equal(hasBiometricLock, false);
  assert.equal(isBiometricActive, false);
  assert.equal(user?.email, 'motorista@exemplo.com');

  // Teste de guard de época: se epoch mudar durante getBiometricDeviceInfo, descarta atualização
  status = 'initial';
  biometricDeviceInfo = null;
  const staleBootstrap = factory({
    getSessionEpoch: () => currentEpoch,
    setStatus: (s) => { status = s; },
    setBootError: (e) => { bootError = e; },
    getBiometricDeviceInfo: async () => {
      currentEpoch += 1; // simula mudança concorrente de época em voo
      return mockDeviceInfo;
    },
    setBiometricDeviceInfo: (info) => { biometricDeviceInfo = info; },
    getStoredSessionType: async () => 'plain',
    isBiometricSessionUnlocked: () => false,
    setHasBiometricLock: () => {},
    setIsBiometricActive: () => {},
    clearInMemoryUserData: () => {},
    getAccessToken: () => null,
    getRefreshToken: async () => null,
    refreshSession: async () => {},
    getMe: async () => ({}),
    loadUserWorkspace: async () => {},
    setUser: () => {},
    clearStoredTokens: async () => {},
    ApiError: MockApiError,
  });

  await staleBootstrap();
  assert.equal(biometricDeviceInfo, null, 'Não deve preencher info com época alterada');
  assert.notEqual(status, 'authenticated', 'Não deve publicar autenticado com época alterada');
});

test('bootstrapSession real AST: boot com credencial biométrica bloqueada disponibiliza biometria sem API protegida nem prompt', async () => {
  const factory = extractCallbackFromSessionContext('bootstrapSession');

  let currentEpoch = 1;
  let status = 'booting';
  let hasBiometricLock = false;
  let isBiometricActive = false;
  let clearedUserData = false;
  let apiProtectedCalls = 0;

  const mockDeviceInfo = {
    isSupported: true,
    isEnrolled: true,
    biometricType: 'face',
    biometricLabel: 'Face ID',
    isExpoGoIos: false,
  };

  const bootstrap = factory({
    getSessionEpoch: () => currentEpoch,
    setStatus: (s) => { status = s; },
    setBootError: () => {},
    getBiometricDeviceInfo: async () => mockDeviceInfo,
    setBiometricDeviceInfo: () => {},
    getStoredSessionType: async () => 'biometric',
    isBiometricSessionUnlocked: () => false, // Sessão bloqueada (sem chave em memória)
    setHasBiometricLock: (v) => { hasBiometricLock = v; },
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    clearInMemoryUserData: () => { clearedUserData = true; },
    getAccessToken: () => {
      apiProtectedCalls += 1;
      return null;
    },
    getRefreshToken: async () => {
      apiProtectedCalls += 1;
      return null;
    },
    refreshSession: async () => {
      apiProtectedCalls += 1;
    },
    getMe: async () => {
      apiProtectedCalls += 1;
      return {};
    },
    loadUserWorkspace: async () => {
      apiProtectedCalls += 1;
    },
    setUser: () => {},
    clearStoredTokens: async () => {},
    ApiError: MockApiError,
  });

  await bootstrap();

  assert.equal(hasBiometricLock, true, 'hasBiometricLock deve virar true quando bloqueado');
  assert.equal(isBiometricActive, true, 'isBiometricActive deve virar true');
  assert.equal(clearedUserData, true, 'Deve limpar dados em memória de usuário');
  assert.equal(status, 'unauthenticated', 'Status deve ir para unauthenticated para exibir tela de login');
  assert.equal(apiProtectedCalls, 0, 'Nenhuma chamada de API protegida ou refresh deve ser disparada');
});

test('signIn real AST sem MFA com opt-in: executa enableBiometricSession ANTES de publicar authenticated', async () => {
  const factory = extractCallbackFromSessionContext('signIn');

  let currentEpoch = 1;
  let status = 'unauthenticated';
  let hasBiometricLock = true;
  let isBiometricActive = false;
  const executionTimeline = [];
  let capturedToast = null;

  const signIn = factory({
    bumpSessionEpoch: () => {
      currentEpoch += 1;
      return currentEpoch;
    },
    activeChallengeRef: { current: null },
    loginUser: async () => ({ access_token: 'acc-1', refresh_token: 'ref-1' }),
    getSessionEpoch: () => currentEpoch,
    isTwoFactorChallenge: () => false,
    getMe: async () => ({ id: 'usr-1', email: 'test@example.com' }),
    loadUserWorkspace: async () => {
      executionTimeline.push('loadUserWorkspace');
    },
    enableBiometricSession: async (epoch) => {
      executionTimeline.push(`enableBiometricSession:${epoch}`);
      return { success: true, canceled: false };
    },
    setHasBiometricLock: (v) => { hasBiometricLock = v; },
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    showToast: (t) => { capturedToast = t; },
    setUser: () => {
      executionTimeline.push('setUser');
    },
    setPrefilledLoginEmail: () => {},
    setBootError: () => {},
    setStatus: (s) => {
      executionTimeline.push(`setStatus:${s}`);
      status = s;
    },
  });

  const res = await signIn(
    { email: 'test@example.com', password: 'password123' },
    { enableBiometrics: true },
  );

  assert.equal(res.mfaRequired, false);
  assert.equal(status, 'authenticated');
  assert.equal(isBiometricActive, true);
  assert.equal(hasBiometricLock, false);
  assert.equal(capturedToast?.tone, 'success');
  assert.match(capturedToast?.subtitle, /Biometria ativada com sucesso/);

  // Ordem estrita: ativação biométrica ANTES de publicar 'authenticated'
  const enableIndex = executionTimeline.findIndex((entry) => entry.startsWith('enableBiometricSession'));
  const setStatusIndex = executionTimeline.indexOf('setStatus:authenticated');
  assert.ok(enableIndex !== -1, 'enableBiometricSession deve ter sido executado');
  assert.ok(setStatusIndex !== -1, 'setStatus:authenticated deve ter sido executado');
  assert.ok(
    enableIndex < setStatusIndex,
    `enableBiometricSession (${enableIndex}) deve ocorrer antes de setStatus:authenticated (${setStatusIndex})`,
  );
});

test('signIn real AST sem MFA com cancelamento da biometria: publica authenticated e não exige outro login', async () => {
  const factory = extractCallbackFromSessionContext('signIn');

  let currentEpoch = 1;
  let status = 'unauthenticated';
  let isBiometricActive = true;
  let capturedToast = null;

  const signIn = factory({
    bumpSessionEpoch: () => {
      currentEpoch += 1;
      return currentEpoch;
    },
    activeChallengeRef: { current: null },
    loginUser: async () => ({ access_token: 'acc-1', refresh_token: 'ref-1' }),
    getSessionEpoch: () => currentEpoch,
    isTwoFactorChallenge: () => false,
    getMe: async () => ({ id: 'usr-1', email: 'test@example.com' }),
    loadUserWorkspace: async () => {},
    enableBiometricSession: async () => ({ success: false, canceled: true }), // Usuário cancelou biometria
    setHasBiometricLock: () => {},
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    showToast: (t) => { capturedToast = t; },
    setUser: () => {},
    setPrefilledLoginEmail: () => {},
    setBootError: () => {},
    setStatus: (s) => { status = s; },
  });

  const res = await signIn(
    { email: 'test@example.com', password: 'password123' },
    { enableBiometrics: true },
  );

  assert.equal(res.mfaRequired, false);
  // Cancelamento NÃO bloqueia o login: entra normalmente!
  assert.equal(status, 'authenticated', 'Deve publicar authenticated mesmo cancelando biometria');
  assert.equal(isBiometricActive, false, 'Biometria deve permanecer desativada');
  assert.equal(capturedToast?.tone, 'info');
  assert.equal(capturedToast?.subtitle, 'A biometria não foi ativada.');
});

test('signIn e completeTwoFactorSignIn real AST com MFA: intenção sobrevive ao MFA e ativação ocorre antes de authenticated', async () => {
  const signInFactory = extractCallbackFromSessionContext('signIn');
  const completeMfaFactory = extractCallbackFromSessionContext('completeTwoFactorSignIn');

  let currentEpoch = 1;
  let status = 'unauthenticated';
  let isBiometricActive = false;
  const activeChallengeRef = { current: null };
  const executionTimeline = [];
  let capturedToast = null;

  const signIn = signInFactory({
    bumpSessionEpoch: () => {
      currentEpoch += 1;
      return currentEpoch;
    },
    activeChallengeRef,
    loginUser: async () => ({
      mfaRequired: true,
      challengeToken: 'valid-challenge-43-chars-example-token-1234',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    }),
    getSessionEpoch: () => currentEpoch,
    isTwoFactorChallenge: () => true,
    getMe: async () => ({}),
    loadUserWorkspace: async () => {},
    enableBiometricSession: async () => ({ success: true, canceled: false }),
    setHasBiometricLock: () => {},
    setIsBiometricActive: () => {},
    showToast: () => {},
    setUser: () => {},
    setPrefilledLoginEmail: () => {},
    setBootError: () => {},
    setStatus: () => {},
  });

  // 1. Inicia login com opt-in biométrico habilitado
  const loginRes = await signIn(
    { email: 'mfa@example.com', password: 'password123' },
    { enableBiometrics: true },
  );

  assert.equal(loginRes.mfaRequired, true);
  assert.ok(activeChallengeRef.current, 'activeChallengeRef deve ser preenchido');
  assert.equal(activeChallengeRef.current.enableBiometrics, true, 'Intenção biométrica deve ser preservada no desafio');

  // 2. Conclui 2FA sem precisar passar options novamente (preserva a intenção original do formulário)
  const completeTwoFactorSignIn = completeMfaFactory({
    activeChallengeRef,
    getSessionEpoch: () => currentEpoch,
    ApiError: MockApiError,
    verifyTwoFactor: async () => ({ access_token: 'mfa-acc', refresh_token: 'mfa-ref' }),
    getMe: async () => ({ id: 'usr-mfa', email: 'mfa@example.com' }),
    loadUserWorkspace: async () => {},
    enableBiometricSession: async (epoch) => {
      executionTimeline.push(`enableBiometricSession:${epoch}`);
      return { success: true, canceled: false };
    },
    setHasBiometricLock: () => {},
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    showToast: (t) => { capturedToast = t; },
    setUser: () => {
      executionTimeline.push('setUser');
    },
    setPrefilledLoginEmail: () => {},
    setBootError: () => {},
    setStatus: (s) => {
      executionTimeline.push(`setStatus:${s}`);
      status = s;
    },
  });

  await completeTwoFactorSignIn('valid-challenge-43-chars-example-token-1234', '123456');

  assert.equal(status, 'authenticated');
  assert.equal(isBiometricActive, true, 'Biometria deve ser ativada após 2FA com base na intenção preservada');
  assert.equal(capturedToast?.tone, 'success');

  const enableIndex = executionTimeline.findIndex((entry) => entry.startsWith('enableBiometricSession'));
  const setStatusIndex = executionTimeline.indexOf('setStatus:authenticated');
  assert.ok(enableIndex < setStatusIndex, 'Ativação deve ocorrer antes de publicar authenticated no 2FA');
});

test('sincronização de flags em logout, senha alterada e unauthorized', async () => {
  const signOutFactory = extractCallbackFromSessionContext('signOut');
  const passwordChangeFactory = extractCallbackFromSessionContext('handlePasswordChanged');

  let hasBiometricLock = true;
  let isBiometricActive = true;
  let status = 'authenticated';
  let epoch = 5;

  const signOut = signOutFactory({
    logoutSession: async () => {},
    clearStoredTokens: async () => {},
    clearInMemoryUserData: () => {},
    setHasBiometricLock: (v) => { hasBiometricLock = v; },
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    setStatus: (s) => { status = s; },
    showToast: () => {},
  });

  await signOut();
  assert.equal(hasBiometricLock, false, 'hasBiometricLock deve resetar para false no logout');
  assert.equal(isBiometricActive, false, 'isBiometricActive deve resetar para false no logout');
  assert.equal(status, 'unauthenticated');

  // Teste handlePasswordChanged
  hasBiometricLock = true;
  isBiometricActive = true;
  status = 'authenticated';

  const handlePasswordChanged = passwordChangeFactory({
    getSessionEpoch: () => epoch,
    activeChallengeRef: { current: null },
    clearStoredTokens: async () => { epoch += 1; },
    clearInMemoryUserData: () => {},
    setHasBiometricLock: (v) => { hasBiometricLock = v; },
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    setStatus: (s) => { status = s; },
  });

  const ok = await handlePasswordChanged(5);
  assert.equal(ok, true);
  assert.equal(hasBiometricLock, false, 'hasBiometricLock deve resetar para false na troca de senha');
  assert.equal(isBiometricActive, false, 'isBiometricActive deve resetar para false na troca de senha');
  assert.equal(status, 'unauthenticated');
});

test('signUpAndSignIn real AST: cadastro não ativa biometria mesmo se o dispositivo suportar', async () => {
  const signUpFactory = extractCallbackFromSessionContext('signUpAndSignIn');

  let passedOptions = null;
  const signUpAndSignIn = signUpFactory({
    registerUser: async () => ({ id: 'usr-new' }),
    signIn: async (payload, options) => {
      passedOptions = options;
      return { mfaRequired: false };
    },
    setPrefilledLoginEmail: () => {},
  });

  const res = await signUpAndSignIn({
    name: 'Novo Usuário',
    email: 'novo@exemplo.com',
    password: 'password123',
  });

  assert.equal(res.registeredOnly, false);
  assert.equal(passedOptions, undefined, 'Cadastro nunca deve passar opt-in biométrico para o signIn');
});

test('cancelTwoFactorChallenge real AST: limpeza da rota após sucesso não invalida sessão mas cancelamento em voo avança epoch', async () => {
  const cancelFactory = extractCallbackFromSessionContext('cancelTwoFactorChallenge');

  let epoch = 2;
  const activeChallengeRef = { current: { challengeToken: 'tok-1', epoch: 2, expiresAt: '2099-01-01' } };
  const statusRef = { current: 'unauthenticated' };

  const cancelTwoFactorChallenge = cancelFactory({
    statusRef,
    activeChallengeRef,
    bumpSessionEpoch: () => {
      epoch += 1;
      return epoch;
    },
  });

  // Cenário 1: Cancelamento durante desafio 2FA ou login em voo (status unauthenticated)
  cancelTwoFactorChallenge();
  assert.equal(activeChallengeRef.current, null, 'Desafio deve ser anulado');
  assert.equal(epoch, 3, 'Epoch deve avançar para invalidar respostas em voo');

  // Cenário 2: Limpeza da rota após login/2FA bem-sucedido (status authenticated)
  statusRef.current = 'authenticated';
  activeChallengeRef.current = null;
  const epochAfterLogin = epoch;

  cancelTwoFactorChallenge();
  assert.equal(
    epoch,
    epochAfterLogin,
    'Limpeza de rota após login bem-sucedido NÃO deve avançar epoch nem invalidar a sessão recém-publicada',
  );
});

