import React, { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';

import { useMotionPolicy } from '@/motion/useMotionPolicy';
import { useAppTheme } from '@/theme/ThemeProvider';

export type PixelMascotVariant = 'full' | 'avatar';

export interface PixelMascotProps {
  variant?: PixelMascotVariant;
  size?: number;
  withFrame?: boolean;
  showSparks?: boolean;
  pulseKey?: number | string;
}

const MASCOT_FULL_SOURCE = require('@/assets/brand/mascote_crop.png');
const MASCOT_AVATAR_SOURCE = require('@/assets/brand/mascote_avatar_crop.png');

export function DiagonalPixelSpark({
  size = 7,
  topLeftColor = '#3B82F6',
  bottomRightColor = '#1F5EFF',
}: {
  size?: number;
  topLeftColor?: string;
  bottomRightColor?: string;
}) {
  return (
    <View
      style={{
        width: size * 2,
        height: size * 2,
        position: 'relative',
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          backgroundColor: topLeftColor,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size,
          left: size,
          width: size,
          height: size,
          backgroundColor: bottomRightColor,
        }}
      />
    </View>
  );
}

export function PixelMascot({
  variant = 'full',
  size = 84,
  withFrame = false,
  showSparks = false,
  pulseKey,
}: PixelMascotProps) {
  const { colors, isDark } = useAppTheme();
  const { reduceMotion, duration, easing } = useMotionPolicy();
  const translateY = useRef(new Animated.Value(6)).current;
  const scale = useRef(new Animated.Value(0.97)).current;

  useEffect(() => {
    if (reduceMotion) {
      translateY.setValue(0);
      scale.setValue(1);
      return;
    }

    translateY.setValue(4);
    scale.setValue(0.97);

    const anim = Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: duration('standard'),
        easing: easing.enter,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: duration('standard'),
        easing: easing.enter,
        useNativeDriver: true,
      }),
    ]);

    anim.start();
    return () => {
      anim.stop();
    };
  }, [duration, easing.enter, pulseKey, reduceMotion, scale, translateY]);

  const source = variant === 'avatar' ? MASCOT_AVATAR_SOURCE : MASCOT_FULL_SOURCE;
  const aspect = variant === 'avatar' ? 1 : 272 / 302;
  const imageWidth = size;
  const imageHeight = Math.round(size / aspect);

  return (
    <Animated.View
      style={[
        styles.wrapper,
        withFrame && {
          width: size + 12,
          height: size + 12,
          borderRadius: 16,
          backgroundColor: colors.brandSoft,
          borderWidth: 1,
          borderColor: colors.borderSubtle,
        },
        {
          transform: [{ translateY }, { scale }],
        },
      ]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Mascote FuelLog"
    >
      {showSparks ? (
        <>
          <View style={styles.sparkLeft}>
            <DiagonalPixelSpark size={7} />
          </View>
          <View style={styles.sparkRight}>
            <DiagonalPixelSpark size={7} />
          </View>
        </>
      ) : null}
      <Image
        source={source}
        style={{
          width: imageWidth,
          height: imageHeight,
        }}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sparkLeft: {
    position: 'absolute',
    left: -26,
    top: '44%',
  },
  sparkRight: {
    position: 'absolute',
    right: -26,
    top: '50%',
  },
});
