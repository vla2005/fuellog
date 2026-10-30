import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

process.env.EXPO_PUBLIC_API_URL = process.env.FUELLOG_API_URL ?? 'http://127.0.0.1:8080/api/v1';

function loadTransport() {
  let access = 'mock-access-token-xyz';
  let refresh = 'mock-refresh-token-xyz';
  let epoch = 1;
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
    clearStoredTokens: async () => {
      access = null;
      refresh = null;
      epoch += 1;
    },
    bumpSessionEpoch: () => {
      epoch += 1;
      return epoch;
    },
  };
  const modules = { './tokenStorage': storage };
  for (const name of ['types', 'client', 'endpoints']) {
    const source = readFileSync(new URL(`../src/api/${name}.ts`, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', outputText)(
      (specifier) => {
        assert.ok(Object.hasOwn(modules, specifier), `Import não autorizado no loader: ${specifier}`);
        return modules[specifier];
      },
      module,
      module.exports,
    );
    modules[`./${name}`] = module.exports;
  }
  return {
    storage,
    endpoints: modules['./endpoints'],
    client: modules['./client'],
    types: modules['./types'],
  };
}

function extractRealUpdateUserFromSessionContext() {
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
      node.name.getText(sourceFile) === 'updateUser' &&
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
    'VariableDeclaration updateUser com useCallback(arrow) não encontrada no AST de SessionContext.tsx',
  );

  const arrowCode = arrowNode.getText(sourceFile);
  const transpiled = ts.transpileModule(`exports.run = ${arrowCode};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  return function createUpdateUserInstance({ getSessionEpoch, status, user, setUser }) {
    const module = { exports: {} };
    const fn = new Function(
      'require',
      'module',
      'exports',
      'getSessionEpoch',
      'status',
      'user',
      'setUser',
      transpiled.outputText,
    );
    fn(
      () => {},
      module,
      module.exports,
      getSessionEpoch,
      status,
      user,
      setUser,
    );
    return module.exports.run;
  };
}

test('updateMe: envia PATCH /me autenticado com payload e retorna MeResponse 200', async () => {
  const { endpoints } = loadTransport();
  const realFetch = globalThis.fetch;
  let capturedRequest = null;

  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/me') && init?.method === 'PATCH') {
        capturedRequest = {
          url: String(url),
          method: init.method,
          headers: init.headers,
          body: JSON.parse(init.body),
        };
        return new Response(
          JSON.stringify({
            id: 'usr-123',
            name: 'Motorista Atualizado',
            email: 'motorista@exemplo.com',
            preferredTimezone: 'America/Sao_Paulo',
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
          },
        );
      }
      return realFetch(url, init);
    };

    const res = await endpoints.updateMe({
      name: 'Motorista Atualizado',
      email: 'motorista@exemplo.com',
    });

    assert.ok(capturedRequest, 'Requisição PATCH /me foi interceptada');
    assert.equal(capturedRequest.method, 'PATCH');
    assert.equal(capturedRequest.body.name, 'Motorista Atualizado');
    assert.equal(capturedRequest.body.email, 'motorista@exemplo.com');
    assert.equal(res.id, 'usr-123');
    assert.equal(res.name, 'Motorista Atualizado');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('updateMe: lança ApiError 409 em conflito de e-mail (ACCOUNT_CONFLICT)', async () => {
  const { endpoints, types } = loadTransport();
  const realFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/me') && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            type: 'https://fuellog.app/errors/account-conflict',
            title: 'Conflito de conta',
            status: 409,
            detail: 'O e-mail informado já está em uso por outro usuário.',
            code: 'ACCOUNT_CONFLICT',
            fieldErrors: {
              email: 'Este e-mail já está cadastrado em outra conta.',
            },
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        );
      }
      return realFetch(url, init);
    };

    await assert.rejects(
      async () => {
        await endpoints.updateMe({
          name: 'Nome Válido',
          email: 'conflito@exemplo.com',
          currentPassword: 'SenhaValida123',
        });
      },
      (err) => {
        assert.ok(err instanceof types.ApiError);
        assert.equal(err.status, 409);
        assert.equal(err.problem?.code, 'ACCOUNT_CONFLICT');
        assert.equal(
          err.problem?.fieldErrors?.email,
          'Este e-mail já está cadastrado em outra conta.',
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('updateMe: lança ApiError 422 em validação de campos (VALIDATION_ERROR)', async () => {
  const { endpoints, types } = loadTransport();
  const realFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/me') && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            type: 'https://fuellog.app/errors/validation-error',
            title: 'Erro de validação',
            status: 422,
            detail: 'Campos inválidos no cadastro.',
            code: 'VALIDATION_ERROR',
            fieldErrors: {
              currentPassword: 'Senha atual incorreta.',
              code: 'Código de autenticação inválido.',
            },
          }),
          {
            status: 422,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        );
      }
      return realFetch(url, init);
    };

    await assert.rejects(
      async () => {
        await endpoints.updateMe({
          name: 'Nome Válido',
          email: 'novo@exemplo.com',
          currentPassword: 'SenhaIncorreta',
          secondFactorCode: '123456',
        });
      },
      (err) => {
        assert.ok(err instanceof types.ApiError);
        assert.equal(err.status, 422);
        assert.equal(err.problem?.fieldErrors?.currentPassword, 'Senha atual incorreta.');
        assert.equal(err.problem?.fieldErrors?.code, 'Código de autenticação inválido.');
        return true;
      },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('updateUser guard real de SessionContext.tsx (AST): valida mesmo id/epoch atual e rejeita epoch antigo, id divergente e não autenticado', () => {
  const createInstance = extractRealUpdateUserFromSessionContext();

  let currentEpoch = 1;
  let currentUser = {
    id: 'usr-123',
    name: 'Nome Antigo',
    email: 'antigo@exemplo.com',
    preferredTimezone: 'America/Sao_Paulo',
  };
  let currentStatus = 'authenticated';
  let setUserCalledWith = null;
  const setUser = (u) => {
    setUserCalledWith = u;
    currentUser = u;
  };

  const updateUser = createInstance({
    getSessionEpoch: () => currentEpoch,
    status: currentStatus,
    user: currentUser,
    setUser,
  });

  // Caso 1: mesmo id e epoch atual -> true e chama setUser
  const validUpdate = {
    id: 'usr-123',
    name: 'Nome Novo',
    email: 'antigo@exemplo.com',
    preferredTimezone: 'America/Sao_Paulo',
  };
  const ok1 = updateUser(validUpdate, 1);
  assert.equal(ok1, true, 'Deve aceitar atualização com epoch atual e mesmo id');
  assert.deepEqual(setUserCalledWith, validUpdate, 'setUser deve ser chamado com os novos dados');
  assert.equal(currentUser.name, 'Nome Novo');

  // Caso 2: epoch antigo -> false e não chama setUser
  currentEpoch = 2;
  setUserCalledWith = null;
  const staleEpochUpdate = {
    id: 'usr-123',
    name: 'Nome Tarde Demais',
    email: 'antigo@exemplo.com',
    preferredTimezone: 'America/Sao_Paulo',
  };
  const ok2 = updateUser(staleEpochUpdate, 1);
  assert.equal(ok2, false, 'Deve rejeitar resposta atrasada com expectedEpoch desatualizado');
  assert.equal(setUserCalledWith, null, 'setUser não deve ser chamado em rejeição de epoch');
  assert.equal(currentUser.name, 'Nome Novo', 'Nome permanece intacto');

  // Caso 3: id divergente (outra identidade) -> false e não chama setUser
  setUserCalledWith = null;
  const differentUserUpdate = {
    id: 'usr-456-other',
    name: 'Outro Usuario',
    email: 'outro@exemplo.com',
    preferredTimezone: 'America/Sao_Paulo',
  };
  const ok3 = updateUser(differentUserUpdate, 2);
  assert.equal(ok3, false, 'Deve rejeitar atualização se id divergente da sessão');
  assert.equal(setUserCalledWith, null, 'setUser não deve ser chamado para id divergente');
  assert.equal(currentUser.name, 'Nome Novo');

  // Caso 4: não autenticado -> false e não chama setUser
  setUserCalledWith = null;
  const unauthUpdateUser = createInstance({
    getSessionEpoch: () => 2,
    status: 'unauthenticated',
    user: currentUser,
    setUser,
  });
  const ok4 = unauthUpdateUser(validUpdate, 2);
  assert.equal(ok4, false, 'Deve rejeitar atualização quando status não for authenticated');
  assert.equal(setUserCalledWith, null, 'setUser não deve ser chamado se não autenticado');
});
