/**
 * Fixed scale right-to-left numeric mask utilities for FuelLog.
 * Masks digits in currency/scale-like fashion:
 * - Scale 3 (Liters): 35125 -> "35,125"
 * - Scale 4 (Unit price): 54321 -> "5,4321"
 * - Scale 2 (Paid total): 10000 -> "100,00"
 * - Scale 0 (Odometer km): 120542 -> "120542"
 */

export function normalizeDigits(rawDigits: string): string {
  if (!rawDigits) return '';
  const clean = rawDigits.replace(/\D/g, '');
  const stripped = clean.replace(/^0+/, '');
  if (stripped.length > 0) return stripped;
  return clean.length > 0 ? '0' : '';
}

export function formatDigitsToDisplay(digits: string, scale: number): string {
  if (!digits) return '';
  const norm = normalizeDigits(digits);
  if (!norm) return '';
  if (scale <= 0) {
    return norm;
  }
  const padded = norm.padStart(scale + 1, '0');
  const intPart = padded.slice(0, padded.length - scale);
  const fracPart = padded.slice(padded.length - scale);
  return `${intPart},${fracPart}`;
}

export function parseArbitraryInputToDigits(
  raw: string | null | undefined,
  scale: number,
  maxDigits = 14,
): string | null {
  if (raw === null || raw === undefined) return '';
  const str = String(raw);
  // Rejeita explicitamente valores negativos
  if (str.includes('-')) {
    return null;
  }

  const trimmed = str.trim();
  if (!trimmed) return '';

  if (scale <= 0) {
    // Whole integer para hodômetro: remove unidade km opcional e valida
    const withoutUnit = trimmed.replace(/\s*(?:km|KM)$/i, '').trim();
    if (!withoutUnit) return '';
    // Rejeita vírgulas ou caracteres não numéricos (nunca aceitar decimais em km)
    if (/[^\d.]/.test(withoutUnit)) {
      return null;
    }
    // Se contiver ponto, deve ser estritamente separador de milhar com blocos de 3
    if (withoutUnit.includes('.')) {
      const parts = withoutUnit.split('.');
      for (let i = 1; i < parts.length; i++) {
        if (parts[i].length !== 3) {
          return null;
        }
      }
    }
    const clean = withoutUnit.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (!clean && withoutUnit.includes('0')) {
      return '0';
    }
    if (clean.length > maxDigits) {
      return null;
    }
    return clean;
  }

  // Remove prefixos de moeda (R$), sufixos de unidade (L) e espaços
  const withoutAffixes = trimmed
    .replace(/^(?:R\$|r\$)\s*/, '')
    .replace(/\s*(?:L|l)$/, '')
    .trim();

  if (!withoutAffixes) return '';

  // Qualquer caractere que não seja dígito, ponto ou vírgula torna o input inválido
  if (/[^\d.,]/.test(withoutAffixes)) {
    return null;
  }

  let intRaw = '';
  let fracRaw = '';

  const hasComma = withoutAffixes.includes(',');
  const hasDot = withoutAffixes.includes('.');

  if (hasComma && hasDot) {
    const lastComma = withoutAffixes.lastIndexOf(',');
    const lastDot = withoutAffixes.lastIndexOf('.');
    if (lastComma > lastDot) {
      // Ex: 1.234,56 -> ponto é milhar, vírgula é decimal
      const intWithDots = withoutAffixes.slice(0, lastComma);
      const dotParts = intWithDots.split('.');
      for (let i = 1; i < dotParts.length; i++) {
        if (dotParts[i].length !== 3) return null;
      }
      intRaw = dotParts.join('');
      fracRaw = withoutAffixes.slice(lastComma + 1);
    } else {
      // Ex: 1,234.56 -> vírgula é milhar, ponto é decimal
      const intWithCommas = withoutAffixes.slice(0, lastDot);
      const commaParts = intWithCommas.split(',');
      for (let i = 1; i < commaParts.length; i++) {
        if (commaParts[i].length !== 3) return null;
      }
      intRaw = commaParts.join('');
      fracRaw = withoutAffixes.slice(lastDot + 1);
    }
  } else if (hasComma) {
    const parts = withoutAffixes.split(',');
    if (parts.length > 2) return null;
    intRaw = parts[0] ?? '';
    fracRaw = parts[1] ?? '';
  } else if (hasDot) {
    const parts = withoutAffixes.split('.');
    if (parts.length > 2) {
      // múltiplos pontos como separadores de milhar
      for (let i = 1; i < parts.length; i++) {
        if (parts[i].length !== 3) return null;
      }
      intRaw = parts.join('');
      fracRaw = '';
    } else {
      intRaw = parts[0] ?? '';
      fracRaw = parts[1] ?? '';
    }
  } else {
    // Apenas inteiros (ex: "35")
    intRaw = withoutAffixes;
    fracRaw = '';
  }

  // Rejeição estrita de escala excessiva (nunca truncar silenciosamente)
  if (fracRaw.length > scale) {
    return null;
  }

  const intClean = intRaw.replace(/\D/g, '').replace(/^0+(?=\d)/, '') || '0';
  const fracClean = fracRaw.replace(/\D/g, '');
  const paddedFrac = fracClean.padEnd(scale, '0');
  const combined = normalizeDigits(intClean + paddedFrac);

  // Rejeição de limite acima de maxDigits (nunca fatiar alterando magnitude)
  if (combined.length > maxDigits) {
    return null;
  }

  return combined;
}

export function applyNumericMaskChange(
  prevDigits: string,
  prevFormatted: string,
  nextText: string,
  scale: number,
  maxDigits = 14,
): { digits: string; formatted: string } {
  // Caso 1: Limpeza completa do campo
  if (!nextText) {
    return { digits: '', formatted: '' };
  }

  // Caso 2: Substituição total por 1 único dígito (ex: selecionou tudo e digitou '9')
  if (nextText.length === 1 && /^\d$/.test(nextText)) {
    return {
      digits: nextText,
      formatted: formatDigitsToDisplay(nextText, scale),
    };
  }

  // Caso 3: Digitação sequencial no final do campo
  if (nextText.length === prevFormatted.length + 1 && nextText.startsWith(prevFormatted)) {
    const singleChar = nextText.slice(-1);
    if (!/^\d$/.test(singleChar)) {
      // Ignora caracteres não numéricos (vírgula, ponto, letras)
      return { digits: prevDigits, formatted: prevFormatted };
    }
    const newDigits = (!prevDigits || prevDigits === '0') ? singleChar : prevDigits + singleChar;
    if (newDigits.length > maxDigits) {
      return { digits: prevDigits, formatted: prevFormatted };
    }
    return {
      digits: newDigits,
      formatted: formatDigitsToDisplay(newDigits, scale),
    };
  }

  // Caso 4: Backspace no final do campo
  if (prevFormatted.length === nextText.length + 1 && prevFormatted.startsWith(nextText)) {
    if (prevDigits.length <= 1) {
      return { digits: '', formatted: '' };
    }
    const newDigits = prevDigits.slice(0, -1);
    return {
      digits: newDigits,
      formatted: formatDigitsToDisplay(newDigits, scale),
    };
  }

  // Caso 5: Edição no meio (remoção/inserção parcial), substituição de seleção ou colagem
  const parsedDigits = parseArbitraryInputToDigits(nextText, scale, maxDigits);
  if (parsedDigits === null) {
    // Rejeita input inválido/excesso de escala/limite mantendo valor anterior
    return { digits: prevDigits, formatted: prevFormatted };
  }

  return {
    digits: parsedDigits,
    formatted: formatDigitsToDisplay(parsedDigits, scale),
  };
}
