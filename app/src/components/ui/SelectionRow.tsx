import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronDownIcon } from '@/components/icons/AppIcons';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export interface SelectionRowProps {
  label: string;
  valueText: string;
  subtitle?: string;
  leftIcon?: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  errorText?: string | null;
  testID?: string;
}

export function SelectionRow({
  label,
  valueText,
  subtitle,
  leftIcon,
  onPress,
  disabled = false,
  errorText,
  testID,
}: SelectionRowProps) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.wrapper}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${valueText}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: colors.bgElevated,
            borderColor: errorText ? colors.dangerBorder : colors.borderDefault,
            opacity: disabled ? 0.5 : pressed ? 0.84 : 1,
          },
        ]}
      >
        <View style={styles.leftGroup}>
          {leftIcon ? (
            <View
              style={[
                styles.iconBadge,
                {
                  backgroundColor: colors.accentSoft,
                },
              ]}
            >
              {leftIcon}
            </View>
          ) : null}
          <View style={styles.textColumn}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
            <Text numberOfLines={1} style={[styles.value, { color: colors.textPrimary }]}>
              {valueText}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={[styles.subtitle, { color: colors.textMuted }]}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        <ChevronDownIcon size={18} color={colors.textSecondary} />
      </Pressable>
      {errorText ? (
        <Text style={[styles.errorText, { color: colors.dangerText }]}>{errorText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 4,
  },
  row: {
    minHeight: 56,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  leftGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
    gap: 1,
  },
  label: {
    ...typography.caption,
  },
  value: {
    ...typography.bodyStrong,
  },
  subtitle: {
    ...typography.caption,
    fontSize: 11,
  },
  errorText: {
    ...typography.caption,
    fontSize: 11,
  },
});
