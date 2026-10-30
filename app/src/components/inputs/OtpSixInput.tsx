import * as Clipboard from 'expo-clipboard';
import React, { useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
  selection: OtpSelection = { start: 0, end: 0 }
): { value: string; nextSelection: number } {
  const cleanPrev = prevValue.replace(/\D/g, '').slice(0, 6);
  const selStart = Math.min(Math.max(0, selection.start), cleanPrev.length);
  const selEnd = Math.min(Math.max(selStart, selection.end), cleanPrev.length);

  // Caso 1: Deleção (backspace)
  if (raw.length < cleanPrev.length) {
    const cleanRaw = raw.replace(/\D/g, '').slice(0, 6);
    const nextPos = Math.max(0, selStart === selEnd ? selStart - 1 : selStart);
    return { value: cleanRaw, nextSelection: Math.min(cleanRaw.length, nextPos) };
  }

  // Caso 2: Conteúdo inserido com base na posição da seleção prévia
  const insertLen = raw.length - cleanPrev.length + (selEnd - selStart);
  const inserted = raw.slice(selStart, selStart + insertLen);
  const insertedDigits = inserted.replace(/\D/g, '');

  // Colagem de código completo (>= 6 dígitos): substitui pelo código colado
  if (insertedDigits.length >= 6) {
    const fullCode = insertedDigits.slice(0, 6);
    return { value: fullCode, nextSelection: 6 };
  }

  // Digitação de 1 dígito para correção ou avanço
  if (insertedDigits.length === 1) {
    if (selStart < cleanPrev.length) {
      // Substitui o dígito selecionado e avança para o quadrado seguinte
      const replaced = cleanPrev.slice(0, selStart) + insertedDigits + cleanPrev.slice(selStart + 1);
      const nextPos = Math.min(6, selStart + 1);
      return { value: replaced, nextSelection: nextPos };
    }
    // Inserção no fim (quando há menos de 6 dígitos)
    const appended = (cleanPrev + insertedDigits).slice(0, 6);
    return { value: appended, nextSelection: Math.min(6, cleanPrev.length + 1) };
  }

  // Colagem parcial (> 1 e < 6 dígitos)
  if (insertedDigits.length > 1) {
    const combined = (cleanPrev.slice(0, selStart) + insertedDigits + cleanPrev.slice(selStart + insertedDigits.length)).slice(0, 6);
    return { value: combined, nextSelection: Math.min(6, selStart + insertedDigits.length) };
  }

  return { value: cleanPrev, nextSelection: selStart };
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
  const slotPressedRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);
  const [selection, setSelection] = useState<OtpSelection>({ start: 0, end: 0 });

  const cleanValue = value.replace(/\D/g, '').slice(0, 6);

  const updateSelection = (start: number, end: number) => {
    const sel = { start, end };
    selectionRef.current = sel;
    setSelection(sel);
  };

  const handleSlotPress = (index: number) => {
    if (disabled) return;
    const targetPos = Math.min(index, cleanValue.length);
    slotPressedRef.current = true;
    updateSelection(targetPos, targetPos);
    inputRef.current?.focus();

    if (Platform.OS === 'web' && inputRef.current) {
      const el = inputRef.current as unknown as { setSelectionRange?: (start: number, end: number) => void };
      if (typeof el?.setSelectionRange === 'function') {
        try {
          el.setSelectionRange(targetPos, targetPos);
        } catch {
          // ignore
        }
      }
    }
  };

  const handleTextChange = (raw: string) => {
    const result = applyOtpInput(raw, cleanValue, selectionRef.current);
    onChange(result.value);
    updateSelection(result.nextSelection, result.nextSelection);
  };

  const handlePasteFromClipboard = async () => {
    if (disabled) return;
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        handleTextChange(
          cleanValue.slice(0, selectionRef.current.start) +
            text +
            cleanValue.slice(selectionRef.current.end)
        );
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
        onChangeText={handleTextChange}
        selection={isFocused ? selection : undefined}
        onSelectionChange={(e) => {
          selectionRef.current = e.nativeEvent.selection;
          setSelection(e.nativeEvent.selection);
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
        onBlur={() => setIsFocused(false)}
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
