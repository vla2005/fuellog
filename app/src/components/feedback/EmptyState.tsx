import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PixelMascot } from '@/components/brand/PixelMascot';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
  showMascot?: boolean;
}

export function EmptyState({
  title,
  description,
  action,
  showMascot = true,
}: EmptyStateProps) {
  const { colors } = useAppTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.bgElevated,
          borderColor: colors.borderDefault,
        },
      ]}
    >
      {showMascot ? <PixelMascot variant="full" size={76} /> : null}
      <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>
        {description}
      </Text>
      {action ? <View style={styles.actionWrap}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  title: {
    ...typography.cardTitle,
    textAlign: 'center',
    marginTop: 4,
  },
  description: {
    ...typography.body,
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 320,
  },
  actionWrap: {
    width: '100%',
    marginTop: 8,
  },
});
