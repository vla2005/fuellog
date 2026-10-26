import { usePathname, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandLockup } from '@/components/brand/BrandLockup';
import { SettingsIcon } from '@/components/icons/AppIcons';
import { PixelMascot } from '@/components/brand/PixelMascot';
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
  | 'fueling-detail';

const VIEW_ORDER: Record<AuthenticatedViewKey, number> = {
  home: 0,
  history: 1,
  vehicles: 2,
  settings: 3,
  'fueling-new': 4,
  'fueling-detail': 5,
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
  if (pathname === '/settings' || pathname.startsWith('/settings/')) {
    return { view: 'settings', tab: 'settings', detailEntryId: null };
  }
  return { view: 'home', tab: 'home', detailEntryId: null };
}

export const TabActiveContext = React.createContext<boolean>(true);

export function AuthenticatedTabShell() {
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useAppTheme();
  const { reduceMotion, shouldAnimate, duration, easing } = useMotionPolicy();

  const resolved = resolveAuthenticatedRoute(pathname);
  const lastDockTabRef = useRef<DockTabKey>(
    resolved.tab ?? (resolved.view === 'fueling-detail' ? 'history' : 'home'),
  );
  if (resolved.tab !== null) {
    lastDockTabRef.current = resolved.tab;
  }
  const activeDockTab = lastDockTabRef.current;
  const isFocusedFlow = resolved.view === 'fueling-new' || resolved.view === 'fueling-detail';

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
        current.view === 'fueling-detail'
      ) {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace(
            current.view === 'fueling-detail' ? '/history' : '/',
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
          style={[styles.headerSafe, { backgroundColor: colors.bgPrimary }]}
        >
          <View style={styles.headerContainer}>
            <View style={styles.headerInner}>
              <BrandLockup mode="wordmark-only" wordmarkWidth={146} />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Ajustes"
                onPress={() => {
                  if (pathname !== '/settings') {
                    router.replace('/settings');
                  }
                }}
                style={styles.headerMascotButton}
              >
                <SettingsIcon size={24} color={colors.brandPrimary} />
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      ) : null}

      {/* Content Area: Only the route content slides laterally; header and bottom dock remain static */}
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
      </Animated.View>

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
