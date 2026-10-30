import React from 'react';
import {
  Image,
  Pressable,
  StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { BrandLockup } from '@/components/brand/BrandLockup';
import { ChevronLeftIcon } from '@/components/icons/AppIcons';
import { useAppTheme } from '@/theme/ThemeProvider';
import { layout, radii } from '@/theme/tokens';

const SCENE_DAY = require('@/assets/brand/scene_day_road_integrated.png');
const SCENE_NIGHT = require('@/assets/brand/scene_night_road_integrated.png');

export interface AuthSceneHeroProps {
  mode?: 'login' | 'register';
  onBack?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function AuthSceneHero({
  mode = 'login',
  onBack,
  style,
}: AuthSceneHeroProps) {
  const { colors, isDark } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const sceneSource = isDark ? SCENE_NIGHT : SCENE_DAY;
  const sourceInfo =
    typeof Image.resolveAssetSource === 'function'
      ? Image.resolveAssetSource(sceneSource)
      : null;
  const imgWidth = sourceInfo?.width || (isDark ? 1160 : 1161);
  const imgHeight = sourceInfo?.height || 1355;
  const aspectRatio = imgHeight / imgWidth;
  const totalImageHeight = Math.round(windowWidth * aspectRatio);

  // Landscape features, car and gravel roadside finish around 68% of image height.
  // Cutting the empty solid tail keeps layout compact with zero large gaps.
  const heroHeight = Math.round(totalImageHeight * 0.68);
  const topPadding = Math.max(insets.top + 6, 14);

  return (
    <View
      style={[
        styles.heroContainer,
        { height: heroHeight, backgroundColor: colors.bgPrimary },
        style,
      ]}
    >
      <Image
        source={sceneSource}
        style={[
          styles.heroImage,
          {
            width: windowWidth,
            height: totalImageHeight,
          },
        ]}
        resizeMode="cover"
        pointerEvents="none"
        accessibilityLabel={
          isDark
            ? 'Cena noturna com Renault, mascote e estrada'
            : 'Cena diurna com Renault, mascote e estrada'
        }
      />

      {/* SVG Gradient over empty tail at bottom */}
      <Svg
        height={52}
        width="100%"
        style={styles.heroTailGradient}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="authRoadTailGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.bgPrimary} stopOpacity="0" />
            <Stop offset="0.6" stopColor={colors.bgPrimary} stopOpacity="0.65" />
            <Stop offset="1" stopColor={colors.bgPrimary} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={52} fill="url(#authRoadTailGrad)" />
      </Svg>

      {/* Top Header over the calm sky */}
      <View
        style={[styles.heroContent, { paddingTop: topPadding }]}
        pointerEvents="box-none"
      >
        <View style={styles.heroInnerContainer} pointerEvents="box-none">
          {mode === 'register' ? (
            <View style={styles.topHeaderRow} pointerEvents="box-none">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Voltar para login"
                onPress={onBack}
                style={[
                  styles.backSquare,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderSubtle,
                  },
                ]}
              >
                <ChevronLeftIcon size={20} color={colors.accentPrimary} />
              </Pressable>
              <BrandLockup mode="wordmark-only" wordmarkWidth={148} />
              <View style={styles.headerRightSpacer} />
            </View>
          ) : (
            <View style={styles.topHeaderCentered} pointerEvents="box-none">
              <BrandLockup mode="wordmark-only" wordmarkWidth={160} />
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroContainer: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  heroTailGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  heroContent: {
    width: '100%',
    zIndex: 2,
  },
  heroInnerContainer: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    paddingHorizontal: layout.horizontalPadding,
  },
  topHeaderCentered: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  topHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 42,
  },
  backSquare: {
    width: 42,
    height: 42,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRightSpacer: {
    width: 42,
  },
});
