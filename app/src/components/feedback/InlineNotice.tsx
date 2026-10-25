import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { AlertTriangleIcon, CheckIcon } from '@/components/icons/AppIcons';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';

export interface InlineNoticeProps {
  tone?: NoticeTone;
  title?: string;
  message: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function InlineNotice({
  tone = 'info',
  title,
  message,
  action,
  style,
}: InlineNoticeProps) {
  const { colors } = useAppTheme();

  const palette =
    tone === 'danger'
      ? {
          bg: colors.dangerSoft,
          border: colors.dangerBorder,
          text: colors.dangerText,
        }
      : tone === 'warning'
        ? {
            bg: colors.warningSoft,
            border: colors.warningBorder,
            text: colors.warningText,
          }
        : tone === 'success'
          ? {
              bg: colors.successSoft,
              border: colors.successBorder,
              text: colors.successText,
            }
          : {
              bg: colors.infoSoft,
              border: colors.infoBorder,
              text: colors.infoText,
            };

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.box,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
        },
        style,
      ]}
    >
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          {tone === 'success' ? (
            <CheckIcon size={16} color={palette.text} />
          ) : (
            <AlertTriangleIcon size={16} color={palette.text} />
          )}
        </View>
        <View style={styles.textColumn}>
          {title ? (
            <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
          ) : null}
          <Text style={[styles.message, { color: palette.text }]}>{message}</Text>
        </View>
      </View>
      {action ? <View style={styles.actionRow}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  iconWrap: {
    marginTop: 2,
  },
  textColumn: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.bodyStrong,
    fontSize: 13,
  },
  message: {
    ...typography.caption,
    fontSize: 13,
    lineHeight: 18,
  },
  actionRow: {
    marginTop: 2,
  },
});
