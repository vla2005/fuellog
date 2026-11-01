import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredKeys = ['EXPO_PUBLIC_API_URL', 'FUELLOG_OTA_URL', 'FUELLOG_OTA_CHANNEL', 'FUELLOG_OTA_RUNTIME_POLICY'];

export function exclusiveEnv(filePath, parent = process.env) {
  const values = parseEnv(readFileSync(filePath, 'utf8'));
  for (const key of requiredKeys) {
    if (!values[key]?.trim()) throw new Error(`OTA: ${key} deve constar no próprio .env.exclusive.local.`);
  }
  const env = { ...parent };
  // Personal settings must never fall back to inherited development or EAS settings.
  for (const key of Object.keys(env)) {
    if (key.startsWith('EXPO_PUBLIC_') || key.startsWith('FUELLOG_OTA_') || key.startsWith('EXPO_UPDATES_') || key === 'FUELLOG_EAS_PROJECT_ID') delete env[key];
  }
  if (Object.keys(values).some(key => key.startsWith('EXPO_UPDATES_'))) {
    throw new Error('OTA: overrides de fingerprint/workflow não são permitidos no arquivo pessoal.');
  }
  return { ...env, ...values, EXPO_NO_DOTENV: '1' };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!['config', 'prebuild', 'export'].includes(command) || args.length) {
    throw new Error('Uso: node scripts/exclusive.mjs config|prebuild|export');
  }
  const env = exclusiveEnv(resolve(appRoot, '.env.exclusive.local'));
  const require = createRequire(import.meta.url);
  const cli = require.resolve('expo/bin/cli');
  const config = spawnSync(process.execPath, [cli, 'config', '--type', 'public', '--json'], {
    cwd: appRoot, env, encoding: 'utf8',
  });
  if (config.status !== 0) {
    process.stderr.write(config.stderr || 'OTA: falha ao validar configuração pessoal.\n');
    process.exitCode = config.status || 1;
    return;
  }
  if (command === 'config') {
    const resolved = JSON.parse(config.stdout);
    console.log(JSON.stringify({
      otaEnabled: resolved.updates?.enabled,
      channel: resolved.updates?.requestHeaders?.['expo-channel-name'],
      runtimeVersion: resolved.runtimeVersion,
      easConfigured: Boolean(resolved.extra?.eas?.projectId),
    }, null, 2));
    return;
  }
  const expoArgs = command === 'prebuild'
    ? ['prebuild', '--platform', 'android', '--no-install']
    : ['export', '--platform', 'android', '--output-dir', 'dist/personal'];
  const result = spawnSync(process.execPath, [cli, ...expoArgs], { cwd: appRoot, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
