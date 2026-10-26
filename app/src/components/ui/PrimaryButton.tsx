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
  stepped?: boolean;
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
  stepped = true,
}: PrimaryButtonProps) {
  const { colors, isDark } = useAppTheme();
  const { reduceMotion, duration, easing } = useMotionPolicy();
  const scale = useRef(new Animated.Value(1)).current;

  const isInteractive = !disabled && !loading;

  React.useEffect(() => {
    if (reduceMotion) {
      scale.stopAnimation();
      scale.setValue(1);
    }
  }, [reduceMotion, scale]);

  React.useEffect(() => {
    return () => {
      scale.stopAnimation();
      scale.setValue(1);
    };
  }, [scale]);

  const handlePressIn = () => {
    if (!isInteractive || reduceMotion) return;
    scale.stopAnimation();
    Animated.timing(scale, {
      toValue: 0.98,
      duration: duration('fast'),
      easing: easing.exit,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    if (reduceMotion) return;
    scale.stopAnimation();
    Animated.timing(scale, {
      toValue: 1,
      duration: duration('fast'),
      easing: easing.enter,
      useNativeDriver: true,
    }).start();
  };

  const isPrimary = variant === 'primary';
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

  const useStepped = isPrimary && stepped;

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
          styles.pressableRoot,
          { opacity: disabled && !loading ? 0.52 : 1 },
        ]}
      >
        {({ pressed }) => {
          const currentBg = pressed && isPrimary ? colors.accentPressed : bgColor;
          if (useStepped) {
            return (
              <View style={styles.steppedContainer}>
                {/* Top stepped cap */}
                <View style={[styles.stepCap, { backgroundColor: currentBg }]} />
                {/* Center body */}
                <View style={[styles.stepBody, { backgroundColor: currentBg }]}>
                  {loading ? (
                    <ActivityIndicator size="small" color={textColor} />
                  ) : (
                    <View style={styles.contentRow}>
                      {leftIcon}
                      <Text style={[styles.label, { color: textColor }]}>{label}</Text>
                    </View>
                  )}
                </View>
                {/* Bottom stepped cap */}
                <View style={[styles.stepCap, { backgroundColor: currentBg }]} />
              </View>
            );
          }

          return (
            <View
              style={[
                styles.button,
                {
                  backgroundColor: currentBg,
                  borderColor,
                },
                isPrimary && !isDark ? shadows.lightFloating : null,
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
            </View>
          );
        }}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pressableRoot: {
    width: '100%',
  },
  steppedContainer: {
    width: '100%',
  },
  stepCap: {
    height: 3,
    marginHorizontal: 8,
  },
  stepBody: {
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    fontWeight: '700',
  },
});
