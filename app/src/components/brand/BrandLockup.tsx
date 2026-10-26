import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/theme/ThemeProvider';

const WORDMARK_LIGHT = require('@/assets/brand/wordmark_light_crop.png');
const WORDMARK_DARK = require('@/assets/brand/wordmark_dark_crop.png');

export interface BrandLockupProps {
  mode?: 'header' | 'wordmark-only' | 'auth-login' | 'auth-register';
  subtitle?: string;
  wordmarkWidth?: number;
}

export function BrandLockup({
  mode = 'header',
  wordmarkWidth,
}: BrandLockupProps) {
  const { isDark } = useAppTheme();
  const wordmarkSource = isDark ? WORDMARK_DARK : WORDMARK_LIGHT;

  const w = wordmarkWidth ?? (mode === 'header' ? 156 : mode === 'wordmark-only' ? 144 : 202);
  const h = Math.round(w * (75 / 326));

  return (
    <View style={mode === 'header' ? styles.headerRow : styles.defaultWrapper}>
      <Image
        source={wordmarkSource}
        style={{ width: w, height: h }}
        resizeMode="contain"
        accessibilityLabel="FuelLog"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  defaultWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
