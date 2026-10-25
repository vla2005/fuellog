import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CarIcon,
  HistoryIcon,
  HomeIcon,
  SettingsIcon,
} from '@/components/icons/AppIcons';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, shadows, typography } from '@/theme/tokens';

export type DockTabKey = 'home' | 'history' | 'vehicles' | 'settings';

interface DockTabItem {
  key: DockTabKey;
  label: string;
  href: '/' | '/history' | '/vehicles' | '/settings';
}

const DOCK_TABS: DockTabItem[] = [
  { key: 'home', label: 'Início', href: '/' },
  { key: 'history', label: 'Histórico', href: '/history' },
  { key: 'vehicles', label: 'Veículos', href: '/vehicles' },
  { key: 'settings', label: 'Ajustes', href: '/settings' },
];

export function FloatingDock({ activeTab }: { activeTab?: DockTabKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();

  const resolvedActive: DockTabKey =
    activeTab ??
    (pathname.startsWith('/history')
      ? 'history'
      : pathname.startsWith('/vehicles')
        ? 'vehicles'
        : pathname.startsWith('/settings')
          ? 'settings'
          : 'home');

  const bottomOffset = Math.max(insets.bottom, Platform.OS === 'web' ? 14 : 10);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.outerContainer, { bottom: bottomOffset }]}
    >
      <View
        style={[
          styles.dockPill,
          {
            backgroundColor: colors.surface,
            borderColor: colors.borderSubtle,
          },
          isDark ? shadows.darkCard : shadows.lightFloating,
        ]}
        accessibilityRole="tablist"
      >
        {DOCK_TABS.map((tab) => {
          const isSelected = resolvedActive === tab.key;
          const activeTextAndIconColor = isDark
            ? colors.borderFocus
            : colors.brandPrimary;
          const inactiveColor = colors.textPrimary;
          const iconColor = isSelected ? activeTextAndIconColor : inactiveColor;
          const activePillBg = colors.brandSoft;

          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              aria-selected={isSelected}
              accessibilityLabel={tab.label}
              onPress={() => {
                if (!isSelected) {
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
              {tab.key === 'home' ? <HomeIcon size={18} color={iconColor} /> : null}
              {tab.key === 'history' ? <HistoryIcon size={18} color={iconColor} /> : null}
              {tab.key === 'vehicles' ? <CarIcon size={18} color={iconColor} /> : null}
              {tab.key === 'settings' ? <SettingsIcon size={18} color={iconColor} /> : null}
              <Text
                numberOfLines={1}
                style={[
                  styles.tabLabel,
                  {
                    color: isSelected ? activeTextAndIconColor : inactiveColor,
                  },
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 20,
  },
  dockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 428,
    padding: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    minHeight: 46,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabLabel: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 14,
  },
});
