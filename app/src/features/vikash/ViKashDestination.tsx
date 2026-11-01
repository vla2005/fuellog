import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { ViKashCatalog, ViKashChoices } from '@/api/types';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';
import { describeDestination } from './viKashChoices';
import { viKashColors } from './viKashTheme';

export function ViKashDestination({ catalog, choices, onBlack = false }: {
  catalog: ViKashCatalog | null; choices: ViKashChoices | null | undefined; onBlack?: boolean;
}) {
  const { colors } = useAppTheme();
  const summary = describeDestination(choices, catalog);
  const iconColor = onBlack ? viKashColors.secondary : colors.textSecondary;
  return <View testID="vikash-destination" style={[styles.summary, onBlack ? { flex: 1 } : { backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.borderDefault, borderRadius: radii.lg, padding: 16 }]}>
    <View accessible={false} style={[styles.icon, { backgroundColor: onBlack ? viKashColors.surface : colors.subtle }]}>
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {choices?.paymentMethod === 'CREDIT_CARD' ? <>
          <Rect x={3} y={5} width={18} height={14} rx={3} />
          <Line x1={3} y1={10} x2={21} y2={10} />
          <Line x1={7} y1={15} x2={11} y2={15} />
        </> : <>
          <Path d="M4 7V5a2 2 0 0 1 2-2h12v4" />
          <Rect x={3} y={7} width={18} height={14} rx={3} />
          <Path d="M21 12h-5v4h5" />
        </>}
      </Svg>
    </View>
    <View style={styles.text}>
      <Text style={[styles.title, { color: onBlack ? viKashColors.text : colors.textPrimary }]}>{summary.title}</Text>
      <Text style={[styles.detail, { color: onBlack ? viKashColors.secondary : colors.textSecondary }]}>{summary.detail}</Text>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  summary: { minWidth: 0, gap: 12, flexDirection: 'row', alignItems: 'flex-start' },
  icon: { width: 36, height: 36, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 5 }, title: { ...typography.bodyStrong }, detail: { ...typography.caption },
});
