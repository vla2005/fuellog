import { usePathname, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CarIcon,
  HistoryIcon,
  HomeIcon,
  PlusIcon,
  SettingsIcon,
} from '@/components/icons/AppIcons';
import { useMotionPolicy } from '@/motion/useMotionPolicy';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export type DockTabKey = 'home' | 'history' | 'vehicles' | 'settings';

interface DockTabItem {
  key: DockTabKey;
  label: string;
  href: '/' | '/history' | '/vehicles' | '/settings';
}

const DOCK_TABS_LEFT: DockTabItem[] = [
  { key: 'home', label: 'Início', href: '/' },
  { key: 'history', label: 'Histórico', href: '/history' },
];

const DOCK_TABS_RIGHT: DockTabItem[] = [
  { key: 'vehicles', label: 'Veículos', href: '/vehicles' },
  { key: 'settings', label: 'Ajustes', href: '/settings' },
];

export function FloatingDock({ activeTab }: { activeTab?: DockTabKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { reduceMotion, shouldAnimate, duration, easing } = useMotionPolicy();

  const resolvedActive: DockTabKey =
    activeTab ??
    (pathname.startsWith('/history')
      ? 'history'
      : pathname.startsWith('/vehicles')
        ? 'vehicles'
        : pathname.startsWith('/settings')
          ? 'settings'
          : 'home');

  const scaleMap = useRef<Record<DockTabKey, Animated.Value>>({
    home: new Animated.Value(1),
    history: new Animated.Value(1),
    vehicles: new Animated.Value(1),
    settings: new Animated.Value(1),
  }).current;
  const prevActiveRef = useRef<DockTabKey>(resolvedActive);
  const motionPolicyRef = useRef({ duration, easing, reduceMotion, shouldAnimate });
  motionPolicyRef.current = { duration, easing, reduceMotion, shouldAnimate };
  const activeDockAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (reduceMotion || !shouldAnimate) {
      if (activeDockAnimRef.current) {
        activeDockAnimRef.current.stop();
        activeDockAnimRef.current = null;
      }
      (Object.keys(scaleMap) as DockTabKey[]).forEach((key) => {
        scaleMap[key].setValue(1);
      });
    }
  }, [reduceMotion, scaleMap, shouldAnimate]);

  useEffect(() => {
    const prev = prevActiveRef.current;
    if (prev === resolvedActive) {
      return;
    }
    prevActiveRef.current = resolvedActive;

    if (activeDockAnimRef.current) {
      activeDockAnimRef.current.stop();
      activeDockAnimRef.current = null;
    }

    (Object.keys(scaleMap) as DockTabKey[]).forEach((key) => {
      if (key !== resolvedActive) {
        scaleMap[key].setValue(1);
      }
    });

    const targetVal = scaleMap[resolvedActive];
    targetVal.stopAnimation();

    const policy = motionPolicyRef.current;
    if (policy.reduceMotion || !policy.shouldAnimate) {
      targetVal.setValue(1);
      return;
    }

    targetVal.setValue(0.95);
    const anim = Animated.timing(targetVal, {
      toValue: 1,
      duration: policy.duration('micro', 0),
      easing: policy.easing.enter,
      useNativeDriver: true,
    });

    activeDockAnimRef.current = anim;
    anim.start(({ finished }) => {
      if (activeDockAnimRef.current === anim) {
        activeDockAnimRef.current = null;
      }
      if (finished) {
        targetVal.setValue(1);
      }
    });

    return () => {
      if (activeDockAnimRef.current === anim) {
        anim.stop();
        activeDockAnimRef.current = null;
        targetVal.setValue(1);
      }
    };
  }, [resolvedActive, scaleMap]);

  const bottomPadding = Math.max(insets.bottom, Platform.OS === 'web' ? 8 : 6);

  const renderTab = (tab: DockTabItem) => {
    const isSelected = resolvedActive === tab.key;
    const isCurrentPathname =
      tab.href === '/'
        ? pathname === '/' || pathname === '/index' || pathname === ''
        : pathname === tab.href;
    const activeColor = isDark
      ? colors.borderFocus
      : colors.brandPrimary;
    const inactiveColor = colors.textSecondary;
    const iconColor = isSelected ? activeColor : inactiveColor;
    const activePillBg = isDark
      ? 'rgba(24, 106, 255, 0.16)'
      : 'rgba(29, 89, 242, 0.10)';

    return (
      <Pressable
        key={tab.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: isSelected }}
        aria-selected={isSelected}
        accessibilityLabel={tab.label}
        onPress={() => {
          if (!isSelected || !isCurrentPathname) {
            router.replace(tab.href);
          }
        }}
        style={({ pressed }) => [
          styles.tabButton,
          isSelected && {
            backgroundColor: activePillBg,
          },
          pressed && !isSelected && { opacity: 0.78 },
        ]}
      >
        <Animated.View
          style={[
            styles.tabInner,
            { transform: [{ scale: scaleMap[tab.key] }] },
          ]}
        >
          {tab.key === 'home' ? (
            <HomeIcon size={19} color={iconColor} />
          ) : null}
          {tab.key === 'history' ? (
            <HistoryIcon size={19} color={iconColor} />
          ) : null}
          {tab.key === 'vehicles' ? (
            <CarIcon size={19} color={iconColor} />
          ) : null}
          {tab.key === 'settings' ? (
            <SettingsIcon size={19} color={iconColor} />
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              styles.tabLabel,
              {
                color: isSelected
                  ? activeColor
                  : inactiveColor,
                fontWeight: isSelected ? '700' : '500',
              },
            ]}
          >
            {tab.label}
          </Text>
        </Animated.View>
      </Pressable>
    );
  };

  return (
    <View
      pointerEvents="box-none"
      style={styles.outerContainer}
    >
      <View
        style={[
          styles.barContainer,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.borderSubtle,
            paddingBottom: bottomPadding,
          },
        ]}
        accessibilityRole="tablist"
      >
        <View style={styles.barInner}>
          {DOCK_TABS_LEFT.map(renderTab)}

          <View style={styles.centerActionSlot} pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Novo abastecimento"
              onPress={() => {
                router.push('/fueling/new');
              }}
              style={({ pressed }) => [
                styles.centerActionButton,
                {
                  backgroundColor: pressed
                    ? colors.brandPressed
                    : colors.brandPrimary,
                  borderColor: colors.surface,
                  shadowColor: isDark ? '#186AFF' : '#1D59F2',
                  transform: [
                    {
                      scale:
                        pressed && !reduceMotion && shouldAnimate ? 0.94 : 1,
                    },
                  ],
                },
              ]}
            >
              <PlusIcon size={26} color="#FFFFFF" strokeWidth={2.8} />
            </Pressable>
          </View>

          {DOCK_TABS_RIGHT.map(renderTab)}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    zIndex: 30,
    overflow: 'visible',
  },
  barContainer: {
    width: '100%',
    borderTopWidth: 1,
    overflow: 'visible',
  },
  barInner: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  tabButton: {
    flex: 1,
    minHeight: 46,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabLabel: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 14,
  },
  centerActionSlot: {
    width: 58,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  centerActionButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -26,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
      android: {
        elevation: 6,
      },
      default: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
    }),
  },
});
