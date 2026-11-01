export type FuelType =
  | 'GASOLINE_REGULAR'
  | 'GASOLINE_ADDITIVE'
  | 'ETHANOL'
  | 'DIESEL_S10'
  | 'DIESEL_S500';

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refresh_token: string;
}

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
}

export interface UpdateMeRequest {
  name: string;
  email: string;
  currentPassword?: string;
  secondFactorCode?: string;
}

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  preferredTimezone: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
  session_id: string;
}

export interface CreateVehicleRequest {
  nickname: string;
  brand?: string | null;
  model?: string | null;
  modelYear?: number | null;
  plate?: string | null;
  tankCapacityLiters?: string | null;
  allowedFuels: FuelType[];
  currentOdometerKm?: number | null;
}

export interface UpdateVehicleRequest {
  model: string;
  allowedFuels: FuelType[];
  currentOdometerKm?: number | null;
  tankCapacityLiters?: string | null;
}

export interface Vehicle {
  id: string;
  nickname: string;
  brand: string | null;
  model: string | null;
  modelYear: number | null;
  plate: string | null;
  tankCapacityLiters: string | null;
  allowedFuels: FuelType[];
  archivedAt: string | null;
  version: number;
  currentOdometerKm?: number | null;
}

export interface UpdateFuelEntryRequest {
  occurredAt: string;
  timezone: string;
  odometerKm: number;
  fuelType: FuelType;
  liters: string;
  unitPrice: string;
  paidTotal: string;
  adjustmentReason?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface CreateFuelEntryRequest {
  id: string;
  occurredAt: string;
  timezone: string;
  odometerKm: number;
  fuelType: FuelType;
  liters: string;
  unitPrice: string;
  paidTotal: string;
  adjustmentReason?: string | null;
  latitude: number;
  longitude: number;
}

export interface FuelEntry {
  id: string;
  occurredAt: string;
  timezone: string;
  odometerKm: number;
  fuelType: FuelType;
  liters: string;
  unitPrice: string;
  paidTotal: string;
  adjustmentReason: string | null;
  vehicleId: string;
  referenceTotal: string;
  adjustmentAmount: string;
  version: number;
  idempotentReplay: boolean;
  latitude: number | null;
  longitude: number | null;
}

export interface FuelEntryPage {
  items: FuelEntry[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  summary: { paidTotal: string; purchasedLiters: string };
  monthlyCounts: { month: string; purchaseCount: number }[];
}

export interface SummaryResponse {
  vehicleId: string;
  from: string | null;
  to: string | null;
  timezone: string;
  purchaseCount: number;
  paidTotal: string;
  purchasedLiters: string;
  weightedPaidPrice: string | null;
}

export interface DashboardMonth {
  month: string; from: string; to: string; purchaseCount: number; paidTotal: string; liters: string;
}
export interface DashboardFuel {
  fuelType: FuelType; purchaseCount: number; paidTotal: string; liters: string; percentage: string | null;
}
export interface DashboardPrice {
  entryId: string; occurredAt: string; fuelType: FuelType; unitPrice: string; liters: string; paidTotal: string;
}
export interface DashboardResponse {
  vehicleId: string; from: string | null; to: string | null; timezone: string; fuelType: FuelType | null;
  purchaseCount: number; paidTotal: string; purchasedLiters: string; weightedUnitPrice: string | null;
  months: DashboardMonth[]; fuels: DashboardFuel[]; prices: DashboardPrice[];
}

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
  correlationId?: string;
}

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'unauthorized';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly problem?: ProblemDetails;
  readonly isUncertainWrite: boolean;

  constructor(options: {
    message: string;
    kind: ApiErrorKind;
    status?: number;
    problem?: ProblemDetails;
    isUncertainWrite?: boolean;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.kind = options.kind;
    this.status = options.status;
    this.problem = options.problem;
    this.isUncertainWrite = Boolean(options.isUncertainWrite);
  }
}

export interface PasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
  secondFactorCode?: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
}

export interface TwoFactorSetupRequest {
  currentPassword: string;
}

export interface TwoFactorSetupResponse {
  secret: string;
  otpauthUri: string;
  expiresAt: string;
}

export interface TwoFactorEnableRequest {
  code: string;
}

export interface TwoFactorRecoveryCodes {
  recoveryCodes: string[];
}

export interface TwoFactorDisableRequest {
  currentPassword: string;
  code: string;
}

export interface TwoFactorChallenge {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: string;
}

export interface TwoFactorVerifyRequest {
  challengeToken: string;
  code: string;
}

export type LoginResult = TokenResponse | TwoFactorChallenge;

export function isTwoFactorChallenge(result: unknown): result is TwoFactorChallenge {
  return (
    typeof result === 'object' &&
    result !== null &&
    'mfaRequired' in result &&
    (result as TwoFactorChallenge).mfaRequired === true
  );
}
