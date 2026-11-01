const { isIP } = require('node:net');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`OTA: defina ${name} para habilitar atualizações pessoais.`);
  return value;
}

function publicHttps(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`OTA: ${name} deve ser uma URL HTTPS pública válida.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      !host.includes('.') || isIP(host) || /\.(local|localhost|internal)$/.test(host)) {
    throw new Error(`OTA: ${name} exige HTTPS público, sem credenciais, fragmento ou endereço local.`);
  }
  return url;
}

module.exports = ({ config }) => {
  const otaKeys = ['FUELLOG_OTA_URL', 'FUELLOG_OTA_CHANNEL', 'FUELLOG_OTA_RUNTIME_POLICY', 'FUELLOG_EAS_PROJECT_ID'];
  if (!otaKeys.some(key => process.env[key] !== undefined)) {
    return { ...config, updates: { ...config.updates, enabled: false } };
  }

  const url = required('FUELLOG_OTA_URL');
  const endpoint = publicHttps(url, 'FUELLOG_OTA_URL');
  const channel = required('FUELLOG_OTA_CHANNEL');
  if (!/^personal-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(channel)) {
    throw new Error('OTA: FUELLOG_OTA_CHANNEL deve ser exclusivo, no formato personal-<identificador>.');
  }
  if (required('FUELLOG_OTA_RUNTIME_POLICY') !== 'fingerprint') {
    throw new Error('OTA: FUELLOG_OTA_RUNTIME_POLICY deve ser fingerprint para garantir compatibilidade nativa.');
  }
  const api = publicHttps(required('EXPO_PUBLIC_API_URL'), 'EXPO_PUBLIC_API_URL');
  if (!/^\/api\/v1\/?$/.test(api.pathname) || api.search) {
    throw new Error('OTA: EXPO_PUBLIC_API_URL deve terminar em /api/v1, sem parâmetros.');
  }

  const projectId = process.env.FUELLOG_EAS_PROJECT_ID?.trim();
  if (process.env.FUELLOG_EAS_PROJECT_ID !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId ?? '')) {
    throw new Error('OTA: FUELLOG_EAS_PROJECT_ID deve ser um UUID válido.');
  }
  if (endpoint.hostname === 'u.expo.dev' || projectId) {
    if (!projectId || endpoint.origin !== 'https://u.expo.dev' || endpoint.pathname !== `/${projectId}` || endpoint.search) {
      throw new Error('OTA: EAS exige FUELLOG_EAS_PROJECT_ID e URL https://u.expo.dev/<mesmo-projectId>.');
    }
  }

  return {
    ...config,
    runtimeVersion: { policy: 'fingerprint' },
    updates: {
      ...config.updates,
      enabled: true,
      url,
      requestHeaders: { ...config.updates?.requestHeaders, 'expo-channel-name': channel },
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      useEmbeddedUpdate: true,
    },
    ...(projectId ? { extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } } } : {}),
  };
};
