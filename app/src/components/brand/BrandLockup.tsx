import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/ThemeProvider';
import { typography } from '@/theme/tokens';

import { PixelMascot } from './PixelMascot';

const WORDMARK_LIGHT = require('@/assets/brand/wordmark_light_crop.png');
const WORDMARK_DARK = require('@/assets/brand/wordmark_dark_crop.png');

export interface BrandLockupProps {
  mode?: 'header' | 'wordmark-only' | 'auth-login' | 'auth-register';
  subtitle?: string;
  wordmarkWidth?: number;
}

export function BrandLockup({
  mode = 'header',
  subtitle,
  wordmarkWidth,
}: BrandLockupProps) {
  const { colors, isDark } = useAppTheme();
  const wordmarkSource = isDark ? WORDMARK_DARK : WORDMARK_LIGHT;

  if (mode === 'header') {
    return (
      <View style={styles.headerRow}>
        <PixelMascot variant="avatar" size={34} withFrame />
        <Image
          source={wordmarkSource}
          style={styles.headerWordmark}
          resizeMode="contain"
          accessibilityLabel="FuelLog"
        />
      </View>
    );
  }

  if (mode === 'wordmark-only') {
    const w = wordmarkWidth ?? 144;
    const h = Math.round(w * (75 / 326));
    return (
      <Image
        source={wordmarkSource}
        style={{ width: w, height: h }}
        resizeMode="contain"
        accessibilityLabel="FuelLog"
      />
    );
  }

  // auth-login: Wordmark GRANDE no topo, Mascote abaixo com sparks diagonais
  const w = wordmarkWidth ?? 202;
  const h = Math.round(w * (75 / 326));

  return (
    <View style={styles.authHero}>
      <Image
        source={wordmarkSource}
        style={{
          width: w,
          height: h,
          marginBottom: 14,
        }}
        resizeMode="contain"
        accessibilityLabel="FuelLog"
      />
      <PixelMascot variant="full" size={114} showSparks />
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerWordmark: {
    width: 112,
    height: 26,
  },
  authHero: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
    marginTop: 8,
  },
});
