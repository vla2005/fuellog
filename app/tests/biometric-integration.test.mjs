import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCallbackFromSessionContext } from './helpers/session-fixtures.mjs';

class MockApiError extends Error {
  constructor({ message, kind, status }) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

test('bootstrap automático com B separado não exige biometria; após Sair e reload não chama API', async () => {
  const factory = extractCallbackFromSessionContext('bootstrapSession');
  let active = true;
  let status;
  let lock;
  let biometric;
  let protectedCalls = 0;
  const run = factory({
    getSessionEpoch: () => 1, setStatus: s => { status = s; }, setBootError: () => {},
    getBiometricDeviceInfo: async () => ({ isSupported: true }), setBiometricDeviceInfo: () => {},
    getStoredSessionType: async () => active ? 'plain' : 'none',
    getBiometricSessionId: async () => 'session-B',
    isBiometricSessionUnlocked: () => false,
    setHasBiometricLock: value => { lock = value; }, setIsBiometricActive: value => { biometric = value; },
    clearInMemoryUserData: () => {}, getAccessToken: () => null,
    getRefreshToken: async () => active ? 'refresh-A' : null,
    refreshSession: async () => { protectedCalls++; },
    getMe: async () => { protectedCalls++; return { id: 'owner' }; },
    loadUserWorkspace: async () => { protectedCalls++; }, setUser: () => {}, ApiError: MockApiError,
  });
  await run();
  assert.equal(status, 'authenticated');
  assert.equal(lock, false);
  assert.equal(biometric, true);
  assert.equal(protectedCalls, 3);
  active = false;
  protectedCalls = 0;
  await run();
  assert.equal(status, 'unauthenticated');
  assert.equal(lock, true);
  assert.equal(biometric, true);
  assert.equal(protectedCalls, 0);
});

test('Sair revoga A e remove somente sessão ativa preservando opção biométrica', async () => {
  const factory = extractCallbackFromSessionContext('signOut');
  const calls = [];
  let lock;
  let active;
  let epoch = 2;
  const signOut = factory({
    getSessionEpoch: () => epoch,
    logoutSession: async () => { calls.push('revoke-A'); },
    clearActiveSession: async () => { calls.push('remove-A'); epoch++; },
    clearStoredTokens: async () => { assert.fail('B deve permanecer'); },
    getBiometricSessionId: async () => 'B', clearInMemoryUserData: () => {},
    setHasBiometricLock: v => { lock = v; }, setIsBiometricActive: v => { active = v; },
    biometricSuggestionBusyRef: { current: false }, setBiometricSuggestionBusy: () => {},
    setBiometricSuggestionOpen: () => {}, setStatus: () => {}, showToast: () => {},
  });
  await signOut();
  assert.deepEqual(calls, ['revoke-A', 'remove-A']);
  assert.equal(lock, true);
  assert.equal(active, true);
});

test('logout atrasado não apaga UI da sessão que iniciou durante revogação', async () => {
  let epoch = 1;
  const run = extractCallbackFromSessionContext('signOut')({
    getSessionEpoch: () => epoch, getBiometricSessionId: async () => 'B',
    logoutSession: async () => { epoch++; },
    clearActiveSession: async () => { assert.fail('sessão nova preservada'); },
    clearInMemoryUserData: () => { assert.fail('UI da sessão nova preservada'); },
    setHasBiometricLock: () => { assert.fail('flags da sessão nova preservadas'); },
    setIsBiometricActive: () => {}, setStatus: () => {},
  });
  await run();
});

test('relogin biométrico usa API pública, persiste B/C e só autentica após getMe', async () => {
  const factory = extractCallbackFromSessionContext('unlockWithBiometrics');
  const calls = [];
  const run = factory({
    getSessionEpoch: () => 4,
    unlockBiometricSession: async () => ({ success: true, refreshToken: 'B1', legacy: false }),
    loginWithBiometrics: async token => { assert.equal(token, 'B1'); calls.push('public-login'); return { biometric: 'B2', session: 'C' }; },
    saveBiometricLoginAtomically: async (b, c, epoch) => { assert.deepEqual([b, c, epoch], ['B2', 'C', 4]); calls.push('persist'); },
    refreshSession: async () => { assert.fail('B não pode usar /auth/refresh'); },
    getMe: async () => { calls.push('getMe'); return { id: 'owner', email: 'owner@example.test' }; },
    loadUserWorkspace: async () => {}, setUser: () => {}, setPrefilledLoginEmail: () => {},
    setBootError: () => {}, setHasBiometricLock: () => {}, setIsBiometricActive: () => {},
    setStatus: value => { calls.push(value); }, ApiError: MockApiError,
  });
  assert.equal((await run()).success, true);
  assert.deepEqual(calls, ['public-login', 'persist', 'getMe', 'authenticated']);
});

test('cancelar opt-in revoga B recém-criada e mantém sessão ativa', async () => {
  const factory = extractCallbackFromSessionContext('enableBiometricsOnCurrentSession');
  const calls = [];
  const run = factory({
    getSessionEpoch: () => 8,
    createBiometricSession: async () => ({ refresh_token: 'new-B', session_id: 'B', refresh_expires_at: '2099-01-01T00:00:00Z' }),
    enableBiometricSession: async (credential, epoch) => { assert.equal(credential.refresh_token, 'new-B'); assert.equal(epoch, 8); return { success: false, canceled: true }; },
    revokeBiometricSession: async id => { calls.push(id); }, setHasBiometricLock: () => {}, setIsBiometricActive: () => {},
  });
  assert.equal((await run()).canceled, true);
  assert.deepEqual(calls, ['B']);
});

test('migração legada desbloqueia uma vez, usa refresh normal e registra B independente', async () => {
  const calls = [];
  const run = extractCallbackFromSessionContext('unlockWithBiometrics')({
    getSessionEpoch: () => 1,
    unlockBiometricSession: async () => ({ success: true, refreshToken: 'legacy-A', legacy: true }),
    refreshSession: async () => { calls.push('refresh-A'); },
    enableBiometricsOnCurrentSession: async () => { calls.push('create-B'); return { success: true }; },
    loginWithBiometrics: async () => { assert.fail('legado não é B'); },
    getBiometricSessionId: async () => 'new-B',
    getMe: async () => ({ id: 'owner', email: 'owner@example.test' }), loadUserWorkspace: async () => {},
    setUser: () => {}, setPrefilledLoginEmail: () => {}, setBootError: () => {},
    setHasBiometricLock: () => {}, setIsBiometricActive: () => {}, setStatus: value => { calls.push(value); },
    ApiError: MockApiError,
  });
  assert.equal((await run()).success, true);
  assert.deepEqual(calls, ['refresh-A', 'create-B', 'authenticated']);
});

for (const stage of ['cancel', 'network', 'unauthorized', 'getMe-network', 'stale']) {
  test(`relogin biométrico ${stage}: não publica acesso e preserva B salvo rejeição terminal`, async () => {
    let epoch = 1;
    let cleared = 0;
    let activeCleared = 0;
    let authenticated = false;
    let protectedCalls = 0;
    const run = extractCallbackFromSessionContext('unlockWithBiometrics')({
      getSessionEpoch: () => epoch,
      unlockBiometricSession: async () => stage === 'cancel'
        ? { success: false, canceled: true, invalidated: false, error: 'cancel' }
        : { success: true, refreshToken: 'B' },
      loginWithBiometrics: async () => {
        if (stage === 'network') throw new Error('offline');
        if (stage === 'unauthorized') throw new MockApiError({ kind: 'unauthorized', status: 401 });
        if (stage === 'stale') epoch++;
        return { biometric: 'B2', session: 'C' };
      },
      saveBiometricLoginAtomically: async () => {},
      getMe: async () => { protectedCalls++; throw new Error('offline getMe'); },
      clearActiveSession: async expected => { assert.equal(expected, epoch); epoch++; activeCleared++; },
      clearStoredTokens: async () => { cleared++; epoch++; },
      getBiometricSessionId: async () => 'B', clearInMemoryUserData: () => {},
      setHasBiometricLock: () => {}, setIsBiometricActive: () => {},
      setStatus: value => { authenticated ||= value === 'authenticated'; }, ApiError: MockApiError,
    });
    assert.equal((await run()).success, false);
    assert.equal(authenticated, false);
    assert.equal(cleared, stage === 'unauthorized' ? 1 : 0);
    assert.equal(activeCleared, stage === 'getMe-network' ? 1 : 0);
    assert.equal(protectedCalls, stage === 'getMe-network' ? 1 : 0);
  });
}

test('desativação revoga B por id antes da limpeza e não altera sessão ativa', async () => {
  const calls = [];
  const run = extractCallbackFromSessionContext('disableBiometricsOnCurrentSession')({
    getSessionEpoch: () => 3, getBiometricSessionId: async () => 'B-id',
    revokeBiometricSession: async id => { calls.push(`revoke:${id}`); },
    disableBiometricSession: async epoch => { assert.equal(epoch, 3); calls.push('remove-B'); },
    setHasBiometricLock: value => { assert.equal(value, false); },
    setIsBiometricActive: value => { assert.equal(value, false); },
  });
  await run();
  assert.deepEqual(calls, ['revoke:B-id', 'remove-B']);
});

test('401 biométrico antigo não limpa UI de novo login durante remoção de credenciais', async () => {
  let epoch = 1;
  let clearedUi = false;
  const run = extractCallbackFromSessionContext('unlockWithBiometrics')({
    getSessionEpoch: () => epoch,
    unlockBiometricSession: async () => ({ success: true, refreshToken: 'B' }),
    loginWithBiometrics: async () => { throw new MockApiError({ kind: 'unauthorized', status: 401 }); },
    clearStoredTokens: async () => { epoch += 2; },
    clearInMemoryUserData: () => { clearedUi = true; },
    setHasBiometricLock: () => {}, setIsBiometricActive: () => {}, setStatus: () => {}, ApiError: MockApiError,
  });
  assert.equal((await run()).success, false);
  assert.equal(clearedUi, false);
});

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

  let suggestionOpen = true;
  let suggestionBusy = true;
  const signOut = signOutFactory({
    logoutSession: async () => {},
    getSessionEpoch: () => epoch,
    clearStoredTokens: async () => { epoch += 1; },
    clearInMemoryUserData: () => {},
    setHasBiometricLock: (v) => { hasBiometricLock = v; },
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    setStatus: (s) => { status = s; },
    showToast: () => {},
    biometricSuggestionBusyRef: { current: true },
    setBiometricSuggestionBusy: (v) => { suggestionBusy = v; },
    setBiometricSuggestionOpen: (v) => { suggestionOpen = v; },
  });

  await signOut();
  assert.equal(hasBiometricLock, false, 'hasBiometricLock deve resetar para false no logout');
  assert.equal(isBiometricActive, false, 'isBiometricActive deve resetar para false no logout');
  assert.equal(status, 'unauthenticated');

  epoch = 5;
  // Teste handlePasswordChanged
  hasBiometricLock = true;
  isBiometricActive = true;
  status = 'authenticated';

  suggestionOpen = true;
  suggestionBusy = true;
  const handlePasswordChanged = passwordChangeFactory({
    getSessionEpoch: () => epoch,
    activeChallengeRef: { current: null },
    clearStoredTokens: async () => { epoch += 1; },
    clearInMemoryUserData: () => {},
    setHasBiometricLock: (v) => { hasBiometricLock = v; },
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    setStatus: (s) => { status = s; },
    biometricSuggestionBusyRef: { current: true },
    setBiometricSuggestionBusy: (v) => { suggestionBusy = v; },
    setBiometricSuggestionOpen: (v) => { suggestionOpen = v; },
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
  let registeredPayload;
  const signUpAndSignIn = signUpFactory({
    registerUser: async payload => { registeredPayload = payload; return { id: 'usr-new' }; },
    getSessionEpoch: () => 0,
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
    verificationId: 'proof-id',
    code: '012345',
  });

  assert.equal(res.registeredOnly, false);
  assert.equal(registeredPayload.verificationId, 'proof-id');
  assert.equal(registeredPayload.code, '012345');
  assert.equal(passedOptions, undefined, 'Cadastro nunca deve passar opt-in biométrico para o signIn');
});

test('signUpAndSignIn does not start login after the session changes during registration', async () => {
  let release, epoch = 0, logins = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const signUp = extractCallbackFromSessionContext('signUpAndSignIn')({
    registerUser: () => gate,
    getSessionEpoch: () => epoch,
    signIn: async () => { logins++; },
    ApiError: MockApiError,
    setPrefilledLoginEmail: () => assert.fail('Must not update a different session'),
  });
  const result = signUp({ name: 'User', email: 'user@example.test', password: 'password123', verificationId: 'proof', code: '123456' })
    .then(value => ({ value }), error => ({ error }));
  epoch++; release();
  assert.ok((await result).error, 'Reject completion belonging to an old session');
  assert.equal(logins, 0);
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


test('signIn real AST sem toggle/opt-in em aparelho elegível: sugere biometria por popup após login bem-sucedido', async () => {
  const signInFactory = extractCallbackFromSessionContext('signIn');

  let currentEpoch = 1;
  let status = 'unauthenticated';
  let isBiometricActive = false;
  let suggestionOpened = false;

  const mockDeviceInfo = {
    isSupported: true,
    isEnrolled: true,
    biometricType: 'fingerprint',
    biometricLabel: 'Impressão digital',
    isExpoGoIos: false,
  };

  const signIn = signInFactory({
    bumpSessionEpoch: () => {
      currentEpoch += 1;
      return currentEpoch;
    },
    activeChallengeRef: { current: null },
    loginUser: async () => ({ access_token: 'acc-1', refresh_token: 'ref-1' }),
    getSessionEpoch: () => currentEpoch,
    isTwoFactorChallenge: () => false,
    getMe: async () => ({ id: 'usr-1', email: 'user@example.com' }),
    loadUserWorkspace: async () => {},
    enableBiometricSession: async () => ({ success: true, canceled: false }),
    setHasBiometricLock: () => {},
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    isBiometricActive: false,
    hasBiometricLock: false,
    showToast: () => {},
    setUser: () => {},
    setPrefilledLoginEmail: () => {},
    setBootError: () => {},
    setStatus: (s) => { status = s; },
    biometricDeviceInfo: mockDeviceInfo,
    setBiometricSuggestionOpen: (open) => { suggestionOpened = open; },
  });

  const res = await signIn({ email: 'user@example.com', password: 'password123' });

  assert.equal(res.mfaRequired, false);
  assert.equal(status, 'authenticated');
  assert.equal(isBiometricActive, false, 'Biometria começa inativa até usuário aceitar sugestão');
  assert.equal(suggestionOpened, true, 'Deve sugerir habilitar biometria por popup no aparelho elegível');
});

test('signIn real AST em aparelho NÃO elegível: NÃO sugere biometria por popup', async () => {
  const signInFactory = extractCallbackFromSessionContext('signIn');

  let currentEpoch = 1;
  let status = 'unauthenticated';
  let suggestionOpened = false;

  const mockIneligibleDeviceInfo = {
    isSupported: false,
    isEnrolled: false,
    biometricType: 'biometric',
    biometricLabel: 'Biometria',
    isExpoGoIos: true,
  };

  const signIn = signInFactory({
    bumpSessionEpoch: () => {
      currentEpoch += 1;
      return currentEpoch;
    },
    activeChallengeRef: { current: null },
    loginUser: async () => ({ access_token: 'acc-1', refresh_token: 'ref-1' }),
    getSessionEpoch: () => currentEpoch,
    isTwoFactorChallenge: () => false,
    getMe: async () => ({ id: 'usr-1', email: 'user@example.com' }),
    loadUserWorkspace: async () => {},
    enableBiometricSession: async () => ({ success: true, canceled: false }),
    setHasBiometricLock: () => {},
    setIsBiometricActive: () => {},
    isBiometricActive: false,
    hasBiometricLock: false,
    showToast: () => {},
    setUser: () => {},
    setPrefilledLoginEmail: () => {},
    setBootError: () => {},
    setStatus: (s) => { status = s; },
    biometricDeviceInfo: mockIneligibleDeviceInfo,
    setBiometricSuggestionOpen: (open) => { suggestionOpened = open; },
  });

  const res = await signIn({ email: 'user@example.com', password: 'password123' });

  assert.equal(res.mfaRequired, false);
  assert.equal(status, 'authenticated');
  assert.equal(suggestionOpened, false, 'Aparelho não elegível NÃO deve receber sugestão de biometria');
});

test('completeTwoFactorSignIn real AST em aparelho elegível sem opt-in prévio: sugere biometria após validação 2FA', async () => {
  const completeMfaFactory = extractCallbackFromSessionContext('completeTwoFactorSignIn');

  let currentEpoch = 1;
  let status = 'unauthenticated';
  let isBiometricActive = false;
  let suggestionOpened = false;

  const activeChallengeRef = {
    current: {
      challengeToken: 'valid-challenge-token-12345',
      epoch: 1,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      enableBiometrics: false,
    },
  };

  const mockDeviceInfo = {
    isSupported: true,
    isEnrolled: true,
    biometricType: 'face',
    biometricLabel: 'Face ID',
    isExpoGoIos: false,
  };

  const completeTwoFactorSignIn = completeMfaFactory({
    activeChallengeRef,
    getSessionEpoch: () => currentEpoch,
    ApiError: MockApiError,
    verifyTwoFactor: async () => ({ access_token: 'mfa-acc', refresh_token: 'mfa-ref' }),
    getMe: async () => ({ id: 'usr-mfa', email: 'mfa@example.com' }),
    loadUserWorkspace: async () => {},
    enableBiometricSession: async () => ({ success: true, canceled: false }),
    setHasBiometricLock: () => {},
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    showToast: () => {},
    setUser: () => {},
    setPrefilledLoginEmail: () => {},
    setBootError: () => {},
    setStatus: (s) => { status = s; },
    biometricDeviceInfo: mockDeviceInfo,
    setBiometricSuggestionOpen: (open) => { suggestionOpened = open; },
  });

  await completeTwoFactorSignIn('valid-challenge-token-12345', '654321');

  assert.equal(status, 'authenticated');
  assert.equal(isBiometricActive, false);
  assert.equal(suggestionOpened, true, 'Deve sugerir habilitar biometria após concluir 2FA com sucesso');
});

test('signOut e handlePasswordChanged fecham popup de biometria', async () => {
  const signOutFactory = extractCallbackFromSessionContext('signOut');
  const passwordChangeFactory = extractCallbackFromSessionContext('handlePasswordChanged');

  let logoutEpoch = 0;
  let suggestionOpen = true;
  let suggestionBusy = true;

  const signOut = signOutFactory({
    logoutSession: async () => {},
    getSessionEpoch: () => logoutEpoch,
    clearStoredTokens: async () => { logoutEpoch += 1; },
    clearInMemoryUserData: () => {},
    setHasBiometricLock: () => {},
    setIsBiometricActive: () => {},
    setStatus: () => {},
    showToast: () => {},
    biometricSuggestionBusyRef: { current: true },
    setBiometricSuggestionBusy: (v) => { suggestionBusy = v; },
    setBiometricSuggestionOpen: (v) => { suggestionOpen = v; },
  });

  await signOut();
  assert.equal(suggestionOpen, false, 'signOut deve fechar popup de sugestão biométrica');
  assert.equal(suggestionBusy, false, 'signOut deve resetar estado busy');

  suggestionOpen = true;
  suggestionBusy = true;
  let epoch = 3;
  const handlePasswordChanged = passwordChangeFactory({
    getSessionEpoch: () => epoch,
    activeChallengeRef: { current: null },
    clearStoredTokens: async () => { epoch += 1; },
    clearInMemoryUserData: () => {},
    setHasBiometricLock: () => {},
    setIsBiometricActive: () => {},
    setStatus: () => {},
    biometricSuggestionBusyRef: { current: true },
    setBiometricSuggestionBusy: (v) => { suggestionBusy = v; },
    setBiometricSuggestionOpen: (v) => { suggestionOpen = v; },
  });

  await handlePasswordChanged(3);
  assert.equal(suggestionOpen, false, 'handlePasswordChanged deve fechar popup de sugestão biométrica');
  assert.equal(suggestionBusy, false, 'handlePasswordChanged deve resetar estado busy');
});


test('signIn real AST: atualiza a closure quando a capacidade biométrica termina de carregar', async () => {
  const create = extractCallbackFromSessionContext('signIn', { memoized: true });
  let memo;
  let epoch = 1;
  let suggestionOpened = false;
  let status = 'unauthenticated';

  // Simula somente a memoização; callback e dependências vêm do código de produção.
  const useCallback = (fn, deps) => {
    if (!memo || deps.length !== memo.deps.length || deps.some((value, index) => !Object.is(value, memo.deps[index]))) {
      memo = { fn, deps };
    }
    return memo.fn;
  };
  const stableScope = {
    useCallback,
    bumpSessionEpoch: () => ++epoch,
    activeChallengeRef: { current: null },
    loginUser: async () => ({ access_token: 'test-access', refresh_token: 'test-refresh' }),
    getSessionEpoch: () => epoch,
    isTwoFactorChallenge: () => false,
    getMe: async () => ({ id: 'test-user', email: 'driver@example.test' }),
    loadUserWorkspace: async () => {},
    enableBiometricSession: async () => ({ success: true }),
    setHasBiometricLock: () => {},
    setIsBiometricActive: () => {},
    showToast: () => {},
    setUser: () => {},
    setPrefilledLoginEmail: () => {},
    setBootError: () => {},
    setStatus: (next) => { status = next; },
    setBiometricSuggestionOpen: (next) => { suggestionOpened = next; },
    isBiometricActive: false,
    hasBiometricLock: false,
  };
  const render = (info) => create({ ...stableScope, biometricDeviceInfo: info });
  const initial = render(null);
  assert.equal(render(null), initial, 'Sem mudança, o callback deve continuar memoizado');

  const info = await Promise.resolve({ isSupported: true, biometricType: 'fingerprint' });
  const ready = render(info);
  assert.notEqual(ready, initial, 'A capacidade carregada precisa atualizar a closure real');

  await ready({ email: 'driver@example.test', password: 'test-password' });
  assert.equal(status, 'authenticated');
  assert.equal(suggestionOpened, true, 'O login real deve sugerir biometria após o carregamento');
});

test('signIn real AST em aparelho com biometria já ativa: preserva proteção biométrica e NÃO sugere popup', async () => {
  const signInFactory = extractCallbackFromSessionContext('signIn');

  let currentEpoch = 1;
  let status = 'unauthenticated';
  let isBiometricActive = true;
  let hasBiometricLock = false;
  let suggestionOpened = false;
  let enableBiometricCalled = false;
  let capturedToast = null;

  const mockDeviceInfo = {
    isSupported: true,
    isEnrolled: true,
    biometricType: 'fingerprint',
    biometricLabel: 'Impressão digital',
    isExpoGoIos: false,
  };

  const signIn = signInFactory({
    bumpSessionEpoch: () => {
      currentEpoch += 1;
      return currentEpoch;
    },
    activeChallengeRef: { current: null },
    loginUser: async () => ({ access_token: 'acc-1', refresh_token: 'ref-1' }),
    getSessionEpoch: () => currentEpoch,
    isTwoFactorChallenge: () => false,
    getMe: async () => ({ id: 'usr-1', email: 'user@example.com' }),
    loadUserWorkspace: async () => {},
    enableBiometricSession: async (epoch) => {
      enableBiometricCalled = true;
      return { success: true, canceled: false };
    },
    setHasBiometricLock: (v) => { hasBiometricLock = v; },
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    isBiometricActive: true,
    hasBiometricLock: false,
    showToast: (t) => { capturedToast = t; },
    setUser: () => {},
    setPrefilledLoginEmail: () => {},
    setBootError: () => {},
    setStatus: (s) => { status = s; },
    biometricDeviceInfo: mockDeviceInfo,
    setBiometricSuggestionOpen: (open) => { suggestionOpened = open; },
  });

  const res = await signIn({ email: 'user@example.com', password: 'password123' });

  assert.equal(res.mfaRequired, false);
  assert.equal(status, 'authenticated');
  assert.equal(enableBiometricCalled, true, 'Deve renovar proteção biométrica usando fluxo nativo');
  assert.equal(isBiometricActive, true, 'Biometria deve continuar ativa');
  assert.equal(suggestionOpened, false, 'NÃO deve exibir popup de sugestão se biometria já estava habilitada');
  assert.match(capturedToast?.subtitle, /Biometria ativada com sucesso/);
});

test('signIn real AST em aparelho com biometria já ativa quando usuário cancela confirmação: mantém login sem falso toggle e sem popup', async () => {
  const signInFactory = extractCallbackFromSessionContext('signIn');

  let currentEpoch = 1;
  let status = 'unauthenticated';
  let isBiometricActive = true;
  let hasBiometricLock = false;
  let suggestionOpened = false;
  let capturedToast = null;

  const mockDeviceInfo = {
    isSupported: true,
    isEnrolled: true,
    biometricType: 'face',
    biometricLabel: 'Face ID',
    isExpoGoIos: false,
  };

  const signIn = signInFactory({
    bumpSessionEpoch: () => {
      currentEpoch += 1;
      return currentEpoch;
    },
    activeChallengeRef: { current: null },
    loginUser: async () => ({ access_token: 'acc-1', refresh_token: 'ref-1' }),
    getSessionEpoch: () => currentEpoch,
    isTwoFactorChallenge: () => false,
    getMe: async () => ({ id: 'usr-1', email: 'user@example.com' }),
    loadUserWorkspace: async () => {},
    enableBiometricSession: async () => ({ success: false, canceled: true }),
    setHasBiometricLock: (v) => { hasBiometricLock = v; },
    setIsBiometricActive: (v) => { isBiometricActive = v; },
    isBiometricActive: true,
    hasBiometricLock: false,
    showToast: (t) => { capturedToast = t; },
    setUser: () => {},
    setPrefilledLoginEmail: () => {},
    setBootError: () => {},
    setStatus: (s) => { status = s; },
    biometricDeviceInfo: mockDeviceInfo,
    setBiometricSuggestionOpen: (open) => { suggestionOpened = open; },
  });

  const res = await signIn({ email: 'user@example.com', password: 'password123' });

  assert.equal(res.mfaRequired, false);
  assert.equal(status, 'authenticated', 'Login por senha deve prosseguir mesmo cancelando proteção biométrica');
  assert.equal(isBiometricActive, false, 'Toggle biométrico não deve permanecer ativado falsamente');
  assert.equal(suggestionOpened, false, 'NÃO deve sugerir popup ao cancelar');
  assert.equal(capturedToast?.tone, 'info');
  assert.equal(capturedToast?.subtitle, 'A biometria não foi ativada.');
});

test('acceptBiometricSuggestion real AST: impede reentrada e ignora resposta/toasts se epoch mudar durante await', async () => {
  const acceptFactory = extractCallbackFromSessionContext('acceptBiometricSuggestion');

  let currentEpoch = 1;
  let suggestionBusy = false;
  let suggestionOpen = true;
  let toasts = [];
  let enableCalls = 0;
  const busyRef = { current: false };

  let resolveEnable;
  const enablePromise = new Promise((res) => {
    resolveEnable = res;
  });

  const accept = acceptFactory({
    biometricSuggestionBusyRef: busyRef,
    setBiometricSuggestionBusy: (v) => { suggestionBusy = v; },
    getSessionEpoch: () => currentEpoch,
    enableBiometricsOnCurrentSession: async () => {
      enableCalls++;
      return await enablePromise;
    },
    setBiometricSuggestionOpen: (v) => { suggestionOpen = v; },
    showToast: (t) => { toasts.push(t); },
    biometricDeviceInfo: { biometricLabel: 'Touch ID' },
  });

  const firstCall = accept();
  assert.equal(busyRef.current, true, 'busyRef deve ser marcado como true imediatamente');
  assert.equal(suggestionBusy, true, 'setBiometricSuggestionBusy deve ser chamado com true');

  const secondCall = accept();
  assert.equal(enableCalls, 1, 'Reentrada deve ser ignorada imediatamente sem duplicar chamada');

  currentEpoch = 2; // Simula mudança de conta / época

  resolveEnable({ success: true, canceled: false });
  await firstCall;
  await secondCall;

  assert.equal(toasts.length, 0, 'Nenhum toast deve ser emitido para época obsoleta');
});

