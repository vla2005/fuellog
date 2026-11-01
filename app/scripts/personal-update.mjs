import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { exclusiveEnv } from './exclusive.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export function verifyPersonalBundle(bundle, api) {
  if (!bundle.includes(Buffer.from(api))) throw new Error('OTA: API pessoal ausente no bundle.');
  const endpoints = bundle.toString('latin1').match(/https?:\/\/(?:\[[a-f0-9:]+\]|[a-z0-9.-]+)(?::\d+)?\/api\/v1\/?/gi) ?? [];
  if (endpoints.some(endpoint => endpoint.replace(/\/$/, '') !== api.replace(/\/$/, ''))) {
    throw new Error('OTA: bundle contém outra API, incluindo possível endereço LAN/localhost.');
  }
}

export function verifyRuntime(nativeRuntime, updateRuntime) {
  if (!/^[a-f0-9]{40}$/.test(nativeRuntime) || nativeRuntime !== updateRuntime) {
    throw new Error('OTA: fingerprint incompatível com o APK; gere um novo APK antes de publicar.');
  }
}

export function metadataValue(tree, name) {
  const block = tree.split(/\bE: meta-data\b/).slice(1).find(part => part.split(/\n\s*E:/)[0].includes(`="${name}"`));
  const value = block?.split(/\n\s*E:/)[0].match(/:value\([^)]*\)=(.*?)(?: \(Raw:|\r?\n|$)/)?.[1];
  if (value === undefined) throw new Error(`OTA: metadado nativo ausente: ${name}.`);
  if (!value.startsWith('"')) return value;
  try {
    return JSON.parse(value);
  } catch {
    // aapt2 also emits raw JSON strings with unescaped inner quotes.
    return value.slice(1, -1);
  }
}

function run(command, args, env, options = {}) {
  const result = spawnSync(command, args, { cwd: appRoot, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `OTA: comando falhou (${result.status}).`);
  return result.stdout;
}

function main() {
  const [apkPath, message, ...extra] = process.argv.slice(2);
  if (!apkPath || !message?.trim() || extra.length) {
    throw new Error('Uso: node scripts/personal-update.mjs <APK pessoal> "mensagem da atualização"');
  }
  const env = exclusiveEnv(join(appRoot, '.env.exclusive.local'));
  const expo = require.resolve('expo/bin/cli');
  const eas = env.FUELLOG_EAS_CLI || require.resolve('eas-cli/bin/run');
  const config = JSON.parse(run(process.execPath, [expo, 'config', '--type', 'public', '--json'], env));
  if (!config.extra?.eas?.projectId || !config.updates?.enabled) throw new Error('OTA: configure o projeto EAS pessoal.');

  const runtime = JSON.parse(run(process.execPath, [require.resolve('expo-updates/bin/cli.js'), 'runtimeversion:resolve', '--platform', 'android'], env));
  if (runtime.workflow !== 'managed') throw new Error('OTA: este comando exige CNG, com android/ ignorado pelo Git.');
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('OTA: defina ANDROID_HOME para validar o APK.');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const tools = readdirSync(join(sdk, 'build-tools')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  const aapt = join(sdk, 'build-tools', tools, `aapt2${suffix}`);
  const apk = resolve(apkPath);
  const tree = run(aapt, ['dump', 'xmltree', apk, '--file', 'AndroidManifest.xml'], env);
  if (metadataValue(tree, 'expo.modules.updates.ENABLED') !== 'true' ||
      metadataValue(tree, 'expo.modules.updates.EXPO_UPDATE_URL') !== env.FUELLOG_OTA_URL ||
      JSON.parse(metadataValue(tree, 'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY'))['expo-channel-name'] !== env.FUELLOG_OTA_CHANNEL) {
    throw new Error('OTA: APK aponta para outra configuração de distribuição.');
  }
  const resources = run(aapt, ['dump', 'resources', apk], env);
  const runtimeResource = metadataValue(tree, 'expo.modules.updates.EXPO_RUNTIME_VERSION').replace(/^@/, '');
  if (!resources.match(new RegExp(`resource ${runtimeResource} string/expo_runtime_version[\\s\\S]*?\\(\\) "file:fingerprint"`))) {
    throw new Error('OTA: APK não usa o arquivo de fingerprint nativo.');
  }
  const temporary = mkdtempSync(join(tmpdir(), 'fuellog-apk-'));
  try {
    const jar = env.JAVA_HOME ? join(env.JAVA_HOME, 'bin', `jar${suffix}`) : `jar${suffix}`;
    run(jar, ['--extract', '--file', apk, 'assets/fingerprint', 'assets/index.android.bundle'], env, { cwd: temporary });
    verifyRuntime(readFileSync(join(temporary, 'assets/fingerprint'), 'utf8').trim(), runtime.runtimeVersion);
    verifyPersonalBundle(readFileSync(join(temporary, 'assets/index.android.bundle')), env.EXPO_PUBLIC_API_URL);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  // EAS requires an environment on SDK 55+, but must not replace local personal values.
  for (const scope of ['project', 'account']) {
    const variables = run(process.execPath, [eas, 'env:list', 'development', '--scope', scope, '--format', 'short'], { ...env, FORCE_COLOR: '0' });
    if (/^(?:EXPO_PUBLIC_|FUELLOG_|EXPO_UPDATES_|EXPO_NO_DOTENV|NODE_ENV)/m.test(variables)) {
      throw new Error('OTA: ambiente EAS development contém variáveis conflitantes; publicação recusada.');
    }
  }
  run(process.execPath, [join(appRoot, 'scripts/exclusive.mjs'), 'export'], env, { stdio: 'inherit' });
  const directory = join(appRoot, 'dist/personal');
  const metadata = JSON.parse(readFileSync(join(directory, 'metadata.json'), 'utf8'));
  verifyPersonalBundle(readFileSync(join(directory, metadata.fileMetadata.android.bundle)), env.EXPO_PUBLIC_API_URL);
  const afterExport = JSON.parse(run(process.execPath, [require.resolve('expo-updates/bin/cli.js'), 'runtimeversion:resolve', '--platform', 'android'], env));
  verifyRuntime(runtime.runtimeVersion, afterExport.runtimeVersion);
  console.log(`OTA: APK e export compatíveis; runtime ${runtime.runtimeVersion}; canal ${env.FUELLOG_OTA_CHANNEL}.`);
  const published = JSON.parse(run(process.execPath, [eas, 'update', '--channel', env.FUELLOG_OTA_CHANNEL, '--platform', 'android', '--environment', 'development', '--skip-bundler', '--input-dir', directory, '--message', message, '--json', '--non-interactive'], env));
  writeFileSync(join(directory, 'publication.json'), JSON.stringify(published, null, 2));
  for (const update of published) verifyRuntime(runtime.runtimeVersion, update.runtimeVersion);
  console.log(JSON.stringify(published, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
