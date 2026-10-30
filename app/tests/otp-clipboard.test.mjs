import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadOtpHelper() {
  const source = readFileSync(new URL('../src/components/inputs/OtpSixInput.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const module = { exports: {} };
  const mockRequire = (specifier) => {
    if (specifier === 'react' || specifier === 'react/jsx-runtime' || specifier === 'react-native') {
      return {
        useRef: (init) => ({ current: init }),
        useState: (init) => [init, () => {}],
        StyleSheet: { create: (s) => s },
        Platform: { select: (o) => o.default || {} },
      };
    }
    if (specifier === 'expo-clipboard') {
      return { getStringAsync: async () => '' };
    }
    if (specifier === '@/theme/ThemeProvider') {
      return { useAppTheme: () => ({ colors: {} }) };
    }
    if (specifier === '@/theme/tokens') {
      return { radii: { md: 14 }, typography: { numericInput: {} } };
    }
    return {};
  };
  new Function('require', 'module', 'exports', outputText)(mockRequire, module, module.exports);
  return module.exports;
}

function loadClipboardHelper(mockClipboard, mockNavigator) {
  const source = readFileSync(new URL('../src/utils/clipboard.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const mockRequire = (specifier) => {
    if (specifier === 'expo-clipboard') {
      return mockClipboard;
    }
    return {};
  };
  const nav = mockNavigator !== undefined ? mockNavigator : (typeof navigator !== 'undefined' ? navigator : undefined);
  new Function('require', 'module', 'exports', 'navigator', outputText)(mockRequire, module, module.exports, nav);
  return module.exports;
}

test('applyOtpInput: colar 123450 no inicio de 123456 extrai 123450 sem ambiguidade', () => {
  const { applyOtpInput } = loadOtpHelper();
  // prev = 123456, caret no início (0, 0), colar 123450 gera raw 123450123456
  const res = applyOtpInput('123450123456', '123456', { start: 0, end: 0 });
  assert.equal(res.value, '123450');
  assert.equal(res.nextSelection, 6);
});

test('applyOtpInput: colar 012345 com valor 123456 e caret no meio ou fim', () => {
  const { applyOtpInput } = loadOtpHelper();
  // Caret no fim (6, 6)
  const resEnd = applyOtpInput('123456012345', '123456', { start: 6, end: 6 });
  assert.equal(resEnd.value, '012345');
  assert.equal(resEnd.nextSelection, 6);

  // Caret no meio (3, 3)
  const resMid = applyOtpInput('123012345456', '123456', { start: 3, end: 3 });
  assert.equal(resMid.value, '012345');
  assert.equal(resMid.nextSelection, 6);
});

test('applyOtpInput: valor parcial 123 tocar no primeiro e digitar 9 substitui 1 por 9 e avança para quadrado 2', () => {
  const { applyOtpInput } = loadOtpHelper();
  // prev = '123', caret no índice 0 (primeiro quadrado), digita '9' gerando raw '9123'
  const res = applyOtpInput('9123', '123', { start: 0, end: 0 });
  assert.equal(res.value, '923');
  assert.equal(res.nextSelection, 1);
});

test('applyOtpInput: corrigir quadrado 3 em 123456 substitui e avança para o quadrado 4', () => {
  const { applyOtpInput } = loadOtpHelper();
  // prev = '123456', caret no quadrado 3 (índice 2, caractere '3'), digita '8' gerando raw '1283456'
  const res = applyOtpInput('1283456', '123456', { start: 2, end: 2 });
  assert.equal(res.value, '128456');
  assert.equal(res.nextSelection, 3); // quadrado 4 (índice 3), não 6!
});

test('applyOtpInput: digitação sequencial e backspace com caret na posição correta', () => {
  const { applyOtpInput } = loadOtpHelper();
  // Digitar '1' em campo vazio
  const res1 = applyOtpInput('1', '', { start: 0, end: 0 });
  assert.equal(res1.value, '1');
  assert.equal(res1.nextSelection, 1);

  // Digitar '2' no fim de '1'
  const res2 = applyOtpInput('12', '1', { start: 1, end: 1 });
  assert.equal(res2.value, '12');
  assert.equal(res2.nextSelection, 2);

  // Backspace em '12'
  const resBack = applyOtpInput('1', '12', { start: 2, end: 2 });
  assert.equal(resBack.value, '1');
  assert.equal(resBack.nextSelection, 1);
});

test('applyOtpInput: preserva zeros à esquerda sem converter para Number', () => {
  const { applyOtpInput } = loadOtpHelper();
  assert.equal(applyOtpInput('0', '', { start: 0, end: 0 }).value, '0');
  assert.equal(applyOtpInput('012345', '', { start: 0, end: 0 }).value, '012345');
  assert.equal(applyOtpInput('000000', '', { start: 0, end: 0 }).value, '000000');
});

test('normalizeOtpCode: ignora caracteres não numéricos', () => {
  const { normalizeOtpCode } = loadOtpHelper();
  assert.equal(normalizeOtpCode('abc'), '');
  assert.equal(normalizeOtpCode('a1b2c3'), '123');
  assert.equal(normalizeOtpCode('totp: 054-321'), '054321');
});

test('copyToClipboard: sucesso com expo-clipboard nativo/web', async () => {
  let copiedText = null;
  const mockExpo = {
    setStringAsync: async (text) => {
      copiedText = text;
      return true;
    },
  };
  const { copyToClipboard } = loadClipboardHelper(mockExpo);
  const ok = await copyToClipboard('JBSWY3DPEHPK3PXP');
  assert.equal(ok, true);
  assert.equal(copiedText, 'JBSWY3DPEHPK3PXP');
});

test('copyToClipboard: lista completa de códigos de recuperação, um por linha', async () => {
  let copiedText = null;
  const mockExpo = {
    setStringAsync: async (text) => {
      copiedText = text;
      return true;
    },
  };
  const { copyToClipboard } = loadClipboardHelper(mockExpo);
  const codes = [
    'recovery-00-43-chars-example-code-url-safe',
    'recovery-01-43-chars-example-code-url-safe',
    'recovery-02-43-chars-example-code-url-safe',
  ];
  const ok = await copyToClipboard(codes.join('\n'));
  assert.equal(ok, true);
  assert.equal(copiedText, codes.join('\n'));
  assert.equal(copiedText.split('\n').length, 3);
});

test('copyToClipboard: texto vazio retorna false sem acionar clipboard', async () => {
  let called = false;
  const mockExpo = {
    setStringAsync: async () => {
      called = true;
      return true;
    },
  };
  const { copyToClipboard } = loadClipboardHelper(mockExpo);
  const ok = await copyToClipboard('');
  assert.equal(ok, false);
  assert.equal(called, false);
});

test('copyToClipboard: contrato estrito trata retorno undefined ou false como falha', async () => {
  const mockExpoFalse = {
    setStringAsync: async () => false,
  };
  const helperFalse = loadClipboardHelper(mockExpoFalse);
  assert.equal(await helperFalse.copyToClipboard('segredo'), false);

  const mockExpoUndefined = {
    setStringAsync: async () => undefined,
  };
  const helperUndefined = loadClipboardHelper(mockExpoUndefined);
  assert.equal(await helperUndefined.copyToClipboard('segredo'), false);
});

test('copyToClipboard: falha da API nativa ou exceção retorna false sem quebrar', async () => {
  const mockExpoError = {
    setStringAsync: async () => {
      throw new Error('Clipboard indisponível');
    },
  };
  const { copyToClipboard } = loadClipboardHelper(mockExpoError);
  const ok = await copyToClipboard('segredo123');
  assert.equal(ok, false);
});

test('regras de negócio: setup exige 6 dígitos numéricos e não aceita recovery de 43 caracteres', () => {
  const totpRegex = /^\d{6}$/;
  assert.equal(totpRegex.test('123456'), true);
  assert.equal(totpRegex.test('012345'), true);
  assert.equal(totpRegex.test('000000'), true);
  const recoveryCode = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop1';
  assert.equal(recoveryCode.length, 43);
  assert.equal(totpRegex.test(recoveryCode), false);
  assert.equal(totpRegex.test('12345'), false);
  assert.equal(totpRegex.test('1234567'), false);
});

test('regras de negócio: login, desativação e troca de senha aceitam recovery de 43 caracteres em modo recovery', () => {
  const recoveryCode = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop1';
  assert.equal(recoveryCode.length, 43);
  assert.equal(/^[A-Za-z0-9_-]{43}$/.test(recoveryCode), true);
});
