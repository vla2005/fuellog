import React, { useState } from 'react';
import {
  KeyboardTypeOptions,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';

import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export interface DecimalFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  helperText?: string;
  errorText?: string | null;
  keyboardType?: KeyboardTypeOptions;
  editable?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function DecimalField({
  label,
  value,
  onChangeText,
  placeholder,
  prefix,
  suffix,
  helperText,
  errorText,
  keyboardType = 'decimal-pad',
  editable = true,
  style,
  testID,
}: DecimalFieldProps) {
  const { colors } = useAppTheme();
  const [focused, setFocused] = useState(false);

  const hasError = Boolean(errorText);
  const borderColor = hasError
    ? colors.dangerBorder
    : focused
      ? colors.accentPrimary
      : colors.borderDefault;

  return (
    <View style={[styles.container, style]}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <View
        style={[
          styles.inputWrapper,
          {
            backgroundColor: editable ? colors.bgElevated : colors.bgSecondary,
            borderColor,
          },
        ]}
      >
        {prefix ? (
          <Text style={[styles.affix, { color: colors.textSecondary }]}>{prefix}</Text>
        ) : null}
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            styles.input,
            {
              color: colors.textPrimary,
            },
          ]}
        />
        {suffix ? (
          <View style={styles.suffixGroup}>
            <View style={[styles.suffixDivider, { backgroundColor: colors.borderDefault }]} />
            <Text style={[styles.suffixText, { color: colors.textSecondary }]}>{suffix}</Text>
          </View>
        ) : null}
      </View>
      {errorText ? (
        <Text style={[styles.errorText, { color: colors.dangerText }]}>{errorText}</Text>
      ) : helperText ? (
        <Text style={[styles.helperText, { color: colors.textMuted }]}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    ...typography.caption,
  },
  inputWrapper: {
    minHeight: 52,
    borderRadius: radii.md,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  input: {
    flex: 1,
    ...typography.numericInput,
    fontSize: 18,
    paddingVertical: 10,
  },
  affix: {
    ...typography.bodyStrong,
    fontSize: 16,
    fontWeight: '700',
  },
  suffixGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 4,
  },
  suffixDivider: {
    width: 1,
    height: 24,
  },
  suffixText: {
    ...typography.bodyStrong,
    fontSize: 15,
    minWidth: 20,
    textAlign: 'center',
  },
  helperText: {
    ...typography.caption,
    fontSize: 11,
  },
  errorText: {
    ...typography.caption,
    fontSize: 11,
  },
});
