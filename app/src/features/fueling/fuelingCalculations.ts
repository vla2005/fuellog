import {
  calculateReferenceTotal,
  formatBigIntScaledToDot,
  parseNonNegativeDecimalInput,
  parsePositiveDecimalInput,
} from '../../utils/decimal';
import { formatDigitsToDisplay } from '../../utils/numericMask';

/**
 * Pure BigInt calculation utilities for FuelLog fueling calculations.
 * Single source of truth for volume, pricing and discount consistency rules.
 */

/**
 * Calculates liters = HALF_UP(paidTotal / unitPrice, 3).
 *
 * paidTotal is scale 2 (cents).
 * unitPrice can have scale up to 4.
 * Result is rounded to scale 3 (milliliters) using HALF_UP.
 */
export function calculateLitersFromPaidAndPrice(
  paidInput: string,
  unitPriceInput: string,
): { formattedDisplay: string; normalizedDot: string; scaledLiters: bigint } | null {
  const parsedPaid = parsePositiveDecimalInput(paidInput, 2);
  const parsedPrice = parsePositiveDecimalInput(unitPriceInput, 4);

  if (
    !parsedPaid.valid ||
    !parsedPrice.valid ||
    parsedPaid.scaledValue === null ||
    parsedPrice.scaledValue === null ||
    parsedPaid.scaledValue <= 0n ||
    parsedPrice.scaledValue <= 0n
  ) {
    return null;
  }

  const paidCents = parsedPaid.scaledValue;
  const scaledPrice = parsedPrice.scaledValue;

  // scaledPrice has scale 4 (unitPrice * 10,000)
  // paidCents has scale 2 (paidTotal * 100)
  // liters = (paidCents / 100) / (scaledPrice / 10,000) = (paidCents * 100) / scaledPrice
  // In milliliters (scale 3, liters * 1,000):
  // milliliters = (paidCents * 100 * 1,000) / scaledPrice = (paidCents * 100,000) / scaledPrice
  const numerator = paidCents * 100000n;
  const quotient = numerator / scaledPrice;
  const remainder = numerator % scaledPrice;
  const roundedLiters = remainder * 2n >= scaledPrice ? quotient + 1n : quotient;

  const normalizedDot = formatBigIntScaledToDot(roundedLiters, 3);
  const formattedDisplay = formatDigitsToDisplay(roundedLiters.toString(), 3);

  return {
    formattedDisplay,
    normalizedDot,
    scaledLiters: roundedLiters,
  };
}

/**
 * Calculates reference total = round(liters * unitPrice, 2) using HALF_UP.
 * Reuses calculateReferenceTotal from decimal utils.
 */
export function calculateReferenceTotalCents(
  litersInput: string,
  unitPriceInput: string,
): { cents: bigint; normalizedDot: string } | null {
  const refDot = calculateReferenceTotal(litersInput, unitPriceInput);
  if (refDot === null) {
    return null;
  }
  const parsedRef = parseNonNegativeDecimalInput(refDot, 2);
  if (!parsedRef.valid || parsedRef.scaledValue === null) {
    return null;
  }
  return {
    cents: parsedRef.scaledValue,
    normalizedDot: refDot,
  };
}

/**
 * Checks consistency without discount:
 * 1) liters == HALF_UP(paid / unitPrice, 3)
 * OR
 * 2) reference(liters, unitPrice) == paid
 */
export function isConsistentWithoutDiscount(
  litersInput: string,
  unitPriceInput: string,
  paidInput: string,
): boolean {
  const parsedLiters = parsePositiveDecimalInput(litersInput, 3);
  const parsedPaid = parsePositiveDecimalInput(paidInput, 2);
  const parsedPrice = parsePositiveDecimalInput(unitPriceInput, 4);

  if (
    !parsedLiters.valid ||
    !parsedPaid.valid ||
    !parsedPrice.valid ||
    parsedLiters.scaledValue === null ||
    parsedPaid.scaledValue === null ||
    parsedPrice.scaledValue === null
  ) {
    return false;
  }

  // Check 1: liters == HALF_UP(paid / price, 3)
  const calculated = calculateLitersFromPaidAndPrice(paidInput, unitPriceInput);
  if (calculated && calculated.scaledLiters === parsedLiters.scaledValue) {
    return true;
  }

  // Check 2: reference(liters, price) == paid (in cents)
  const ref = calculateReferenceTotalCents(litersInput, unitPriceInput);
  if (ref && ref.cents === parsedPaid.scaledValue) {
    return true;
  }

  return false;
}

/**
 * Validates discount constraints:
 * With discount:
 * paidTotal <= referenceTotal (round(liters * unitPrice, 2))
 */
export function validateDiscountAmounts(
  litersInput: string,
  unitPriceInput: string,
  paidInput: string,
): { valid: boolean; errorReason?: 'OVERPRICED' | 'INVALID_AMOUNTS'; referenceTotalDot?: string } {
  const parsedPaid = parsePositiveDecimalInput(paidInput, 2);
  const ref = calculateReferenceTotalCents(litersInput, unitPriceInput);

  if (!parsedPaid.valid || parsedPaid.scaledValue === null || !ref) {
    return { valid: false, errorReason: 'INVALID_AMOUNTS' };
  }

  if (parsedPaid.scaledValue > ref.cents) {
    return {
      valid: false,
      errorReason: 'OVERPRICED',
      referenceTotalDot: ref.normalizedDot,
    };
  }

  return {
    valid: true,
    referenceTotalDot: ref.normalizedDot,
  };
}
