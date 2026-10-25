import React, { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { useMotionPolicy } from '@/motion/useMotionPolicy';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, shadows, typography } from '@/theme/tokens';

export interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  leftIcon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  leftIcon,
  style,
  testID,
  accessibilityLabel,
}: PrimaryButtonProps) {
  const { colors, isDark } = useAppTheme();
  const { reduceMotion, duration, easing } = useMotionPolicy();
  const scale = useRef(new Animated.Value(1)).current;

  const isInteractive = !disabled && !loading;

  const handlePressIn = () => {
    if (!isInteractive || reduceMotion) return;
    Animated.timing(scale, {
      toValue: 0.98,
      duration: duration('fast'),
      easing: easing.exit,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    if (reduceMotion) return;
    Animated.timing(scale, {
      toValue: 1,
      duration: duration('fast'),
      easing: easing.enter,
      useNativeDriver: true,
    }).start();
  };

  const bgColor =
    variant === 'primary'
      ? colors.accentPrimary
      : variant === 'secondary'
        ? colors.bgSecondary
        : variant === 'danger'
          ? colors.dangerSoft
          : 'transparent';

  const borderColor =
    variant === 'primary'
      ? colors.accentPrimary
      : variant === 'secondary'
        ? colors.borderDefault
        : variant === 'danger'
          ? colors.dangerBorder
          : 'transparent';

  const textColor =
    variant === 'primary'
      ? '#FFFFFF'
      : variant === 'danger'
        ? colors.dangerText
        : colors.textPrimary;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: !isInteractive, busy: loading }}
        aria-disabled={!isInteractive}
        aria-busy={loading}
        disabled={!isInteractive}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor:
              pressed && variant === 'primary' ? colors.accentPressed : bgColor,
            borderColor,
            opacity: disabled && !loading ? 0.52 : 1,
          },
          variant === 'primary' && !isDark ? shadows.lightFloating : null,
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={textColor} />
        ) : (
          <View style={styles.contentRow}>
            {leftIcon}
            <Text style={[styles.label, { color: textColor }]}>{label}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 54,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
});
