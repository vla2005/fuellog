import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckIcon, CloseIcon } from '@/components/icons/AppIcons';
import { ToastMessage } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, shadows, typography } from '@/theme/tokens';

export function AppToast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();

  if (!toast) {
    return null;
  }

  const badgeBg =
    toast.tone === 'success'
      ? colors.successText
      : toast.tone === 'danger'
        ? colors.dangerText
        : toast.tone === 'warning'
          ? colors.warningText
          : colors.accentPrimary;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { top: Math.max(insets.top + 8, 16) }]}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityRole="alert"
        style={[
          styles.card,
          {
            backgroundColor: colors.bgElevated,
            borderColor: colors.borderStrong,
          },
          isDark ? shadows.darkCard : shadows.lightFloating,
        ]}
      >
        <View style={[styles.iconBadge, { backgroundColor: badgeBg }]}>
          <CheckIcon size={14} color="#FFFFFF" />
        </View>
        <View style={styles.textGroup}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{toast.title}</Text>
          {toast.subtitle ? (
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {toast.subtitle}
            </Text>
          ) : null}
        </View>
        <CloseIcon size={16} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 50,
  },
  card: {
    width: '100%',
    maxWidth: 428,
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBadge: {
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textGroup: {
    flex: 1,
    gap: 1,
  },
  title: {
    ...typography.bodyStrong,
    fontSize: 13,
  },
  subtitle: {
    ...typography.caption,
    fontSize: 12,
  },
});
