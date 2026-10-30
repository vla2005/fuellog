import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type BiometricType = 'face' | 'fingerprint' | 'iris' | 'biometric';

export interface BiometricDeviceInfo {
  isSupported: boolean;
  isEnrolled: boolean;
  biometricType: BiometricType;
  biometricLabel: string;
  isExpoGoIos: boolean;
  reasonNotSupported?: string;
}

export function isExpoGoOnIos(): boolean {
  if (Platform.OS !== 'ios') {
    return false;
  }
  const isExpo =
    Constants.appOwnership === 'expo' ||
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  return Boolean(isExpo);
}

/**
 * Consulta a capacidade de biometria nativa do aparelho.
 * Verifica suporte de hardware, cadastro do usuário e requisitos de segurança do sistema.
 * Falha fechada caso canUseBiometricAuthentication não esteja disponível ou retorne false.
 */
export async function getBiometricDeviceInfo(): Promise<BiometricDeviceInfo> {
  if (Platform.OS === 'web') {
    return {
      isSupported: false,
      isEnrolled: false,
      biometricType: 'biometric',
      biometricLabel: 'Biometria',
      isExpoGoIos: false,
      reasonNotSupported: 'Biometria indisponível na versão web.',
    };
  }

  if (isExpoGoOnIos()) {
    return {
      isSupported: false,
      isEnrolled: false,
      biometricType: 'face',
      biometricLabel: 'Face ID',
      isExpoGoIos: true,
      reasonNotSupported:
        'Biometria no iOS requer build própria (development build) e não é suportada no Expo Go.',
    };
  }

  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      return {
        isSupported: false,
        isEnrolled: false,
        biometricType: 'biometric',
        biometricLabel: 'Biometria',
        isExpoGoIos: false,
        reasonNotSupported: 'Este dispositivo não possui sensor biométrico.',
      };
    }

    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) {
      return {
        isSupported: false,
        isEnrolled: false,
        biometricType: 'biometric',
        biometricLabel: 'Biometria',
        isExpoGoIos: false,
        reasonNotSupported: 'Nenhuma biometria cadastrada no aparelho.',
      };
    }

    // Validação estrita de segurança via SecureStore (falha fechada)
    const canSecureAuth =
      typeof SecureStore.canUseBiometricAuthentication === 'function' &&
      SecureStore.canUseBiometricAuthentication();

    if (!canSecureAuth) {
      return {
        isSupported: false,
        isEnrolled: true,
        biometricType: 'biometric',
        biometricLabel: 'Biometria',
        isExpoGoIos: false,
        reasonNotSupported:
          'O método biométrico do dispositivo não atende aos requisitos de segurança necessários.',
      };
    }

    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    let biometricType: BiometricType = 'biometric';
    let biometricLabel = 'Biometria';

    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      biometricType = 'face';
      biometricLabel = Platform.OS === 'ios' ? 'Face ID' : 'Reconhecimento facial';
    } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      biometricType = 'fingerprint';
      biometricLabel = 'Impressão digital';
    } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      biometricType = 'iris';
      biometricLabel = 'Íris';
    }

    return {
      isSupported: true,
      isEnrolled: true,
      biometricType,
      biometricLabel,
      isExpoGoIos: false,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Falha ao verificar sensores biométricos.';
    return {
      isSupported: false,
      isEnrolled: false,
      biometricType: 'biometric',
      biometricLabel: 'Biometria',
      isExpoGoIos: false,
      reasonNotSupported: message,
    };
  }
}

/**
 * Solicita autenticação biométrica do sistema operacional.
 */
export async function authenticateWithSystemBiometrics(
  promptMessage: string,
): Promise<{ success: boolean; canceled: boolean; error?: string }> {
  if (Platform.OS === 'web') {
    return { success: false, canceled: false, error: 'Biometria não suportada no navegador.' };
  }

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancelar',
      disableDeviceFallback: true,
    });

    if (result.success) {
      return { success: true, canceled: false };
    }

    const isCanceled =
      result.error === 'user_cancel' ||
      result.error === 'system_cancel' ||
      result.error === 'app_cancel';

    return {
      success: false,
      canceled: isCanceled,
      error: isCanceled ? 'Autenticação biométrica cancelada.' : result.error,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isCanceled = /cancel|dismiss/i.test(message);
    return { success: false, canceled: isCanceled, error: message };
  }
}
