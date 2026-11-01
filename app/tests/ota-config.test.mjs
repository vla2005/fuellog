import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exclusiveEnv } from '../scripts/exclusive.mjs';
import { metadataValue, verifyPersonalBundle, verifyRuntime } from '../scripts/personal-update.mjs';

const require = createRequire(import.meta.url);
const base = require('../app.json').expo;
const keys = ['FUELLOG_OTA_URL', 'FUELLOG_OTA_CHANNEL', 'FUELLOG_OTA_RUNTIME_POLICY', 'FUELLOG_EAS_PROJECT_ID', 'EXPO_PUBLIC_API_URL'];
const personal = {
  FUELLOG_OTA_URL: 'https://updates.example.test/manifest',
  FUELLOG_OTA_CHANNEL: 'personal-test',
  FUELLOG_OTA_RUNTIME_POLICY: 'fingerprint',
  EXPO_PUBLIC_API_URL: 'https://api.example.test/api/v1',
};

function configure(env = {}, config = base) {
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    return require('../app.config.js')({ config });
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('development keeps base config and disables OTA without personal variables', () => {
  const result = configure({ EXPO_PUBLIC_API_URL: 'http://192.168.1.100:8080/api/v1' });
  assert.deepEqual(result, { ...base, updates: { enabled: false } });
  assert.equal(result.runtimeVersion, undefined);
});

test('complete OTA config preserves plugins and enables native next-launch updates', () => {
  const result = configure(personal);
  assert.deepEqual(result.plugins, base.plugins);
  assert.deepEqual(result.android, base.android);
  assert.deepEqual(result.runtimeVersion, { policy: 'fingerprint' });
  assert.deepEqual(result.updates, {
    enabled: true,
    url: personal.FUELLOG_OTA_URL,
    requestHeaders: { 'expo-channel-name': 'personal-test' },
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    useEmbeddedUpdate: true,
  });
  assert.equal(result.extra?.eas, undefined);
});

test('partial OTA input and incompatible runtime fail instead of silently disabling OTA', () => {
  for (const key of ['FUELLOG_OTA_URL', 'FUELLOG_OTA_CHANNEL', 'FUELLOG_OTA_RUNTIME_POLICY', 'EXPO_PUBLIC_API_URL']) {
    assert.throws(() => configure({ ...personal, [key]: undefined }), /OTA:/);
  }
  assert.throws(() => configure({ ...personal, FUELLOG_OTA_RUNTIME_POLICY: 'appVersion' }), /fingerprint/);
});

test('personal OTA rejects insecure URLs, local API and shared channels', () => {
  for (const url of ['http://updates.example.test', 'broken', 'https://user:password@updates.example.test']) {
    assert.throws(() => configure({ ...personal, FUELLOG_OTA_URL: url }), /OTA:/);
  }
  for (const url of ['http://localhost:8080/api/v1', 'https://localhost/api/v1', 'https://192.168.1.100/api/v1', 'https://10.0.2.2/api/v1', 'https://server.local/api/v1', 'https://[::1]/api/v1', 'https://api.example.test/']) {
    assert.throws(() => configure({ ...personal, EXPO_PUBLIC_API_URL: url }), /OTA:/);
  }
  for (const channel of ['production', 'preview', 'development', 'personal', 'personal-test other']) {
    assert.throws(() => configure({ ...personal, FUELLOG_OTA_CHANNEL: channel }), /OTA:/);
  }
});

test('EAS project is optional, validated, merged and tied to its update endpoint', () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  const config = { ...base, extra: { retained: true, eas: { retained: true } } };
  const result = configure({ ...personal, FUELLOG_EAS_PROJECT_ID: id, FUELLOG_OTA_URL: `https://u.expo.dev/${id}` }, config);
  assert.deepEqual(result.extra, { retained: true, eas: { retained: true, projectId: id } });
  assert.throws(() => configure({ ...personal, FUELLOG_EAS_PROJECT_ID: 'invalid' }), /OTA:/);
  assert.throws(() => configure({ ...personal, FUELLOG_OTA_URL: `https://u.expo.dev/${id}` }), /OTA:/);
  assert.throws(() => configure({ ...personal, FUELLOG_EAS_PROJECT_ID: id }), /OTA:/);
});

test('exclusive file overrides inherited LAN and refuses incomplete files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fuellog-ota-'));
  const file = join(directory, '.env.exclusive.local');
  const parent = {
    PATH: 'retained', EXPO_PUBLIC_API_URL: 'http://192.168.1.100:8080/api/v1',
    EXPO_PUBLIC_TERMS_URL: 'http://localhost/terms', FUELLOG_EAS_PROJECT_ID: 'inherited-project',
    EXPO_UPDATES_FINGERPRINT_OVERRIDE: 'old-fingerprint', EXPO_UPDATES_WORKFLOW_OVERRIDE: 'generic',
  };
  try {
    writeFileSync(file, Object.entries(personal).map(([key, value]) => `${key}=${value}`).join('\n'));
    const env = exclusiveEnv(file, parent);
    assert.equal(env.EXPO_PUBLIC_API_URL, personal.EXPO_PUBLIC_API_URL);
    assert.equal(env.EXPO_NO_DOTENV, '1');
    assert.equal(env.EXPO_PUBLIC_TERMS_URL, undefined);
    assert.equal(env.FUELLOG_EAS_PROJECT_ID, undefined);
    assert.equal(env.EXPO_UPDATES_FINGERPRINT_OVERRIDE, undefined);
    assert.equal(env.EXPO_UPDATES_WORKFLOW_OVERRIDE, undefined);
    assert.equal(env.PATH, 'retained');
    assert.equal(configure(env).updates.enabled, true);
    for (const key of ['EXPO_PUBLIC_API_URL', 'FUELLOG_OTA_URL', 'FUELLOG_OTA_CHANNEL', 'FUELLOG_OTA_RUNTIME_POLICY']) {
      writeFileSync(file, Object.entries(personal).filter(([name]) => name !== key).map(([name, value]) => `${name}=${value}`).join('\n'));
      assert.throws(() => exclusiveEnv(file, { ...personal, ...parent }), /próprio .env.exclusive.local/);
    }
    assert.equal(parent.EXPO_PUBLIC_API_URL, 'http://192.168.1.100:8080/api/v1');
    writeFileSync(file, Object.entries({ ...personal, EXPO_UPDATES_FINGERPRINT_OVERRIDE: 'forced' }).map(([name, value]) => `${name}=${value}`).join('\n'));
    assert.throws(() => exclusiveEnv(file), /overrides/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('publication verifies embedded API and rejects mixed public or local endpoints', () => {
  const api = personal.EXPO_PUBLIC_API_URL;
  verifyPersonalBundle(Buffer.from(`binary\0${api}otherHermesString`), api);
  for (const other of ['http://localhost:8080/api/v1', 'http://192.168.1.100:8080/api/v1', 'http://10.0.2.2:8080/api/v1', 'https://other.example.test/api/v1']) {
    assert.throws(() => verifyPersonalBundle(Buffer.from(`${api}\0${other}`), api), /outra API/);
  }
  assert.throws(() => verifyPersonalBundle(Buffer.from('no endpoint'), api), /ausente/);
});

test('publication rejects incompatible runtime instead of overriding native fingerprint', () => {
  const runtime = '1234567890abcdef1234567890abcdef12345678';
  verifyRuntime(runtime, runtime);
  assert.throws(() => verifyRuntime(runtime, 'a'.repeat(40)), /novo APK/);
  assert.throws(() => verifyRuntime('forced', 'forced'), /incompatível/);
});

test('APK manifest metadata parser distinguishes adjacent nodes and escaped channel JSON', () => {
  const tree = `E: manifest
    E: meta-data
      A: android:name(0x1)="expo.modules.updates.ENABLED" (Raw: "expo.modules.updates.ENABLED")
      A: android:value(0x2)=true
    E: meta-data
      A: android:name(0x1)="headers" (Raw: "headers")
      A: android:value(0x2)=${JSON.stringify('{"expo-channel-name":"personal-test"}')} (Raw: ${JSON.stringify('{"expo-channel-name":"personal-test"}')})
    E: activity
      A: android:value(0x2)="unrelated"
  `;
  assert.equal(metadataValue(tree, 'expo.modules.updates.ENABLED'), 'true');
  assert.deepEqual(JSON.parse(metadataValue(tree, 'headers')), { 'expo-channel-name': 'personal-test' });
  const rawJson = tree.replaceAll(JSON.stringify('{"expo-channel-name":"personal-test"}'), '"{"expo-channel-name":"personal-test"}"');
  assert.deepEqual(JSON.parse(metadataValue(rawJson, 'headers')), { 'expo-channel-name': 'personal-test' });
  assert.throws(() => metadataValue(tree, 'missing'), /ausente/);
});
