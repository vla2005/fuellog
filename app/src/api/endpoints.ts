import { apiRequest, performSingleFlightRefresh } from './client';
import { getSessionEpoch, saveTokenPairAtomically } from './tokenStorage';
import {
  ApiError,
  CreateFuelEntryRequest,
  CreateVehicleRequest,
  DashboardResponse,
  FuelEntry,
  FuelEntryPage,
  FuelType,
  LoginRequest,
  LoginResult,
  MeResponse,
  PasswordChangeRequest,
  RegisterRequest,
  RegisteredUser,
  SummaryResponse,
  TokenResponse,
  TwoFactorDisableRequest,
  TwoFactorEnableRequest,
  TwoFactorRecoveryCodes,
  TwoFactorSetupRequest,
  TwoFactorSetupResponse,
  TwoFactorStatus,
  TwoFactorVerifyRequest,

  UpdateMeRequest,
  UpdateVehicleRequest,
  UpdateFuelEntryRequest,
  Vehicle,
  ViKashStatus, ViKashCatalog, ViKashPreferences, ViKashRemoteStatus, ViKashDeletions,
  isTwoFactorChallenge,
} from './types';

export function getViKashStatus(): Promise<ViKashStatus> {
  return apiRequest({ method: 'GET', path: '/integrations/vikash' });
}
export function getViKashDeletions(page = 0): Promise<ViKashDeletions> {
  return apiRequest({ method: 'GET', path: '/integrations/vikash/deletions', query: { page } });
}
export function getViKashCatalog(): Promise<ViKashCatalog> {
  return apiRequest({ method: 'GET', path: '/integrations/vikash/catalog' });
}
export function saveViKashPreferences(body: ViKashPreferences): Promise<ViKashPreferences> {
  return apiRequest({ method: 'PUT', path: '/integrations/vikash/preferences', body });
}
export function startViKashAuthorization(platform: 'web' | 'native'): Promise<{ authorizationUrl: string; returnUrl: string }> {
  return apiRequest({ method: 'POST', path: '/integrations/vikash/authorizations', body: { platform } });
}
export function cancelViKashAuthorization(): Promise<void> {
  return apiRequest({ method: 'DELETE', path: '/integrations/vikash/authorizations' });
}
export function disconnectViKash(): Promise<{ remoteRevoked: boolean }> {
  return apiRequest({ method: 'DELETE', path: '/integrations/vikash' });
}
export function getViKashRemoteStatus(entryId: string): Promise<ViKashRemoteStatus> {
  return apiRequest({ method: 'GET', path: `/integrations/vikash/entries/${encodeURIComponent(entryId)}/remote` });
}
export function retryViKashEntry(entryId: string, resolution: 'RETRY' | 'OVERWRITE', remoteEtag?: string | null): Promise<void> {
  return apiRequest({ method: 'POST', path: `/integrations/vikash/entries/${encodeURIComponent(entryId)}/retry`, body: { resolution, remoteEtag } });
}

export async function registerUser(payload: RegisterRequest): Promise<RegisteredUser> {
  return apiRequest<RegisteredUser>({
    method: 'POST',
    path: '/auth/register',
    body: payload,
    authenticated: false,
  });
}

export async function loginUser(payload: LoginRequest): Promise<LoginResult> {
  const epochBeforeLogin = getSessionEpoch();
  const result = await apiRequest<LoginResult>({
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
  if (isTwoFactorChallenge(result)) {
    return result;
  }
  await saveTokenPairAtomically(result.access_token, result.refresh_token, epochBeforeLogin);
  return result;
}

export async function verifyTwoFactor(
  payload: TwoFactorVerifyRequest,
): Promise<TokenResponse> {
  const epochBeforeVerify = getSessionEpoch();
  const tokens = await apiRequest<TokenResponse>({
    method: 'POST',
    path: '/auth/2fa/verify',
    body: payload,
    authenticated: false,
    retryOn401: false,
  });
  if (getSessionEpoch() !== epochBeforeVerify) {
    throw new ApiError({
      message: 'Sessão alterada ou encerrada antes da conclusão do login.',
      kind: 'unauthorized',
      status: 401,
    });
  }
  await saveTokenPairAtomically(tokens.access_token, tokens.refresh_token, epochBeforeVerify);
  return tokens;
}

export async function changePassword(
  payload: PasswordChangeRequest,
): Promise<void> {
  await apiRequest<void>({
    method: 'POST',
    path: '/me/password',
    body: payload,
    authenticated: true,
  });
}

export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  return apiRequest<TwoFactorStatus>({
    method: 'GET',
    path: '/me/2fa',
    authenticated: true,
  });
}

export async function setupTwoFactor(
  payload: TwoFactorSetupRequest,
): Promise<TwoFactorSetupResponse> {
  return apiRequest<TwoFactorSetupResponse>({
    method: 'POST',
    path: '/me/2fa/setup',
    body: payload,
    authenticated: true,
  });
}

export async function enableTwoFactor(
  payload: TwoFactorEnableRequest,
): Promise<TwoFactorRecoveryCodes> {
  return apiRequest<TwoFactorRecoveryCodes>({
    method: 'POST',
    path: '/me/2fa/enable',
    body: payload,
    authenticated: true,
  });
}

export async function disableTwoFactor(
  payload: TwoFactorDisableRequest,
): Promise<void> {
  await apiRequest<void>({
    method: 'POST',
    path: '/me/2fa/disable',
    body: payload,
    authenticated: true,
  });
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

export async function updateMe(payload: UpdateMeRequest): Promise<MeResponse> {
  return apiRequest<MeResponse>({
    method: 'PATCH',
    path: '/me',
    body: payload,
    authenticated: true,
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
  occurredFrom?: string;
  occurredTo?: string;
  entryId?: string;
  from?: string;
  to?: string;
  fuelType?: FuelType | null;
  timezone?: string;
  minTotalPaid?: string | null;
  maxTotalPaid?: string | null;
  minLiters?: string | null;
  maxLiters?: string | null;
  minPricePerLiter?: string | null;
  maxPricePerLiter?: string | null;
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
      timezone: params.timezone ?? 'America/Sao_Paulo',
      fuelType: params.fuelType ?? undefined,
      occurredFrom: params.occurredFrom,
      occurredTo: params.occurredTo,
      entryId: params.entryId,
      minTotalPaid: params.minTotalPaid ?? undefined,
      maxTotalPaid: params.maxTotalPaid ?? undefined,
      minLiters: params.minLiters ?? undefined,
      maxLiters: params.maxLiters ?? undefined,
      minPricePerLiter: params.minPricePerLiter ?? undefined,
      maxPricePerLiter: params.maxPricePerLiter ?? undefined,
      page: params.page ?? 0,
      size: params.size ?? 20,
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

export async function deleteFuelEntry(vehicleId: string, entryId: string, version: number): Promise<void> {
  await apiRequest<void>({
    method: 'DELETE',
    path: `/vehicles/${encodeURIComponent(vehicleId)}/fuel-entries/${encodeURIComponent(entryId)}`,
    headers: { 'If-Match': `"${version}"` },
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

export interface DashboardParams { from?: string | null; to?: string | null; timezone: string; fuelType?: FuelType | null }
export async function getDashboard(vehicleId: string, params: DashboardParams): Promise<DashboardResponse> {
  return apiRequest<DashboardResponse>({ method: 'GET', path: `/vehicles/${encodeURIComponent(vehicleId)}/dashboard`,
    query: { from: params.from ?? undefined, to: params.to ?? undefined, timezone: params.timezone, fuelType: params.fuelType ?? undefined } });
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
