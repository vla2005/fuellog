import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function clientFor(env) {
  const source = readFileSync(new URL('../src/api/client.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', outputText)(() => ({}), module, module.exports, { env });
  return module.exports;
}

test('release requires an explicit API instead of falling back to localhost', () => {
  for (const api of [undefined, '', '  ']) {
    assert.throws(() => clientFor({ NODE_ENV: 'production', EXPO_PUBLIC_API_URL: api }).getApiBaseUrl(), /EXPO_PUBLIC_API_URL/);
  }
});

test('release uses the configured API with normalized whitespace and trailing slash', () => {
  const client = clientFor({ NODE_ENV: 'production', EXPO_PUBLIC_API_URL: ' https://api.example.test/api/v1/ ' });
  assert.equal(client.getApiBaseUrl(), 'https://api.example.test/api/v1');
});

test('every production build requires HTTPS, including builds without OTA', () => {
  for (const api of ['http://api.example.test/api/v1', 'http://localhost:8080/api/v1', 'ftp://api.example.test/api/v1', 'not a URL']) {
    assert.throws(() => clientFor({ NODE_ENV: 'production', EXPO_PUBLIC_API_URL: api }).getApiBaseUrl(), /HTTPS/);
  }
});

test('production rejects API URLs containing credentials, query parameters or fragments', () => {
  for (const api of ['https://user:password@api.example.test/api/v1', 'https://api.example.test/api/v1?token=secret', 'https://api.example.test/api/v1#fragment']) {
    assert.throws(() => clientFor({ NODE_ENV: 'production', EXPO_PUBLIC_API_URL: api }).getApiBaseUrl(), /HTTPS/);
  }
});

test('development keeps the existing localhost fallback and explicit LAN configuration', () => {
  assert.equal(clientFor({ NODE_ENV: 'development' }).getApiBaseUrl(), 'http://localhost:8080/api/v1');
  assert.equal(clientFor({ NODE_ENV: 'development', EXPO_PUBLIC_API_URL: 'http://192.168.1.100:8080/api/v1' }).getApiBaseUrl(), 'http://192.168.1.100:8080/api/v1');
});
