import React from 'react';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';

import { useAppTheme } from '@/theme/ThemeProvider';
import { radii } from '@/theme/tokens';

export interface IconButtonProps {
  icon: React.ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'surface' | 'subtle' | 'accent';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  disabled = false,
  variant = 'surface',
  style,
  testID,
}: IconButtonProps) {
  const { colors } = useAppTheme();

  const backgroundColor =
    variant === 'accent'
      ? colors.accentSoft
      : variant === 'surface'
        ? colors.bgElevated
        : colors.bgSecondary;

  const borderColor =
    variant === 'accent' ? colors.borderStrong : colors.borderDefault;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor,
          borderColor,
          opacity: disabled ? 0.45 : pressed ? 0.78 : 1,
        },
        style,
      ]}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
