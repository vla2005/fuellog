/**
 * Pure BigInt scaled decimal utilities for FuelLog.
 * All API decimal fields use dot-separated strings without binary floating-point rounding errors.
 * Rounding rule: HALF_UP.
 */

export interface ParsedDecimalResult {
  valid: boolean;
  normalizedDot: string | null;
  scaledValue: bigint | null;
  errorReason?: 'EMPTY' | 'INVALID_FORMAT' | 'EXCESSIVE_SCALE' | 'NON_POSITIVE';
}

function parseDecimalInputInternal(
  raw: string,
  maxScale: number,
  allowZero: boolean,
): ParsedDecimalResult {
  const trimmed = raw.trim().replace(/\s+/g, '');
  if (!trimmed) {
    return { valid: false, normalizedDot: null, scaledValue: null, errorReason: 'EMPTY' };
  }

  let candidate = trimmed;
  if (candidate.includes(',') && candidate.includes('.')) {
    candidate = candidate.replace(/\./g, '').replace(',', '.');
  } else if (candidate.includes(',')) {
    candidate = candidate.replace(',', '.');
  }

  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(candidate)) {
    return { valid: false, normalizedDot: null, scaledValue: null, errorReason: 'INVALID_FORMAT' };
  }

  const [intPartRaw, fracPartRaw = ''] = candidate.split('.');
  if (fracPartRaw.length > maxScale) {
    return { valid: false, normalizedDot: null, scaledValue: null, errorReason: 'EXCESSIVE_SCALE' };
  }

  const intClean = intPartRaw.replace(/^0+(?=\d)/, '');
  const paddedFrac = fracPartRaw.padEnd(maxScale, '0');
  const scaled = BigInt(intClean + paddedFrac);

  if (allowZero ? scaled < 0n : scaled <= 0n) {
    return { valid: false, normalizedDot: null, scaledValue: null, errorReason: 'NON_POSITIVE' };
  }

  const normalizedDot = fracPartRaw.length > 0 ? `${intClean}.${fracPartRaw}` : intClean;
  return {
    valid: true,
    normalizedDot,
    scaledValue: scaled,
  };
}

export function parsePositiveDecimalInput(raw: string, maxScale: number): ParsedDecimalResult {
  return parseDecimalInputInternal(raw, maxScale, false);
}

export function parseNonNegativeDecimalInput(raw: string, maxScale: number): ParsedDecimalResult {
  return parseDecimalInputInternal(raw, maxScale, true);
}

export function formatBigIntScaledToDot(value: bigint, scale: number): string {
  const isNegative = value < 0n;
  const abs = isNegative ? -value : value;
  const str = abs.toString().padStart(scale + 1, '0');
  const intPart = str.slice(0, str.length - scale);
  const fracPart = str.slice(str.length - scale);
  return `${isNegative ? '-' : ''}${intPart}.${fracPart}`;
}

/**
 * referenceTotal = round(liters * unitPrice, 2) using HALF_UP.
 * liters has scale 3, unitPrice has scale 4 -> product has scale 7.
 * To round scale 7 to scale 2 (divide by 10^5 = 100000):
 */
export function calculateReferenceTotal(litersInput: string, unitPriceInput: string): string | null {
  const liters = parsePositiveDecimalInput(litersInput, 3);
  const unitPrice = parsePositiveDecimalInput(unitPriceInput, 4);
  if (!liters.valid || !unitPrice.valid || liters.scaledValue === null || unitPrice.scaledValue === null) {
    return null;
  }

  const productScale7 = liters.scaledValue * unitPrice.scaledValue;
  const divisor = 100000n;
  const half = 50000n;
  const cents = (productScale7 + half) / divisor;
  return formatBigIntScaledToDot(cents, 2);
}

/**
 * adjustmentAmount = paidTotal - referenceTotal (both scale 2).
 * Paid total must be strictly positive (> 0), whereas referenceTotal can be 0.00 when
 * tiny positive liters * unitPrice rounds to 0.00 HALF_UP.
 * Requires adjustmentReason when abs(adjustmentAmount) > 0.05 (5 cents).
 */
export function calculateAdjustment(
  paidTotalInput: string,
  referenceTotalDot: string | null,
): {
  validPaid: boolean;
  paidTotalDot: string | null;
  adjustmentDot: string | null;
  diffCents: bigint;
  requiresReason: boolean;
} {
  const paid = parsePositiveDecimalInput(paidTotalInput, 2);
  if (!paid.valid || paid.scaledValue === null) {
    return {
      validPaid: false,
      paidTotalDot: null,
      adjustmentDot: null,
      diffCents: 0n,
      requiresReason: false,
    };
  }

  const paidFixedDot = formatBigIntScaledToDot(paid.scaledValue, 2);
  if (referenceTotalDot === null || referenceTotalDot === undefined || referenceTotalDot === '') {
    return {
      validPaid: true,
      paidTotalDot: paidFixedDot,
      adjustmentDot: null,
      diffCents: 0n,
      requiresReason: false,
    };
  }

  const ref = parseNonNegativeDecimalInput(referenceTotalDot, 2);
  if (!ref.valid || ref.scaledValue === null) {
    return {
      validPaid: true,
      paidTotalDot: paidFixedDot,
      adjustmentDot: null,
      diffCents: 0n,
      requiresReason: false,
    };
  }

  const diffCents = paid.scaledValue - ref.scaledValue;
  const absDiff = diffCents < 0n ? -diffCents : diffCents;
  return {
    validPaid: true,
    paidTotalDot: paidFixedDot,
    adjustmentDot: formatBigIntScaledToDot(diffCents, 2),
    diffCents,
    requiresReason: absDiff > 5n,
  };
}

function addThousandDots(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatDecimalBR(dotStr: string | null | undefined, minDecimals: number, maxDecimals: number): string {
  if (dotStr === null || dotStr === undefined || dotStr === '') return '—';
  const trimmed = dotStr.trim();
  const isNeg = trimmed.startsWith('-');
  const unsigned = isNeg ? trimmed.slice(1) : trimmed;
  const [intRaw = '0', fracRaw = ''] = unsigned.split('.');
  const intFormatted = addThousandDots(intRaw.replace(/^0+(?=\d)/, '') || '0');

  let frac = fracRaw.slice(0, maxDecimals);
  while (frac.length < minDecimals) {
    frac += '0';
  }

  return `${isNeg ? '− ' : ''}${intFormatted}${frac.length > 0 ? `,${frac}` : ''}`;
}

export function formatCurrencyBRL(dotStr: string | null | undefined): string {
  if (dotStr === null || dotStr === undefined || dotStr === '') return 'R$ 0,00';
  const trimmed = dotStr.trim();
  const isNeg = trimmed.startsWith('-');
  const unsigned = isNeg ? trimmed.slice(1) : trimmed;
  const formatted = formatDecimalBR(unsigned, 2, 2);
  return `${isNeg ? '− R$ ' : 'R$ '}${formatted}`;
}

export function formatLitersBR(dotStr: string | null | undefined, includeUnit = true): string {
  if (dotStr === null || dotStr === undefined || dotStr === '') {
    return includeUnit ? '0,000 L' : '0,000';
  }
  const formatted = formatDecimalBR(dotStr, 3, 3);
  return includeUnit ? `${formatted} L` : formatted;
}

export function formatUnitPriceBR(dotStr: string | null | undefined, compactTwoDecimals = false): string {
  if (dotStr === null || dotStr === undefined || dotStr === '') return '—';
  if (compactTwoDecimals) {
    const parsed = parsePositiveDecimalInput(dotStr, 4);
    if (parsed.valid && parsed.scaledValue !== null) {
      const cents = (parsed.scaledValue + 50n) / 100n;
      return `R$ ${formatDecimalBR(formatBigIntScaledToDot(cents, 2), 2, 2)}`;
    }
  }
  const [, frac = ''] = dotStr.split('.');
  const trimmedFrac = frac.replace(/0+$/, '');
  const decimals = Math.max(2, Math.min(4, trimmedFrac.length));
  return `R$ ${formatDecimalBR(dotStr, decimals, decimals)}`;
}

/**
 * Formats consumption in 2 decimal places (e.g., 12,57 km/L).
 * Never returns 0 km/L when null/unavailable.
 */
export function formatConsumptionBR(dotStr: string | null | undefined): string | null {
  if (dotStr === null || dotStr === undefined || dotStr === '') return null;
  return `${formatDecimalBR(dotStr, 2, 2)} km/L`;
}

export function formatOdometerBR(km: number | string | null | undefined, includeUnit = true): string {
  if (km === null || km === undefined || km === '') return '—';
  const intStr = String(km).replace(/\D/g, '');
  if (!intStr) return '—';
  const formatted = addThousandDots(intStr);
  return includeUnit ? `${formatted} km` : formatted;
}
