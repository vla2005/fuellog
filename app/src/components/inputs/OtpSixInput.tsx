import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputChangeEvent,
  View,
} from 'react-native';

import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export interface OtpSixInputProps {
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel?: string;
  hasError?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  testID?: string;
}

export interface OtpSelection {
  start: number;
  end: number;
}

/**
 * Aplica a alteração de texto considerando a seleção/caret atual do usuário,
 * permitindo correções pontuais em posições preenchidas e colagens precisas
 * sem ambiguidade de diff.
 */
export function applyOtpInput(
  raw: string,
  prevValue: string,
  selection: OtpSelection = { start: 0, end: 0 },
  nativeSelection?: OtpSelection,
): { value: string; nextSelection: number } {
  const cleanPrev = prevValue.replace(/\D/g, '').slice(0, 6);
  const selStart = Math.min(Math.max(0, selection.start), cleanPrev.length);
  const selEnd = Math.min(Math.max(selStart, selection.end), cleanPrev.length);

  // O texto nativo já contém a inserção, substituição ou exclusão da seleção.
  const insertLen = raw.length - cleanPrev.length + (selEnd - selStart);
  const inserted = raw.slice(selStart, selStart + Math.max(0, insertLen));
  const insertedDigits = inserted.replace(/\D/g, '');

  // Colagem de código completo (>= 6 dígitos): substitui pelo código colado
  if (insertedDigits.length >= 6) {
    const fullCode = insertedDigits.slice(0, 6);
    return { value: fullCode, nextSelection: 6 };
  }

  const nextValue = raw.replace(/\D/g, '').slice(0, 6);
  const rawPosition = nativeSelection?.start ?? Math.max(0, selStart + insertLen);
  const nextSelection = Math.min(nextValue.length, raw.slice(0, rawPosition).replace(/\D/g, '').length);
  return { value: nextValue, nextSelection };
}

/**
 * Função utilitária para normalização simples mantendo compatibilidade.
 */
export function normalizeOtpCode(
  raw: string,
  prevValue = '',
  selection: OtpSelection = { start: 0, end: 0 }
): string {
  return applyOtpInput(raw, prevValue, selection).value;
}

export function OtpSixInput({
  value,
  onChange,
  accessibilityLabel = 'Código de 6 dígitos',
  hasError = false,
  disabled = false,
  autoFocus = false,
  testID,
}: OtpSixInputProps) {
  const { colors } = useAppTheme();
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const selectionRef = useRef<OtpSelection>({ start: 0, end: 0 });
  const previousSelectionRef = useRef<OtpSelection>(selectionRef.current);
  const slotPressedRef = useRef(false);
  const mountedRef = useRef(true);
  const clipboardRequestRef = useRef(0);
  const [isFocused, setIsFocused] = useState(false);
  const [selection, setSelection] = useState<OtpSelection>({ start: 0, end: 0 });

  const cleanValue = value.replace(/\D/g, '').slice(0, 6);
  const latestRef = useRef({ disabled, cleanValue });
  latestRef.current = { disabled, cleanValue };

  const updateSelection = (start: number, end: number) => {
    if (selectionRef.current.start === start && selectionRef.current.end === end) return;
    const sel = { start, end };
    previousSelectionRef.current = selectionRef.current;
    selectionRef.current = sel;
    setSelection(sel);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const { start, end } = selectionRef.current;
    updateSelection(Math.min(start, cleanValue.length), Math.min(end, cleanValue.length));
  }, [cleanValue]);

  useEffect(() => {
    if (disabled) clipboardRequestRef.current += 1;
  }, [disabled]);

  const handleSlotPress = (index: number) => {
    if (disabled) return;
    const targetPos = Math.min(index, cleanValue.length);
    const targetEnd = Math.min(targetPos + 1, cleanValue.length);
    slotPressedRef.current = !isFocused;
    updateSelection(targetPos, targetEnd);
    inputRef.current?.focus();

    if (Platform.OS === 'web' && inputRef.current) {
      const el = inputRef.current as unknown as { setSelectionRange?: (start: number, end: number) => void };
      if (typeof el?.setSelectionRange === 'function') {
        try {
          el.setSelectionRange(targetPos, targetEnd);
        } catch {
          // ignore
        }
      }
    }
  };

  const handleChange = (event: TextInputChangeEvent) => {
    if (disabled) return;
    const raw = event.nativeEvent.text;
    const target = event.target as unknown as { selectionStart?: number; selectionEnd?: number };
    // O mesmo evento traz texto e caret; onSelectionChange pode chegar antes ou depois.
    const nativeSelection = event.nativeEvent.selection ?? (Platform.OS === 'web'
      ? { start: target.selectionStart ?? raw.length, end: target.selectionEnd ?? raw.length }
      : undefined);
    const beforeSelection = [selectionRef.current, previousSelectionRef.current].find(({ start, end }) => {
      const insertedLength = raw.length - cleanValue.length + end - start;
      return insertedLength >= 0 && end <= cleanValue.length
        && (!nativeSelection || start + insertedLength === nativeSelection.start)
        && raw.slice(0, start) === cleanValue.slice(0, start)
        && raw.slice(start + insertedLength) === cleanValue.slice(end);
    }) ?? selectionRef.current;
    const result = applyOtpInput(raw, cleanValue, beforeSelection, nativeSelection);
    onChange(result.value);
    updateSelection(result.nextSelection, result.nextSelection);
  };

  const handlePasteFromClipboard = async () => {
    if (disabled) return;
    const request = ++clipboardRequestRef.current;
    const beforeSelection = { ...selectionRef.current };
    try {
      const text = await Clipboard.getStringAsync();
      if (text && mountedRef.current && request === clipboardRequestRef.current
        && !latestRef.current.disabled && latestRef.current.cleanValue === cleanValue) {
        const result = applyOtpInput(
          cleanValue.slice(0, beforeSelection.start) +
            text +
            cleanValue.slice(beforeSelection.end),
          cleanValue,
          beforeSelection,
        );
        onChange(result.value);
        updateSelection(result.nextSelection, result.nextSelection);
      }
    } catch {
      // Ignora falha de clipboard silenciosamente
    }
  };

  // O slot ativo reflete a posição de seleção/edição do usuário
  const activeSlotIndex = isFocused
    ? (selection.start < cleanValue.length ? selection.start : Math.min(cleanValue.length, 5))
    : -1;

  return (
    <View style={styles.rootContainer}>
      {/* TextInput real subjacente renderizado antes para que os slots fiquem na camada superior para cliques reais */}
      <TextInput
        ref={inputRef}
        value={cleanValue}
        onChange={handleChange}
        selection={isFocused ? selection : undefined}
        onSelectionChange={(e) => {
          const { start, end } = e.nativeEvent.selection;
          if (start > cleanValue.length || end > cleanValue.length) return;
          updateSelection(start, end);
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus={autoFocus}
        editable={!disabled}
        accessibilityLabel={accessibilityLabel}
        aria-label={accessibilityLabel}
        testID={testID}
        onFocus={() => {
          setIsFocused(true);
          if (slotPressedRef.current) {
            slotPressedRef.current = false;
            return;
          }
          const currentPos = Math.min(cleanValue.length, 6);
          updateSelection(currentPos, currentPos);
        }}
        onBlur={() => { slotPressedRef.current = false; setIsFocused(false); }}
        style={styles.hiddenRealInput}
      />

      {/* 6 Quadrados Visuais com suporte a clique direto sem interceptação e toque longo para colar */}
      <View style={styles.slotsRow} accessible={false}>
        {Array.from({ length: 6 }).map((_, index) => {
          const char = cleanValue[index] || '';
          const isSlotActive = isFocused && index === activeSlotIndex;
          const hasChar = Boolean(char);

          return (
            <Pressable
              key={index}
              accessibilityRole="button"
              accessibilityLabel={`Dígito ${index + 1}: ${char || 'vazio'}`}
              onPress={() => handleSlotPress(index)}
              onLongPress={handlePasteFromClipboard}
              disabled={disabled}
              style={[
                styles.slotBox,
                {
                  backgroundColor: colors.surface,
                  borderColor: hasError
                    ? colors.dangerBorder
                    : isSlotActive
                    ? colors.brandPrimary
                    : hasChar
                    ? colors.textSecondary
                    : colors.borderSubtle,
                  borderWidth: isSlotActive ? 2 : 1,
                },
              ]}
            >
              <Text style={[styles.slotDigit, { color: colors.textPrimary }]}>
                {char}
              </Text>
              {isSlotActive && !char ? (
                <View
                  style={[styles.cursorIndicator, { backgroundColor: colors.brandPrimary }]}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    position: 'relative',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  slotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    gap: 8,
    zIndex: 1,
  },
  slotBox: {
    flex: 1,
    height: 52,
    maxWidth: 48,
    minWidth: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    zIndex: 1,
  },
  slotDigit: {
    ...typography.numericInput,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  cursorIndicator: {
    position: 'absolute',
    bottom: 10,
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  hiddenRealInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.01,
    color: 'transparent',
    backgroundColor: 'transparent',
    zIndex: 0,
    ...Platform.select({
      web: {
        outlineStyle: 'none',
        cursor: 'default',
      } as Record<string, unknown>,
    }),
  },
});
