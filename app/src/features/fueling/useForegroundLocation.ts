import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';

import {
  Coordinates,
  isValidCoordinate,
  normalizeCoordinate,
} from '@/utils/location';

export type LocationCaptureStatus =
  | 'idle'
  | 'requesting_permission'
  | 'locating'
  | 'ready'
  | 'permission_denied'
  | 'services_disabled'
  | 'error';

interface UseForegroundLocationOptions {
  initialCoordinates?: Coordinates | null;
  autoRequest?: boolean;
}

export function useForegroundLocation({
  initialCoordinates = null,
  autoRequest = false,
}: UseForegroundLocationOptions = {}) {
  const [status, setStatus] = useState<LocationCaptureStatus>(() => {
    if (
      initialCoordinates &&
      isValidCoordinate(
        initialCoordinates.latitude,
        initialCoordinates.longitude,
      )
    ) {
      return 'ready';
    }
    return 'idle';
  });

  const [coordinates, setCoordinates] = useState<Coordinates | null>(() => {
    if (
      initialCoordinates &&
      isValidCoordinate(
        initialCoordinates.latitude,
        initialCoordinates.longitude,
      )
    ) {
      return {
        latitude: normalizeCoordinate(initialCoordinates.latitude),
        longitude: normalizeCoordinate(initialCoordinates.longitude),
      };
    }
    return null;
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [canAskAgain, setCanAskAgain] = useState<boolean>(true);

  const isMountedRef = useRef(true);
  const requestSeqRef = useRef(0);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearActiveTimeout = useCallback(() => {
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      requestSeqRef.current++;
      clearActiveTimeout();
    };
  }, [clearActiveTimeout]);

  // Preserva snapshot inicial estrito quando fornecido e válido
  useEffect(() => {
    if (
      initialCoordinates &&
      isValidCoordinate(
        initialCoordinates.latitude,
        initialCoordinates.longitude,
      )
    ) {
      setCoordinates({
        latitude: normalizeCoordinate(initialCoordinates.latitude),
        longitude: normalizeCoordinate(initialCoordinates.longitude),
      });
      setStatus('ready');
      setErrorMessage(null);
    }
  }, [initialCoordinates]);

  const requestLocation = useCallback(
    async (forceRecapture = false) => {
      // Se já temos coordenadas válidas e não estamos forçando recaptura, não captura de novo
      if (coordinates && !forceRecapture && status === 'ready') {
        return coordinates;
      }

      // IMPORTANTE: Em caso de recaptura, sai de 'ready' e invalida as coordenadas
      // IMEDIATAMENTE ANTES de qualquer await, bloqueando tentativas de salvamento com dados antigos
      if (forceRecapture) {
        setCoordinates(null);
        setStatus('locating');
        setErrorMessage(null);
      }

      const seq = ++requestSeqRef.current;
      clearActiveTimeout();

      let localTimerId: ReturnType<typeof setTimeout> | null = null;
      const clearLocalTimer = () => {
        if (localTimerId) {
          clearTimeout(localTimerId);
          if (timeoutIdRef.current === localTimerId) {
            timeoutIdRef.current = null;
          }
          localTimerId = null;
        }
      };

      try {
        if (!isMountedRef.current || seq !== requestSeqRef.current) return null;

        // 1. Verifica disponibilidade de serviços de localização (GPS)
        let servicesEnabled = true;
        try {
          servicesEnabled = await Location.hasServicesEnabledAsync();
        } catch {
          if (isMountedRef.current && seq === requestSeqRef.current) {
            setStatus('error');
            setCoordinates(null);
            setErrorMessage('Módulo de localização indisponível no dispositivo.');
          }
          return null;
        }

        if (!isMountedRef.current || seq !== requestSeqRef.current) return null;

        if (!servicesEnabled) {
          setStatus('services_disabled');
          setCoordinates(null);
          setErrorMessage(
            'O serviço de localização (GPS) está desativado no aparelho. Ative o GPS para registrar o abastecimento.',
          );
          return null;
        }

        // 2. Solicita permissão em primeiro plano
        setStatus('requesting_permission');
        let permResult: Location.LocationPermissionResponse;
        try {
          permResult = await Location.requestForegroundPermissionsAsync();
        } catch {
          if (isMountedRef.current && seq === requestSeqRef.current) {
            setStatus('error');
            setCoordinates(null);
            setErrorMessage('Falha ao solicitar permissão de localização.');
          }
          return null;
        }

        if (!isMountedRef.current || seq !== requestSeqRef.current) return null;

        if (!permResult || !permResult.granted) {
          setStatus('permission_denied');
          setCoordinates(null);
          setCanAskAgain(permResult?.canAskAgain ?? false);
          setErrorMessage(
            'Permissão de localização negada. O FuelLog precisa do GPS para registrar as coordenadas do abastecimento.',
          );
          return null;
        }

        // 3. Captura posição com timeout de 15 segundos estritamente cancelável por requisição
        setStatus('locating');

        const positionPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          localTimerId = setTimeout(() => {
            reject(new Error('TIMEOUT'));
          }, 15000);
          timeoutIdRef.current = localTimerId;
        });

        let pos: Location.LocationObject;
        try {
          pos = await Promise.race([positionPromise, timeoutPromise]);
        } finally {
          clearLocalTimer();
        }

        if (!isMountedRef.current || seq !== requestSeqRef.current) return null;

        const rawLat = pos?.coords?.latitude;
        const rawLon = pos?.coords?.longitude;

        if (!isValidCoordinate(rawLat, rawLon)) {
          setStatus('error');
          setCoordinates(null);
          setErrorMessage(
            'Coordenadas recebidas do GPS estão fora do padrão WGS84 válido.',
          );
          return null;
        }

        const normalized: Coordinates = {
          latitude: normalizeCoordinate(rawLat),
          longitude: normalizeCoordinate(rawLon),
        };

        setCoordinates(normalized);
        setStatus('ready');
        setErrorMessage(null);
        return normalized;
      } catch (err: unknown) {
        clearLocalTimer();
        if (!isMountedRef.current || seq !== requestSeqRef.current) return null;

        setStatus('error');
        setCoordinates(null);
        if (err instanceof Error && err.message === 'TIMEOUT') {
          setErrorMessage(
            'Tempo limite esgotado ao buscar sinal de GPS. Verifique a visibilidade do satélite e tente novamente.',
          );
        } else {
          setErrorMessage(
            'Não foi possível obter a localização atual. Verifique o sinal do GPS e tente novamente.',
          );
        }
        return null;
      }
    },
    [clearActiveTimeout, coordinates, status],
  );

  const openSettings = useCallback(async () => {
    try {
      if (Platform.OS !== 'web' && Linking?.openSettings) {
        await Linking.openSettings();
      }
    } catch {
      // Ignora falha de abertura de configurações nativas
    }
  }, []);

  const resetLocation = useCallback(() => {
    requestSeqRef.current++;
    clearActiveTimeout();
    setCoordinates(null);
    setStatus('idle');
    setErrorMessage(null);
  }, [clearActiveTimeout]);

  useEffect(() => {
    if (autoRequest && status === 'idle' && !coordinates) {
      void requestLocation();
    }
  }, [autoRequest, coordinates, requestLocation, status]);

  return {
    status,
    coordinates,
    errorMessage,
    canAskAgain,
    requestLocation,
    openSettings,
    resetLocation,
    setFixedCoordinates: useCallback((coords: Coordinates) => {
      if (isValidCoordinate(coords.latitude, coords.longitude)) {
        setCoordinates({
          latitude: normalizeCoordinate(coords.latitude),
          longitude: normalizeCoordinate(coords.longitude),
        });
        setStatus('ready');
        setErrorMessage(null);
      }
    }, []),
  };
}
