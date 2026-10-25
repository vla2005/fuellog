import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const REFRESH_TOKEN_KEY = 'fuellog.auth.refresh_token.v1';
const ACTIVE_VEHICLE_KEY_PREFIX = 'fuellog.vehicle.active.v1.';

let inMemoryAccessToken: string | null = null;
let currentSessionEpoch = 0;

/**
 * Epoca de sessao monotônica para invalidar respostas ou restores assíncronos
 * que comecaram antes de um logout ou troca de usuario.
 */
export function getSessionEpoch(): number {
  return currentSessionEpoch;
}

export function bumpSessionEpoch(): number {
  currentSessionEpoch += 1;
  return currentSessionEpoch;
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
      }
      return null;
    }
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setRefreshToken(token: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      throw new Error('Armazenamento de sessão indisponível no navegador.');
    }
    if (token !== null) {
      window.sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
    } else {
      window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    }
    return;
  }

  if (token !== null) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } else {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  }
}

export async function saveTokenPairAtomically(
  accessToken: string,
  refreshToken: string,
  expectedEpoch?: number,
): Promise<void> {
  const epochAtStart = expectedEpoch ?? currentSessionEpoch;
  if (currentSessionEpoch !== epochAtStart) {
    throw new Error('Sessão alterada antes de persistir credenciais.');
  }
  await setRefreshToken(refreshToken);
  if (currentSessionEpoch !== epochAtStart) {
    try {
      await setRefreshToken(null);
    } catch {
      // Preserva o erro principal de época inválida
    }
    throw new Error('Sessão alterada ou encerrada durante a persistência de credenciais.');
  }
  inMemoryAccessToken = accessToken;
}

export async function clearStoredTokens(): Promise<void> {
  bumpSessionEpoch();
  inMemoryAccessToken = null;
  await setRefreshToken(null);
}

export function getScopedVehicleStorageKey(userId: string): string {
  return `${ACTIVE_VEHICLE_KEY_PREFIX}${userId}`;
}
