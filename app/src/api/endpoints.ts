import { apiRequest, performSingleFlightRefresh } from './client';
import { getSessionEpoch, saveTokenPairAtomically } from './tokenStorage';
import {
  ApiError,
  CreateFuelEntryRequest,
  CreateVehicleRequest,
  CyclesResponse,
  FuelEntry,
  FuelEntryPage,
  FuelType,
  LoginRequest,
  MeResponse,
  RegisterRequest,
  RegisteredUser,
  SummaryResponse,
  TankState,
  TokenResponse,
  UnavailableReason,
  UpdateVehicleRequest,
  UpdateFuelEntryRequest,
  Vehicle,
} from './types';

export async function registerUser(payload: RegisterRequest): Promise<RegisteredUser> {
  return apiRequest<RegisteredUser>({
    method: 'POST',
    path: '/auth/register',
    body: payload,
    authenticated: false,
  });
}

export async function loginUser(payload: LoginRequest): Promise<TokenResponse> {
  const epochBeforeLogin = getSessionEpoch();
  const tokens = await apiRequest<TokenResponse>({
    method: 'POST',
    path: '/auth/login',
    body: payload,
    authenticated: false,
  });
  if (getSessionEpoch() !== epochBeforeLogin) {
    throw new ApiError({
      message: 'Sessão alterada ou encerrada antes da conclusão do login.',
      kind: 'unauthorized',
      status: 401,
    });
  }
  await saveTokenPairAtomically(tokens.access_token, tokens.refresh_token, epochBeforeLogin);
  return tokens;
}

export async function refreshSession(): Promise<TokenResponse> {
  return performSingleFlightRefresh();
}

export async function logoutSession(): Promise<void> {
  await apiRequest<void>({
    method: 'POST',
    path: '/auth/logout',
    authenticated: true,
    retryOn401: true,
  });
}

export async function getMe(): Promise<MeResponse> {
  return apiRequest<MeResponse>({
    method: 'GET',
    path: '/me',
  });
}

export async function getFuelTypes(): Promise<FuelType[]> {
  return apiRequest<FuelType[]>({
    method: 'GET',
    path: '/fuel-types',
  });
}

export async function listVehicles(): Promise<Vehicle[]> {
  return apiRequest<Vehicle[]>({
    method: 'GET',
    path: '/vehicles',
  });
}

export async function createVehicle(payload: CreateVehicleRequest): Promise<Vehicle> {
  return apiRequest<Vehicle>({
    method: 'POST',
    path: '/vehicles',
    body: payload,
  });
}

export async function getVehicle(vehicleId: string): Promise<Vehicle> {
  return apiRequest<Vehicle>({
    method: 'GET',
    path: `/vehicles/${encodeURIComponent(vehicleId)}`,
  });
}

export async function updateVehicle(
  vehicleId: string,
  version: number,
  payload: UpdateVehicleRequest,
): Promise<Vehicle> {
  return apiRequest<Vehicle>({
    method: 'PUT',
    path: `/vehicles/${encodeURIComponent(vehicleId)}`,
    headers: {
      'If-Match': `"${version}"`,
    },
    body: payload,
  });
}

export interface ListFuelEntriesParams {
  from?: string;
  to?: string;
  fuelType?: FuelType | null;
  tankState?: TankState | null;
  page?: number;
  size?: number;
}

export async function listFuelEntries(
  vehicleId: string,
  params: ListFuelEntriesParams = {},
): Promise<FuelEntryPage> {
  return apiRequest<FuelEntryPage>({
    method: 'GET',
    path: `/vehicles/${encodeURIComponent(vehicleId)}/fuel-entries`,
    query: {
      from: params.from,
      to: params.to,
      fuelType: params.fuelType ?? undefined,
      tankState: params.tankState ?? undefined,
      page: params.page ?? 0,
      size: params.size ?? 30,
    },
  });
}

export async function createFuelEntry(
  vehicleId: string,
  payload: CreateFuelEntryRequest,
): Promise<FuelEntry> {
  return apiRequest<FuelEntry>({
    method: 'POST',
    path: `/vehicles/${encodeURIComponent(vehicleId)}/fuel-entries`,
    body: payload,
  });
}

export async function getFuelEntry(vehicleId: string, entryId: string): Promise<FuelEntry> {
  return apiRequest<FuelEntry>({
    method: 'GET',
    path: `/vehicles/${encodeURIComponent(vehicleId)}/fuel-entries/${encodeURIComponent(entryId)}`,
  });
}

export async function updateFuelEntry(
  vehicleId: string,
  entryId: string,
  versionOrETag: number | string,
  payload: UpdateFuelEntryRequest,
): Promise<FuelEntry> {
  const etag =
    typeof versionOrETag === 'number'
      ? `"${versionOrETag}"`
      : versionOrETag.startsWith('"')
        ? versionOrETag
        : `"${versionOrETag}"`;
  return apiRequest<FuelEntry>({
    method: 'PUT',
    path: `/vehicles/${encodeURIComponent(vehicleId)}/fuel-entries/${encodeURIComponent(entryId)}`,
    headers: {
      'If-Match': etag,
    },
    body: payload,
  });
}

export async function getVehicleSummary(
  vehicleId: string,
  params: { from?: string; to?: string } = {},
): Promise<SummaryResponse> {
  return apiRequest<SummaryResponse>({
    method: 'GET',
    path: `/vehicles/${encodeURIComponent(vehicleId)}/summary`,
    query: {
      from: params.from,
      to: params.to,
    },
  });
}

export async function getConsumptionCycles(
  vehicleId: string,
  params: { from?: string; to?: string } = {},
): Promise<CyclesResponse> {
  return apiRequest<CyclesResponse>({
    method: 'GET',
    path: `/vehicles/${encodeURIComponent(vehicleId)}/consumption-cycles`,
    query: {
      from: params.from,
      to: params.to,
    },
  });
}

export const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  GASOLINE_REGULAR: 'Gasolina comum',
  GASOLINE_ADDITIVE: 'Gasolina aditivada',
  ETHANOL: 'Etanol',
  DIESEL_S10: 'Diesel S10',
  DIESEL_S500: 'Diesel S500',
};

export const FUEL_TYPE_SHORT_LABELS: Record<FuelType, string> = {
  GASOLINE_REGULAR: 'Gasolina',
  GASOLINE_ADDITIVE: 'Gas. Aditivada',
  ETHANOL: 'Etanol',
  DIESEL_S10: 'Diesel S10',
  DIESEL_S500: 'Diesel S500',
};

export const TANK_STATE_LABELS: Record<TankState, string> = {
  FULL: 'Tanque cheio',
  PARTIAL: 'Parcial',
  UNKNOWN: 'Não sei',
};

export const TANK_STATE_SHORT_LABELS: Record<TankState, string> = {
  FULL: 'Cheio',
  PARTIAL: 'Parcial',
  UNKNOWN: 'Não sei',
};

export const UNAVAILABLE_REASON_EXPLANATIONS: Record<
  UnavailableReason,
  { badge: string; title: string; description: string }
> = {
  NEEDS_FULL_TANK_BASELINE: {
    badge: 'Falta 1º tanque cheio',
    title: 'Aguardando tanque cheio de referência',
    description:
      'Para iniciar um ciclo válido de consumo, registre pelo menos um abastecimento com "Tanque cheio" como marco inicial.',
  },
  OPEN_CYCLE: {
    badge: 'Ciclo em aberto',
    title: 'Aguardando próximo tanque cheio',
    description:
      'Já existe um tanque cheio inicial, mas o ciclo atual ainda está aberto. O consumo será calculado ao registrar o próximo tanque cheio.',
  },
  HISTORY_GAP: {
    badge: 'Lacuna no histórico',
    title: 'Ciclo interrompido por lacuna anterior',
    description:
      'Um abastecimento foi marcado com lacuna no histórico antes do fechamento do tanque cheio, impedindo o cálculo deste trecho.',
  },
  ZERO_DISTANCE: {
    badge: 'Distância zero',
    title: 'Sem distância percorrida entre marcos',
    description:
      'A distância entre os abastecimentos do ciclo foi zero quilômetros, não permitindo calcular km/L.',
  },
  NO_VALID_CYCLE_IN_PERIOD: {
    badge: 'Sem ciclo no período',
    title: 'Nenhum ciclo fechado neste período',
    description:
      'Não houve fechamento de ciclo válido entre dois tanques cheios dentro do período selecionado.',
  },
};
