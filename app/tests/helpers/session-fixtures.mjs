import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nodeCrypto from 'node:crypto';
import ts from 'typescript';

function createExpoCryptoMock({
  onBeforeEncrypt = async () => {},
  onBeforeDecrypt = async () => {},
} = {}) {
  class AESEncryptionKey {
    constructor(buffer) {
      this._buffer = buffer;
    }
    static async generate(size = 256) {
      return new AESEncryptionKey(nodeCrypto.randomBytes(size / 8));
    }
    static async import(input, encoding) {
      const buf = typeof input === 'string' ? Buffer.from(input, encoding) : Buffer.from(input);
      return new AESEncryptionKey(buf);
    }
    async bytes() {
      return new Uint8Array(this._buffer);
    }
    async encoded(encoding) {
      return this._buffer.toString(encoding);
    }
  }

  class AESSealedData {
    constructor(combinedBuffer) {
      this._buffer = combinedBuffer;
    }
    static fromCombined(combined) {
      const buf = typeof combined === 'string' ? Buffer.from(combined, 'base64') : Buffer.from(combined);
      return new AESSealedData(buf);
    }
    async combined(encoding = 'base64') {
      return this._buffer.toString(encoding);
    }
  }

  async function aesEncryptAsync(plaintext, key) {
    await onBeforeEncrypt();
    const iv = nodeCrypto.randomBytes(12);
    const keyBuf = key._buffer;
    const plainBuf = typeof plaintext === 'string'
      ? Buffer.from(plaintext, 'base64')
      : Buffer.from(plaintext);
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', keyBuf, iv);
    const ciphertext = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
    const tag = cipher.getAuthTag();
    const combined = Buffer.concat([iv, ciphertext, tag]);
    return new AESSealedData(combined);
  }

  async function aesDecryptAsync(sealedData, key, options = {}) {
    await onBeforeDecrypt();
    const combined = sealedData._buffer;
    const iv = combined.subarray(0, 12);
    const tag = combined.subarray(combined.length - 16);
    const ciphertext = combined.subarray(12, combined.length - 16);
    const keyBuf = key._buffer;

    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (options.output === 'base64') {
      return decrypted.toString('base64');
    }
    return new Uint8Array(decrypted);
  }

  return {
    AESEncryptionKey,
    AESSealedData,
    aesEncryptAsync,
    aesDecryptAsync,
  };
}

export function loadStorage(
  setItemAsync = async () => {},
  {
    platform = 'android',
    getItemAsync = async () => null,
    deleteItemAsync = async () => {},
    secureStoreExtra = {},
    expoCryptoExtra = {},
  } = {},
) {
  const source = readFileSync(new URL('../../src/api/tokenStorage.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const dependencies = {
    'expo-secure-store': {
      setItemAsync,
      getItemAsync,
      deleteItemAsync,
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
      canUseBiometricAuthentication: () => true,
      ...secureStoreExtra,
    },
    'expo-crypto': createExpoCryptoMock(expoCryptoExtra),
    'react-native': { Platform: { OS: platform } },
  };

  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Import não autorizado: ${specifier}`);
    return dependencies[specifier];
  }, module, module.exports);
  return module.exports;
}


export function extractCallbackFromSessionContext(callbackName, { memoized = false } = {}) {
  const sourceText = readFileSync(
    new URL('../../src/state/SessionContext.tsx', import.meta.url),
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
  let callbackNode = null;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === callbackName &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.arguments.length > 0
    ) {
      arrowNode = node.initializer.arguments[0];
      callbackNode = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert.ok(
    arrowNode,
    `VariableDeclaration ${callbackName} com useCallback(arrow) não encontrada no AST de SessionContext.tsx`,
  );

  const arrowCode = (memoized ? callbackNode : arrowNode).getText(sourceFile);
  const transpiled = ts.transpileModule(`exports.run = ${arrowCode};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  return function createCallbackInstance(scope) {
    scope = {
      revokePendingBiometricSessions: async () => {},
      getSessionEpoch: () => 0,
      getBiometricSessionId: async () => null,
      clearActiveSession: scope.clearStoredTokens,
      enableBiometricsOnCurrentSession: scope.enableBiometricSession,
      biometricUnlockBusyRef: { current: false },
      ...scope,
    };
    const module = { exports: {} };
    const keys = Object.keys(scope);
    const values = Object.values(scope);
    const fn = new Function('require', 'module', 'exports', ...keys, transpiled.outputText);
    fn(() => {}, module, module.exports, ...values);
    return module.exports.run;
  };
}

