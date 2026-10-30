import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { BiometricDeviceInfo, getBiometricDeviceInfo } from '@/api/biometricAuth';
import { setOnUnauthorizedListener } from '@/api/client';
import {
  createVehicle as apiCreateVehicle,
  updateVehicle as apiUpdateVehicle,
  getFuelTypes,
  getMe,
  listVehicles,
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
  verifyTwoFactor,
} from '@/api/endpoints';
import {
  bumpSessionEpoch,
  clearStoredTokens,
  disableBiometricSession,
  enableBiometricSession,
  getAccessToken,
  getRefreshToken,
  getScopedVehicleStorageKey,
  getSessionEpoch,
  getStoredSessionType,
  isBiometricSessionUnlocked,
  unlockBiometricSession,
  UnlockBiometricResult,
} from '@/api/tokenStorage';
import {
  ApiError,
  CreateVehicleRequest,
  UpdateVehicleRequest,
  FuelType,
  LoginRequest,
  MeResponse,
  RegisterRequest,
  Vehicle,
  isTwoFactorChallenge,
} from '@/api/types';
import { getMonthPeriodOption, MonthPeriodOption } from '@/utils/date';

export type AuthStatus =
  | 'booting'
  | 'authenticated'
  | 'unauthenticated'
  | 'connection_error';

export type ToastTone = 'success' | 'warning' | 'danger' | 'info';

export interface ToastMessage {
  id: string;
  tone: ToastTone;
  title: string;
  subtitle?: string;
}

export type SignInResult =
  | { mfaRequired: false }
  | { mfaRequired: true; challengeToken: string; expiresAt: string };

interface SessionContextValue {
  status: AuthStatus;
  user: MeResponse | null;
  bootError: string | null;
  vehicles: Vehicle[];
  activeVehicle: Vehicle | null;
  availableFuelTypes: FuelType[];
  selectedPeriod: MonthPeriodOption;
  dataVersion: number;
  toast: ToastMessage | null;
  prefilledLoginEmail: string;
  hasBiometricLock: boolean;
  isBiometricActive: boolean;
  biometricDeviceInfo: BiometricDeviceInfo | null;
  setPrefilledLoginEmail: (email: string) => void;
  setSelectedPeriod: (period: MonthPeriodOption) => void;
  selectVehicle: (vehicleId: string) => Promise<void>;
  refreshVehicles: () => Promise<Vehicle[]>;
  createNewVehicle: (payload: CreateVehicleRequest) => Promise<Vehicle>;
  updateExistingVehicle: (
    vehicleId: string,
    version: number,
    payload: UpdateVehicleRequest,
  ) => Promise<Vehicle>;
  signIn: (
    payload: LoginRequest,
    options?: { enableBiometrics?: boolean },
  ) => Promise<SignInResult>;
  completeTwoFactorSignIn: (
    challengeToken: string,
    code: string,
    options?: { enableBiometrics?: boolean },
  ) => Promise<void>;
  cancelTwoFactorChallenge: () => void;
  handlePasswordChanged: (expectedEpoch?: number) => Promise<boolean>;
  getCurrentSessionEpoch: () => number;
  signUpAndSignIn: (
    payload: RegisterRequest,
  ) => Promise<{ registeredOnly: boolean; email: string; loginError?: string }>;
  updateUser: (updatedUser: MeResponse, expectedEpoch: number) => boolean;
  signOut: () => Promise<void>;
  retryBootSession: () => Promise<void>;
  invalidateFuelData: () => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: () => void;
  unlockWithBiometrics: () => Promise<UnlockBiometricResult>;
  enableBiometricsOnCurrentSession: () => Promise<{ success: boolean; canceled: boolean; error?: string }>;
  disableBiometricsOnCurrentSession: () => Promise<void>;
}

const DEFAULT_FUEL_CATALOG: FuelType[] = [
  'GASOLINE_REGULAR',
  'GASOLINE_ADDITIVE',
  'ETHANOL',
  'DIESEL_S10',
  'DIESEL_S500',
];

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [user, setUser] = useState<MeResponse | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [activeVehicleId, setActiveVehicleId] = useState<string | null>(null);
  const [availableFuelTypes, setAvailableFuelTypes] = useState<FuelType[]>(DEFAULT_FUEL_CATALOG);
  const [selectedPeriod, setSelectedPeriod] = useState<MonthPeriodOption>(() =>
    getMonthPeriodOption(0),
  );
  const [dataVersion, setDataVersion] = useState(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [prefilledLoginEmail, setPrefilledLoginEmail] = useState('');
  const [hasBiometricLock, setHasBiometricLock] = useState(false);
  const [isBiometricActive, setIsBiometricActive] = useState(false);
  const [biometricDeviceInfo, setBiometricDeviceInfo] = useState<BiometricDeviceInfo | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChallengeRef = useRef<{
    challengeToken: string;
    epoch: number;
    expiresAt: string;
    enableBiometrics?: boolean;
  } | null>(null);
  const statusRef = useRef<AuthStatus>(status);
  statusRef.current = status;

  const clearInMemoryUserData = useCallback(() => {
    setUser(null);
    setVehicles([]);
    setActiveVehicleId(null);
    setBootError(null);
    activeChallengeRef.current = null;
  }, []);

  const showToast = useCallback((next: Omit<ToastMessage, 'id'>) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    setToast({ ...next, id });
    toastTimerRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 3400);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }, []);

  useEffect(() => {
    setOnUnauthorizedListener(() => {
      clearInMemoryUserData();
      setHasBiometricLock(false);
      setIsBiometricActive(false);
      setStatus('unauthenticated');
    });
    return () => {
      setOnUnauthorizedListener(null);
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, [clearInMemoryUserData]);

  const loadUserWorkspace = useCallback(
    async (me: MeResponse, epoch: number) => {
      const [fetchedVehicles, fetchedFuels] = await Promise.all([
        listVehicles(),
        getFuelTypes().catch(() => DEFAULT_FUEL_CATALOG),
      ]);

      if (getSessionEpoch() !== epoch) {
        return;
      }

      setAvailableFuelTypes(fetchedFuels.length > 0 ? fetchedFuels : DEFAULT_FUEL_CATALOG);
      setVehicles(fetchedVehicles);

      const savedVehicleId = await AsyncStorage.getItem(getScopedVehicleStorageKey(me.id)).catch(
        () => null,
      );

      if (getSessionEpoch() !== epoch) {
        return;
      }

      const matchingSaved = fetchedVehicles.find((v) => v.id === savedVehicleId);
      const chosenId = matchingSaved?.id ?? fetchedVehicles[0]?.id ?? null;
      setActiveVehicleId(chosenId);
      if (chosenId) {
        await AsyncStorage.setItem(getScopedVehicleStorageKey(me.id), chosenId).catch(() => {});
      }
    },
    [],
  );

  const bootstrapSession = useCallback(async () => {
    const epoch = getSessionEpoch();
    setStatus('booting');
    setBootError(null);

    try {
      const devInfo = await getBiometricDeviceInfo().catch(() => null);
      if (getSessionEpoch() !== epoch) {
        return;
      }
      setBiometricDeviceInfo(devInfo);

      const storedType = await getStoredSessionType().catch(() => 'none');
      if (getSessionEpoch() !== epoch) {
        return;
      }

      if (storedType === 'biometric') {
        if (!isBiometricSessionUnlocked()) {
          // Credencial biométrica bloqueada: carregar somente metadados sem prompt ou API protegida
          setHasBiometricLock(true);
          setIsBiometricActive(true);
          clearInMemoryUserData();
          setStatus('unauthenticated');
          return;
        }
        setHasBiometricLock(false);
        setIsBiometricActive(true);
      } else if (storedType === 'plain') {
        setHasBiometricLock(false);
        setIsBiometricActive(false);
      } else {
        setHasBiometricLock(false);
        setIsBiometricActive(false);
        if (getSessionEpoch() === epoch) {
          clearInMemoryUserData();
          setStatus('unauthenticated');
        }
        return;
      }

      const existingAccess = getAccessToken();
      const storedRefresh = await getRefreshToken();

      if (!existingAccess && !storedRefresh) {
        if (getSessionEpoch() === epoch) {
          clearInMemoryUserData();
          setStatus('unauthenticated');
        }
        return;
      }

      if (!existingAccess && storedRefresh) {
        await refreshSession();
      }

      const me = await getMe();
      if (getSessionEpoch() !== epoch) {
        return;
      }

      await loadUserWorkspace(me, epoch);
      if (getSessionEpoch() !== epoch) {
        return;
      }

      setUser(me);
      setStatus('authenticated');
    } catch (err: unknown) {
      if (getSessionEpoch() !== epoch) {
        return;
      }

      if (err instanceof ApiError && err.kind === 'unauthorized') {
        try {
          await clearStoredTokens();
        } catch {
          // Ignora falha de remoção durante limpeza de 401
        }
        clearInMemoryUserData();
        setHasBiometricLock(false);
        setIsBiometricActive(false);
        setStatus('unauthenticated');
        return;
      }

      const message =
        err instanceof Error
          ? err.message
          : 'Não foi possível validar sua sessão com o servidor.';
      setBootError(message);
      setStatus('connection_error');
    }
  }, [clearInMemoryUserData, loadUserWorkspace]);

  useEffect(() => {
    void bootstrapSession();
  }, [bootstrapSession]);

  const cancelTwoFactorChallenge = useCallback(() => {
    if (statusRef.current === 'authenticated') {
      activeChallengeRef.current = null;
      return;
    }
    activeChallengeRef.current = null;
    bumpSessionEpoch();
  }, []);

  const signIn = useCallback(
    async (
      payload: LoginRequest,
      options?: { enableBiometrics?: boolean },
    ): Promise<SignInResult> => {
      const epoch = bumpSessionEpoch();
      activeChallengeRef.current = null;
      const loginResult = await loginUser({
        email: payload.email.trim(),
        password: payload.password,
      });

      if (getSessionEpoch() !== epoch) {
        return { mfaRequired: false };
      }

      if (isTwoFactorChallenge(loginResult)) {
        activeChallengeRef.current = {
          challengeToken: loginResult.challengeToken,
          epoch,
          expiresAt: loginResult.expiresAt,
          enableBiometrics: Boolean(options?.enableBiometrics),
        };
        return {
          mfaRequired: true,
          challengeToken: loginResult.challengeToken,
          expiresAt: loginResult.expiresAt,
        };
      }

      const me = await getMe();
      if (getSessionEpoch() !== epoch) {
        return { mfaRequired: false };
      }

      await loadUserWorkspace(me, epoch);
      if (getSessionEpoch() !== epoch) {
        return { mfaRequired: false };
      }

      if (options?.enableBiometrics) {
        try {
          const bioResult = await enableBiometricSession(epoch);
          if (getSessionEpoch() !== epoch) {
            return { mfaRequired: false };
          }
          if (bioResult.success) {
            setHasBiometricLock(false);
            setIsBiometricActive(true);
            showToast({
              tone: 'success',
              title: 'Sessão iniciada',
              subtitle: 'Biometria ativada com sucesso neste aparelho.',
            });
          } else if (bioResult.canceled) {
            setHasBiometricLock(false);
            setIsBiometricActive(false);
            showToast({
              tone: 'info',
              title: 'Sessão iniciada',
              subtitle: 'A biometria não foi ativada.',
            });
          } else {
            setHasBiometricLock(false);
            setIsBiometricActive(false);
            showToast({
              tone: 'warning',
              title: 'Sessão iniciada',
              subtitle: bioResult.error ?? 'A biometria não pôde ser ativada.',
            });
          }
        } catch {
          if (getSessionEpoch() !== epoch) {
            return { mfaRequired: false };
          }
          setHasBiometricLock(false);
          setIsBiometricActive(false);
          showToast({
            tone: 'warning',
            title: 'Sessão iniciada',
            subtitle: 'A biometria não pôde ser ativada.',
          });
        }
      } else {
        setHasBiometricLock(false);
        setIsBiometricActive(false);
        showToast({
          tone: 'success',
          title: 'Sessão iniciada',
          subtitle: 'Seus abastecimentos foram sincronizados.',
        });
      }

      if (getSessionEpoch() !== epoch) {
        return { mfaRequired: false };
      }

      setUser(me);
      setPrefilledLoginEmail(me.email);
      setBootError(null);
      setStatus('authenticated');
      return { mfaRequired: false };
    },
    [loadUserWorkspace, showToast],
  );

  const completeTwoFactorSignIn = useCallback(
    async (
      challengeToken: string,
      code: string,
      options?: { enableBiometrics?: boolean },
    ): Promise<void> => {
      const challenge = activeChallengeRef.current;
      if (
        !challenge ||
        challenge.challengeToken !== challengeToken ||
        challenge.epoch !== getSessionEpoch() ||
        Date.now() >= new Date(challenge.expiresAt).getTime()
      ) {
        throw new ApiError({
          message: 'Desafio expirado ou cancelado. Faça login novamente.',
          kind: 'unauthorized',
          status: 401,
        });
      }
      const expectedEpoch = challenge.epoch;
      if (expectedEpoch === null || getSessionEpoch() !== expectedEpoch) {
        throw new ApiError({
          message: 'Desafio expirado ou cancelado. Faça login novamente.',
          kind: 'unauthorized',
          status: 401,
        });
      }

      const shouldEnableBiometrics =
        options?.enableBiometrics !== undefined
          ? options.enableBiometrics
          : Boolean(challenge.enableBiometrics);

      await verifyTwoFactor({
        challengeToken,
        code,
      });

      if (getSessionEpoch() !== expectedEpoch) {
        return;
      }

      const me = await getMe();
      if (getSessionEpoch() !== expectedEpoch) {
        return;
      }

      await loadUserWorkspace(me, expectedEpoch);
      if (getSessionEpoch() !== expectedEpoch) {
        return;
      }

      if (shouldEnableBiometrics) {
        try {
          const bioResult = await enableBiometricSession(expectedEpoch);
          if (getSessionEpoch() !== expectedEpoch) {
            return;
          }
          if (bioResult.success) {
            setHasBiometricLock(false);
            setIsBiometricActive(true);
            showToast({
              tone: 'success',
              title: 'Sessão iniciada',
              subtitle: 'Biometria ativada com sucesso neste aparelho.',
            });
          } else if (bioResult.canceled) {
            setHasBiometricLock(false);
            setIsBiometricActive(false);
            showToast({
              tone: 'info',
              title: 'Sessão iniciada',
              subtitle: 'A biometria não foi ativada.',
            });
          } else {
            setHasBiometricLock(false);
            setIsBiometricActive(false);
            showToast({
              tone: 'warning',
              title: 'Sessão iniciada',
              subtitle: bioResult.error ?? 'A biometria não pôde ser ativada.',
            });
          }
        } catch {
          if (getSessionEpoch() !== expectedEpoch) {
            return;
          }
          setHasBiometricLock(false);
          setIsBiometricActive(false);
          showToast({
            tone: 'warning',
            title: 'Sessão iniciada',
            subtitle: 'A biometria não pôde ser ativada.',
          });
        }
      } else {
        setHasBiometricLock(false);
        setIsBiometricActive(false);
        showToast({
          tone: 'success',
          title: 'Sessão iniciada',
          subtitle: 'Seus abastecimentos foram sincronizados.',
        });
      }

      if (getSessionEpoch() !== expectedEpoch) {
        return;
      }

      activeChallengeRef.current = null;
      setUser(me);
      setPrefilledLoginEmail(me.email);
      setBootError(null);
      setStatus('authenticated');
    },
    [loadUserWorkspace, showToast],
  );

  const handlePasswordChanged = useCallback(
    async (expectedEpoch?: number): Promise<boolean> => {
      if (expectedEpoch !== undefined && getSessionEpoch() !== expectedEpoch) {
        return false;
      }
      activeChallengeRef.current = null;
      try {
        await clearStoredTokens();
      } catch {
        // Ignora erro de limpeza local
      }
      if (expectedEpoch !== undefined && getSessionEpoch() !== expectedEpoch + 1) {
        return false;
      }
      clearInMemoryUserData();
      setHasBiometricLock(false);
      setIsBiometricActive(false);
      setStatus('unauthenticated');
      return true;
    },
    [clearInMemoryUserData],
  );
  const signUpAndSignIn = useCallback(
    async (
      payload: RegisterRequest,
    ): Promise<{ registeredOnly: boolean; email: string; loginError?: string }> => {
      const cleanEmail = payload.email.trim();
      const cleanName = payload.name.trim();

      await registerUser({
        name: cleanName,
        email: cleanEmail,
        password: payload.password,
      });

      try {
        await signIn({
          email: cleanEmail,
          password: payload.password,
        });
        return { registeredOnly: false, email: cleanEmail };
      } catch (err: unknown) {
        setPrefilledLoginEmail(cleanEmail);
        const loginError =
          err instanceof Error
            ? err.message
            : 'Sua conta foi criada, mas não foi possível iniciar a sessão automaticamente.';
        return {
          registeredOnly: true,
          email: cleanEmail,
          loginError,
        };
      }
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    let storageRemovalError: unknown = null;
    try {
      try {
        await logoutSession();
      } catch {
        // Mesmo se o servidor estiver offline no logout, limpamos localmente a sessão
      }
      try {
        await clearStoredTokens();
      } catch (err: unknown) {
        storageRemovalError = err;
      }
    } finally {
      clearInMemoryUserData();
      setHasBiometricLock(false);
      setIsBiometricActive(false);
      setStatus('unauthenticated');
    }

    if (storageRemovalError) {
      const message =
        storageRemovalError instanceof Error
          ? storageRemovalError.message
          : 'Não foi possível remover a credencial persistida do dispositivo.';
      showToast({
        tone: 'danger',
        title: 'Falha ao limpar credencial persistida',
        subtitle: message,
      });
      throw storageRemovalError instanceof Error
        ? storageRemovalError
        : new Error(message);
    }
  }, [clearInMemoryUserData, showToast]);

  const selectVehicle = useCallback(
    async (vehicleId: string) => {
      setActiveVehicleId(vehicleId);
      if (user) {
        await AsyncStorage.setItem(getScopedVehicleStorageKey(user.id), vehicleId).catch(() => {});
      }
    },
    [user],
  );

  const refreshVehicles = useCallback(async (): Promise<Vehicle[]> => {
    const epoch = getSessionEpoch();
    const list = await listVehicles();
    if (getSessionEpoch() !== epoch) {
      return list;
    }
    setVehicles(list);
    setActiveVehicleId((prev) => {
      if (prev && list.some((v) => v.id === prev)) {
        return prev;
      }
      return list[0]?.id ?? null;
    });
    return list;
  }, []);

  const createNewVehicle = useCallback(
    async (payload: CreateVehicleRequest): Promise<Vehicle> => {
      const epoch = getSessionEpoch();
      const created = await apiCreateVehicle(payload);
      if (getSessionEpoch() !== epoch) {
        return created;
      }
      setVehicles((prev) => {
        const exists = prev.some((v) => v.id === created.id);
        return exists ? prev : [...prev, created];
      });
      setActiveVehicleId(created.id);
      if (user) {
        await AsyncStorage.setItem(getScopedVehicleStorageKey(user.id), created.id).catch(
          () => {},
        );
      }
      setDataVersion((v) => v + 1);
      return created;
    },
    [user],
  );

  const updateExistingVehicle = useCallback(
    async (
      vehicleId: string,
      version: number,
      payload: UpdateVehicleRequest,
    ): Promise<Vehicle> => {
      const epoch = getSessionEpoch();
      const updated = await apiUpdateVehicle(vehicleId, version, payload);
      if (getSessionEpoch() !== epoch) {
        return updated;
      }
      setVehicles((prev) =>
        prev.map((v) => (v.id === updated.id ? updated : v)),
      );
      setDataVersion((v) => v + 1);
      return updated;
    },
    [],
  );

  const updateUser = useCallback(
    (updatedUser: MeResponse, expectedEpoch: number): boolean => {
      const currentEpoch = getSessionEpoch();
      if (currentEpoch !== expectedEpoch) {
        return false;
      }
      if (status !== 'authenticated' || !user) {
        return false;
      }
      if (updatedUser.id !== user.id) {
        return false;
      }
      setUser(updatedUser);
      return true;
    },
    [status, user],
  );

  const invalidateFuelData = useCallback(() => {
    setDataVersion((v) => v + 1);
  }, []);

  const unlockWithBiometrics = useCallback(async (): Promise<UnlockBiometricResult> => {
    const epoch = getSessionEpoch();
    const unlockRes = await unlockBiometricSession();

    if (!unlockRes.success) {
      if (unlockRes.invalidated) {
        setHasBiometricLock(false);
        setIsBiometricActive(false);
        clearInMemoryUserData();
        setStatus('unauthenticated');
      }
      return unlockRes;
    }

    try {
      if (getSessionEpoch() !== epoch) {
        return {
          success: false,
          canceled: false,
          invalidated: false,
          error: 'Sessão alterada durante o desbloqueio.',
        };
      }

      await refreshSession();

      if (getSessionEpoch() !== epoch) {
        return {
          success: false,
          canceled: false,
          invalidated: false,
          error: 'Sessão alterada durante o desbloqueio.',
        };
      }

      const me = await getMe();
      if (getSessionEpoch() !== epoch) {
        return {
          success: false,
          canceled: false,
          invalidated: false,
          error: 'Sessão alterada durante o desbloqueio.',
        };
      }

      await loadUserWorkspace(me, epoch);
      if (getSessionEpoch() !== epoch) {
        return {
          success: false,
          canceled: false,
          invalidated: false,
          error: 'Sessão alterada durante o desbloqueio.',
        };
      }

      setUser(me);
      setPrefilledLoginEmail(me.email);
      setBootError(null);
      setHasBiometricLock(false);
      setIsBiometricActive(true);
      setStatus('authenticated');

      return unlockRes;
    } catch (err: unknown) {
      if (getSessionEpoch() !== epoch) {
        return {
          success: false,
          canceled: false,
          invalidated: false,
          error: 'Sessão alterada.',
        };
      }

      if (err instanceof ApiError && err.kind === 'unauthorized') {
        try {
          await clearStoredTokens();
        } catch {
          // Ignora
        }
        clearInMemoryUserData();
        setHasBiometricLock(false);
        setIsBiometricActive(false);
        setStatus('unauthenticated');
        return {
          success: false,
          canceled: false,
          invalidated: true,
          error: 'Sua sessão expirou. Faça login com e-mail e senha para renovar.',
        };
      }

      const message =
        err instanceof Error
          ? err.message
          : 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
      return {
        success: false,
        canceled: false,
        invalidated: false,
        error: message,
      };
    }
  }, [clearInMemoryUserData, loadUserWorkspace]);

  const enableBiometricsOnCurrentSession = useCallback(async (): Promise<{
    success: boolean;
    canceled: boolean;
    error?: string;
  }> => {
    const epoch = getSessionEpoch();
    const res = await enableBiometricSession(epoch);
    if (res.success) {
      setHasBiometricLock(false);
      setIsBiometricActive(true);
    }
    return res;
  }, []);

  const disableBiometricsOnCurrentSession = useCallback(async (): Promise<void> => {
    await disableBiometricSession();
    setIsBiometricActive(false);
    setHasBiometricLock(false);
  }, []);

  const activeVehicle = useMemo(() => {
    if (!vehicles.length) {
      return null;
    }
    return vehicles.find((v) => v.id === activeVehicleId) ?? vehicles[0] ?? null;
  }, [vehicles, activeVehicleId]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      bootError,
      vehicles,
      activeVehicle,
      availableFuelTypes,
      selectedPeriod,
      dataVersion,
      toast,
      prefilledLoginEmail,
      hasBiometricLock,
      isBiometricActive,
      biometricDeviceInfo,
      setPrefilledLoginEmail,
      setSelectedPeriod,
      selectVehicle,
      refreshVehicles,
      createNewVehicle,
      updateExistingVehicle,
      signIn,
      completeTwoFactorSignIn,
      cancelTwoFactorChallenge,
      handlePasswordChanged,
      getCurrentSessionEpoch: getSessionEpoch,
      signUpAndSignIn,
      updateUser,
      signOut,
      retryBootSession: bootstrapSession,
      invalidateFuelData,
      showToast,
      dismissToast,
      unlockWithBiometrics,
      enableBiometricsOnCurrentSession,
      disableBiometricsOnCurrentSession,
    }),
    [
      status,
      user,
      bootError,
      vehicles,
      activeVehicle,
      availableFuelTypes,
      selectedPeriod,
      dataVersion,
      toast,
      prefilledLoginEmail,
      hasBiometricLock,
      isBiometricActive,
      biometricDeviceInfo,
      selectVehicle,
      refreshVehicles,
      createNewVehicle,
      updateExistingVehicle,
      signIn,
      completeTwoFactorSignIn,
      cancelTwoFactorChallenge,
      handlePasswordChanged,
      signUpAndSignIn,
      updateUser,
      signOut,
      bootstrapSession,
      invalidateFuelData,
      showToast,
      dismissToast,
      unlockWithBiometrics,
      enableBiometricsOnCurrentSession,
      disableBiometricsOnCurrentSession,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession deve ser utilizado dentro de SessionProvider');
  }
  return ctx;
}
