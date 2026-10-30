import { usePathname, useRouter } from 'expo-router';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLockup } from '@/components/brand/BrandLockup';
import { SettingsIcon } from '@/components/icons/AppIcons';
import { PixelMascot } from '@/components/brand/PixelMascot';
import { AccountScreen } from '@/features/account/AccountScreen';
import { NewFuelEntryScreen } from '@/features/fueling/NewFuelEntryScreen';
import { FuelEntryDetailScreen } from '@/features/history/FuelEntryDetailScreen';
import { HistoryScreen } from '@/features/history/HistoryScreen';
import { HomeScreen } from '@/features/home/HomeScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { VehiclesScreen } from '@/features/vehicles/VehiclesScreen';
import { useMotionPolicy } from '@/motion/useMotionPolicy';
import { useAppTheme } from '@/theme/ThemeProvider';
import { layout } from '@/theme/tokens';

import { DockTabKey, FloatingDock } from './FloatingDock';

export type AuthenticatedViewKey =
  | 'home'
  | 'history'
  | 'vehicles'
  | 'settings'
  | 'fueling-new'
  | 'fueling-detail'
  | 'account';

const VIEW_ORDER: Record<AuthenticatedViewKey, number> = {
  home: 0,
  history: 1,
  vehicles: 2,
  settings: 3,
  'fueling-new': 4,
  'fueling-detail': 5,
  account: 6,
};

export interface ResolvedAuthenticatedRoute {
  view: AuthenticatedViewKey;
  tab: DockTabKey | null;
  detailEntryId: string | null;
}

export function resolveAuthenticatedRoute(
  pathname: string,
): ResolvedAuthenticatedRoute {
  if (pathname === '/fueling/new' || pathname.startsWith('/fueling/new/')) {
    return { view: 'fueling-new', tab: null, detailEntryId: null };
  }
  const detailMatch = /^\/fueling\/([^/]+)/.exec(pathname);
  if (detailMatch && detailMatch[1] && detailMatch[1] !== 'new') {
    let decoded = detailMatch[1];
    try {
      decoded = decodeURIComponent(detailMatch[1]);
    } catch {
      // Mantém segmento bruto caso decode falhe
    }
    return { view: 'fueling-detail', tab: null, detailEntryId: decoded };
  }
  if (pathname === '/history' || pathname.startsWith('/history/')) {
    return { view: 'history', tab: 'history', detailEntryId: null };
  }
  if (pathname === '/vehicles' || pathname.startsWith('/vehicles/')) {
    return { view: 'vehicles', tab: 'vehicles', detailEntryId: null };
  }
  if (pathname === '/account' || pathname.startsWith('/account/')) {
    return { view: 'account', tab: null, detailEntryId: null };
  }
  if (pathname === '/settings' || pathname.startsWith('/settings/')) {
    return { view: 'settings', tab: 'settings', detailEntryId: null };
  }
  return { view: 'home', tab: 'home', detailEntryId: null };
}

export const TabActiveContext = React.createContext<boolean>(true);

export interface AuthenticatedHeaderContextValue {
  headerHeight: number;
}

export const AuthenticatedHeaderContext =
  createContext<AuthenticatedHeaderContextValue>({
    headerHeight: 0,
  });

export function useAuthenticatedHeader() {
  return useContext(AuthenticatedHeaderContext);
}

export function AuthenticatedTabShell() {
  const router = useRouter();
  const pathname = usePathname();
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { reduceMotion, shouldAnimate, duration, easing } = useMotionPolicy();

  const resolved = resolveAuthenticatedRoute(pathname);
  const lastDockTabRef = useRef<DockTabKey>(
    resolved.tab ?? (resolved.view === 'fueling-detail' ? 'history' : 'home'),
  );
  if (resolved.tab !== null) {
    lastDockTabRef.current = resolved.tab;
  }
  const activeDockTab = lastDockTabRef.current;
  const isFocusedFlow =
    resolved.view === 'fueling-new' ||
    resolved.view === 'fueling-detail' ||
    resolved.view === 'account';
  const [headerHeight, setHeaderHeight] = useState<number>(() =>
    Math.round(insets.top + 56),
  );
  const isIntegratedScreen =
    resolved.view === 'home' || resolved.view === 'vehicles';

  const headerImageSource =
    resolved.view === 'vehicles'
      ? isDark
        ? require('@/assets/brand/scene_garage_night_integrated.png')
        : require('@/assets/brand/scene_garage_day_integrated.png')
      : isDark
        ? require('@/assets/brand/scene_night_road_integrated.png')
        : require('@/assets/brand/scene_day_road_integrated.png');

  const isNightRoad = resolved.view === 'home' && isDark;
  const staticRatio = isNightRoad ? 1355 / 1160 : 1355 / 1161;
  const resolvedAsset = Image.resolveAssetSource?.(headerImageSource);
  const assetRatio =
    resolvedAsset && resolvedAsset.width && resolvedAsset.height
      ? resolvedAsset.height / resolvedAsset.width
      : staticRatio;
  const totalImageHeight = Math.round(windowWidth * assetRatio);

  const headerSkyFallback = isIntegratedScreen
    ? isDark
      ? resolved.view === 'vehicles'
        ? '#000F2F'
        : '#01163E'
      : resolved.view === 'vehicles'
        ? '#2BA3FD'
        : '#51B6FD'
    : colors.bgPrimary;

  const visitedViewsRef = useRef<Set<AuthenticatedViewKey>>(
    new Set([resolved.view]),
  );
  visitedViewsRef.current.add(resolved.view);

  const lastDetailEntryIdRef = useRef<string>(resolved.detailEntryId ?? '');
  if (resolved.detailEntryId) {
    lastDetailEntryIdRef.current = resolved.detailEntryId;
  }

  const transitionKey = `${resolved.view}:${resolved.detailEntryId ?? ''}`;
  const prevTransitionKeyRef = useRef<string>(transitionKey);
  const prevViewRef = useRef<AuthenticatedViewKey>(resolved.view);
  const translateX = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const activeAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const motionPolicyRef = useRef({ duration, easing, reduceMotion, shouldAnimate });
  motionPolicyRef.current = { duration, easing, reduceMotion, shouldAnimate };

  useEffect(() => {
    if (reduceMotion || !shouldAnimate) {
      if (activeAnimRef.current) {
        activeAnimRef.current.stop();
        activeAnimRef.current = null;
      }
      translateX.setValue(0);
      contentOpacity.setValue(1);
    }
  }, [contentOpacity, reduceMotion, shouldAnimate, translateX]);

  useEffect(() => {
    const prevKey = prevTransitionKeyRef.current;
    const prevView = prevViewRef.current;
    if (prevKey === transitionKey) {
      return;
    }
    prevTransitionKeyRef.current = transitionKey;
    prevViewRef.current = resolved.view;

    if (activeAnimRef.current) {
      activeAnimRef.current.stop();
      activeAnimRef.current = null;
    }

    const policy = motionPolicyRef.current;
    if (policy.reduceMotion || !policy.shouldAnimate) {
      translateX.setValue(0);
      contentOpacity.setValue(1);
      return;
    }

    const direction =
      VIEW_ORDER[resolved.view] >= VIEW_ORDER[prevView] ? 1 : -1;
    translateX.setValue(direction * 18);
    contentOpacity.setValue(0.92);

    const anim = Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: policy.duration('standard', 0),
        easing: policy.easing.enter,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: policy.duration('micro', 0),
        easing: policy.easing.enter,
        useNativeDriver: true,
      }),
    ]);

    activeAnimRef.current = anim;
    anim.start(({ finished }) => {
      if (activeAnimRef.current === anim) {
        activeAnimRef.current = null;
      }
      if (finished) {
        translateX.setValue(0);
        contentOpacity.setValue(1);
      }
    });

    return () => {
      if (activeAnimRef.current === anim) {
        anim.stop();
        activeAnimRef.current = null;
        translateX.setValue(0);
        contentOpacity.setValue(1);
      }
    };
  }, [contentOpacity, resolved.view, transitionKey, translateX]);

  // Android hardware back: retorna de fluxos empilhados (novo/detalhe) ou de abas secundárias para Início
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const current = resolveAuthenticatedRoute(pathname);
      if (
        current.view === 'fueling-new' ||
        current.view === 'fueling-detail' ||
        current.view === 'account'
      ) {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace(
            current.view === 'fueling-detail'
            ? '/history'
            : current.view === 'account'
              ? '/settings'
              : '/',
          );
        }
        return true;
      }
      if (current.view !== 'home') {
        router.replace('/');
        return true;
      }
      return false;
    });
    return () => {
      sub.remove();
    };
  }, [pathname, router]);

  return (
    <View
      style={[styles.shellOverlay, { backgroundColor: colors.bgPrimary }]}
    >
      {/* Persistent Top Header: Only on main tabs */}
      {!isFocusedFlow ? (
        <SafeAreaView
          edges={['top', 'left', 'right']}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h > 0 && Math.abs(h - headerHeight) >= 1) {
              setHeaderHeight(h);
            }
          }}
          style={[
            styles.headerSafe,
            {
              backgroundColor: headerSkyFallback,
            },
          ]}
        >
          {isIntegratedScreen ? (
            <View style={styles.headerImageSlice} pointerEvents="none">
              <Image
                source={headerImageSource}
                style={{
                  width: windowWidth,
                  height: totalImageHeight,
                  position: 'absolute',
                  top: 0,
                  left: 0,
                }}
                resizeMode="cover"
              />
            </View>
          ) : null}
          <View style={styles.headerContainer}>
            <View style={styles.headerInner}>
              <BrandLockup mode="wordmark-only" wordmarkWidth={146} />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Minha conta"
                testID="header-avatar-button"
                onPress={() => {
                  if (pathname !== '/account') {
                    router.push('/account');
                  }
                }}
                style={styles.headerMascotButton}
              >
                <PixelMascot variant="avatar" size={32} withFrame />
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      ) : null}

      {/* Content Area: Only the route content slides laterally; header and bottom dock remain static */}
      <AuthenticatedHeaderContext.Provider value={{ headerHeight }}>
        <Animated.View
          style={[
            styles.contentStage,
            {
              opacity: contentOpacity,
              transform: [{ translateX }],
            },
          ]}
        >
          {visitedViewsRef.current.has('home') ? (
            <TabPane active={resolved.view === 'home'}>
              <HomeScreen embeddedInShell />
            </TabPane>
          ) : null}

          {visitedViewsRef.current.has('history') ? (
            <TabPane active={resolved.view === 'history'}>
              <HistoryScreen embeddedInShell />
            </TabPane>
          ) : null}

          {visitedViewsRef.current.has('vehicles') ? (
            <TabPane active={resolved.view === 'vehicles'}>
              <VehiclesScreen embeddedInShell />
            </TabPane>
          ) : null}

          {visitedViewsRef.current.has('settings') ? (
            <TabPane active={resolved.view === 'settings'}>
              <SettingsScreen embeddedInShell />
            </TabPane>
          ) : null}

          {visitedViewsRef.current.has('fueling-new') ? (
            <TabPane active={resolved.view === 'fueling-new'}>
              <NewFuelEntryScreen embeddedInShell />
            </TabPane>
          ) : null}

          {visitedViewsRef.current.has('fueling-detail') ? (
            <TabPane active={resolved.view === 'fueling-detail'}>
              <FuelEntryDetailScreen
                embeddedInShell
                entryIdOverride={lastDetailEntryIdRef.current}
              />
            </TabPane>
          ) : null}

          {visitedViewsRef.current.has('account') ? (
            <TabPane active={resolved.view === 'account'}>
              <AccountScreen embeddedInShell />
            </TabPane>
          ) : null}
        </Animated.View>
      </AuthenticatedHeaderContext.Provider>

      {/* Persistent Bottom Navigation: Single instance across all authenticated routes */}
      {!isFocusedFlow ? <FloatingDock activeTab={activeDockTab} /> : null}
    </View>
  );
}

function TabPane({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <TabActiveContext.Provider value={active}>
      <View
        pointerEvents={active ? 'auto' : 'none'}
        importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
        accessibilityElementsHidden={!active}
        aria-hidden={!active}
        style={[
          styles.tabPane,
          !active && styles.inactiveTabPane,
          Platform.OS === 'web' && !active
            ? ({ display: 'none' } as object)
            : null,
        ]}
      >
        {children}
      </View>
    </TabActiveContext.Provider>
  );
}

const styles = StyleSheet.create({
  shellOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
  },
  headerSafe: {
    zIndex: 30,
    overflow: 'hidden',
  },
  headerImageSlice: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  headerContainer: {
    paddingHorizontal: layout.horizontalPadding,
    paddingTop: 8,
    paddingBottom: 6,
  },
  headerInner: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerMascotButton: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  contentStage: {
    flex: 1,
    position: 'relative',
    zIndex: 10,
  },
  tabPane: {
    flex: 1,
  },
  inactiveTabPane: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0,
    zIndex: -1,
  },
});
