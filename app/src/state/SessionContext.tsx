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

import { setOnUnauthorizedListener } from '@/api/client';
import {
  createVehicle as apiCreateVehicle,
  getFuelTypes,
  getMe,
  listVehicles,
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
} from '@/api/endpoints';
import {
  bumpSessionEpoch,
  clearStoredTokens,
  getAccessToken,
  getRefreshToken,
  getScopedVehicleStorageKey,
  getSessionEpoch,
} from '@/api/tokenStorage';
import {
  ApiError,
  CreateVehicleRequest,
  FuelType,
  LoginRequest,
  MeResponse,
  RegisterRequest,
  Vehicle,
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
  setPrefilledLoginEmail: (email: string) => void;
  setSelectedPeriod: (period: MonthPeriodOption) => void;
  selectVehicle: (vehicleId: string) => Promise<void>;
  refreshVehicles: () => Promise<Vehicle[]>;
  createNewVehicle: (payload: CreateVehicleRequest) => Promise<Vehicle>;
  signIn: (payload: LoginRequest) => Promise<void>;
  signUpAndSignIn: (
    payload: RegisterRequest,
  ) => Promise<{ registeredOnly: boolean; email: string; loginError?: string }>;
  signOut: () => Promise<void>;
  retryBootSession: () => Promise<void>;
  invalidateFuelData: () => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: () => void;
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
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearInMemoryUserData = useCallback(() => {
    setUser(null);
    setVehicles([]);
    setActiveVehicleId(null);
    setBootError(null);
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

  const signIn = useCallback(
    async (payload: LoginRequest) => {
      const epoch = bumpSessionEpoch();
      await loginUser({
        email: payload.email.trim(),
        password: payload.password,
      });

      if (getSessionEpoch() !== epoch) {
        return;
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
      setPrefilledLoginEmail(me.email);
      setBootError(null);
      setStatus('authenticated');
    },
    [loadUserWorkspace],
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

  const invalidateFuelData = useCallback(() => {
    setDataVersion((v) => v + 1);
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
      setPrefilledLoginEmail,
      setSelectedPeriod,
      selectVehicle,
      refreshVehicles,
      createNewVehicle,
      signIn,
      signUpAndSignIn,
      signOut,
      retryBootSession: bootstrapSession,
      invalidateFuelData,
      showToast,
      dismissToast,
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
      selectVehicle,
      refreshVehicles,
      createNewVehicle,
      signIn,
      signUpAndSignIn,
      signOut,
      bootstrapSession,
      invalidateFuelData,
      showToast,
      dismissToast,
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
