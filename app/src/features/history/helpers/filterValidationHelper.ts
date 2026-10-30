/**
 * Pure helper for validating filter fields using house parseNonNegativeDecimalInput:
 * - Total paid (valor pago): max 2 decimal places, non-negative, max 9999999999.99 (BigInt: 999999999999n)
 * - Liters (litros): max 3 decimal places, non-negative, max 9999999.999 (BigInt: 9999999999n)
 * - Price per liter (preço por litro): max 4 decimal places, non-negative, max 999999.9999 (BigInt: 9999999999n)
 * - Min <= Max validation using BigInt
 * - Civil dates validation (no impossible dates like 2023-02-29, 2024-04-31)
 */
import { isValidIsoDate } from './calendarHelper';
import { parseNonNegativeDecimalInput } from '@/utils/decimal';

export interface DecimalFieldConfig {
  label: string;
  maxDecimals: number;
  maxLimitString: string;
  maxBigInt: bigint;
}

export const TOTAL_PAID_CONFIG: DecimalFieldConfig = {
  label: 'Valor pago',
  maxDecimals: 2,
  maxLimitString: '9999999999.99',
  maxBigInt: 999999999999n,
};

export const LITERS_CONFIG: DecimalFieldConfig = {
  label: 'Litros',
  maxDecimals: 3,
  maxLimitString: '9999999.999',
  maxBigInt: 9999999999n,
};

export const PRICE_PER_LITER_CONFIG: DecimalFieldConfig = {
  label: 'Preço por litro',
  maxDecimals: 4,
  maxLimitString: '999999.9999',
  maxBigInt: 9999999999n,
};

export interface RangeValidationResult {
  valid: boolean;
  minCanonical?: string;
  maxCanonical?: string;
  errorMessage?: string;
}

/**
 * Validates a single decimal string using house parseNonNegativeDecimalInput
 * and checks maximum API bounds using BigInt.
 */
export function validateDecimalField(
  raw: string,
  config: DecimalFieldConfig,
): { valid: boolean; canonicalString?: string; scaledValue?: bigint; errorMessage?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true };
  }

  const parsed = parseNonNegativeDecimalInput(trimmed, config.maxDecimals);
  if (!parsed.valid || parsed.scaledValue === null || parsed.normalizedDot === null) {
    return {
      valid: false,
      errorMessage: `${config.label} inválido (máx: ${config.maxLimitString}, até ${config.maxDecimals} casas decimais)`,
    };
  }

  if (parsed.scaledValue > config.maxBigInt) {
    return {
      valid: false,
      errorMessage: `${config.label} excede o limite máximo permitido (${config.maxLimitString})`,
    };
  }

  return {
    valid: true,
    canonicalString: parsed.normalizedDot,
    scaledValue: parsed.scaledValue,
  };
}

/**
 * Validates a min/max decimal pair:
 * - Each non-empty value must be a valid non-negative decimal within bounds and max decimals.
 * - If both are provided, min <= max (compared using BigInt).
 */
export function validateDecimalRange(
  rawMin: string | undefined | null,
  rawMax: string | undefined | null,
  config: DecimalFieldConfig,
): RangeValidationResult {
  const minResult = rawMin && rawMin.trim() ? validateDecimalField(rawMin, config) : null;
  if (minResult && !minResult.valid) {
    return { valid: false, errorMessage: minResult.errorMessage };
  }

  const maxResult = rawMax && rawMax.trim() ? validateDecimalField(rawMax, config) : null;
  if (maxResult && !maxResult.valid) {
    return { valid: false, errorMessage: maxResult.errorMessage };
  }

  if (minResult?.scaledValue !== undefined && maxResult?.scaledValue !== undefined) {
    if (minResult.scaledValue > maxResult.scaledValue) {
      return {
        valid: false,
        errorMessage: `${config.label}: valor mínimo não pode ser maior que o máximo`,
      };
    }
  }

  return {
    valid: true,
    minCanonical: minResult?.canonicalString,
    maxCanonical: maxResult?.canonicalString,
  };
}

/**
 * Validates date range ISO strings (YYYY-MM-DD):
 * - If provided, must be valid civil dates (no 2023-02-29 or 2024-04-31).
 * - If both provided, from <= to.
 */
export function validateDateRange(
  from?: string | null,
  to?: string | null,
): { valid: boolean; errorMessage?: string } {
  if (from) {
    if (!isValidIsoDate(from)) {
      return { valid: false, errorMessage: `Data inicial inválida: ${from}` };
    }
  }
  if (to) {
    if (!isValidIsoDate(to)) {
      return { valid: false, errorMessage: `Data final inválida: ${to}` };
    }
  }
  if (from && to) {
    if (from > to) {
      return { valid: false, errorMessage: 'Data inicial não pode ser posterior à data final' };
    }
  }
  return { valid: true };
}
