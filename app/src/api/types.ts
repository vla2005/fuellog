export type FuelType =
  | 'GASOLINE_REGULAR'
  | 'GASOLINE_ADDITIVE'
  | 'ETHANOL'
  | 'DIESEL_S10'
  | 'DIESEL_S500';

export type TankState = 'FULL' | 'PARTIAL' | 'UNKNOWN';

export type UnavailableReason =
  | 'NEEDS_FULL_TANK_BASELINE'
  | 'OPEN_CYCLE'
  | 'HISTORY_GAP'
  | 'ZERO_DISTANCE'
  | 'NO_VALID_CYCLE_IN_PERIOD';

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
  tankState?: TankState | null;
  historyGapBefore?: boolean | null;
  adjustmentReason?: string | null;
  stationName?: string | null;
  notes?: string | null;
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
  tankState?: TankState | null;
  historyGapBefore?: boolean | null;
  adjustmentReason?: string | null;
  stationName?: string | null;
  notes?: string | null;
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
  tankState: TankState;
  historyGapBefore: boolean;
  adjustmentReason: string | null;
  stationName: string | null;
  notes: string | null;
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
}

export interface ConsumptionCycle {
  startEntryId: string;
  endEntryId: string;
  startedAt: string;
  endedAt: string;
  distanceKm: number;
  liters: string;
  paidTotal: string;
  consumptionKmPerLiter: string | null;
  replacementCostPerKm: string | null;
  fuelTypes: FuelType[];
  mixed: boolean;
  unavailableReason: UnavailableReason | null;
}

export interface CyclesResponse {
  vehicleId: string;
  from: string | null;
  to: string | null;
  timezone: string;
  items: ConsumptionCycle[];
  currentUnavailableReason: UnavailableReason | null;
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
  validCycleCount: number;
  cycleDistanceKm: number;
  cycleLiters: string;
  periodConsumptionKmPerLiter: string | null;
  periodReplacementCostPerKm: string | null;
  periodUnavailableReason: UnavailableReason | null;
  lastValidCycle: ConsumptionCycle | null;
  lastConsumptionUnavailableReason: UnavailableReason | null;
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
