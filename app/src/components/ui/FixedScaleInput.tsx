import React, { useCallback, useMemo } from 'react';
import {
  Platform,
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  TextStyle,
} from 'react-native';
import {
  applyNumericMaskChange,
  formatDigitsToDisplay,
  parseArbitraryInputToDigits,
} from '@/utils/numericMask';

export interface FixedScaleInputProps
  extends Omit<TextInputProps, 'value' | 'onChangeText'> {
  value: string;
  onChangeText: (text: string) => void;
  scale: number;
  maxDigits?: number;
  style?: StyleProp<TextStyle>;
}

export function FixedScaleInput({
  value,
  onChangeText,
  scale,
  maxDigits = 14,
  keyboardType,
  style,
  ...restProps
}: FixedScaleInputProps) {
  const digits = useMemo(() => {
    return parseArbitraryInputToDigits(value, scale, maxDigits);
  }, [value, scale, maxDigits]);

  const formattedDisplay = useMemo(() => {
    if (!value) return '';
    // Se o valor puder ser validado, exibe com a máscara formatada
    if (digits !== null) {
      return formatDigitsToDisplay(digits, scale);
    }
    // Rascunho/valor inválido permanece visível sem ser normalizado para válido ocultando erro
    return value;
  }, [value, digits, scale]);

  const handleChangeText = useCallback(
    (nextText: string) => {
      const currentDigits = digits ?? '';
      const result = applyNumericMaskChange(
        currentDigits,
        formattedDisplay,
        nextText,
        scale,
        maxDigits,
      );
      onChangeText(result.formatted);
    },
    [digits, formattedDisplay, maxDigits, onChangeText, scale],
  );

  return (
    <TextInput
      value={formattedDisplay}
      onChangeText={handleChangeText}
      keyboardType={keyboardType ?? (scale <= 0 ? 'number-pad' : 'decimal-pad')}
      style={[styles.input, style]}
      {...restProps}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    textAlign: 'right',
    minWidth: 0,
    flexShrink: 1,
    ...Platform.select({
      web: {
        outlineStyle: 'none',
        outlineWidth: 0,
      } as any,
    }),
  },
});
