import { StyleSheet } from 'react-native';
import { radii, typography } from '@/theme/tokens';

// ViKash owns these surfaces; FuelLog navigation and primary actions keep their theme.
export const viKashColors = {
  background: '#080808',
  surface: '#171717',
  text: '#FFFFFF',
  secondary: '#B8BDC7',
  amber: '#FFB547',
  border: '#91672D',
  divider: '#353535',
  selected: '#392B16',
  success: '#66DF87',
  danger: '#FF9898',
};

export const viKashStyles = StyleSheet.create({
  panel: { backgroundColor: viKashColors.background, borderColor: viKashColors.border, borderWidth: 1, borderRadius: radii.lg, padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  column: { flex: 1, minWidth: 0, gap: 6 },
  title: { ...typography.sectionTitle, color: viKashColors.text },
  strong: { ...typography.bodyStrong, color: viKashColors.text },
  body: { ...typography.body, color: viKashColors.secondary },
  caption: { ...typography.caption, color: viKashColors.secondary },
  divider: { borderTopWidth: 1, borderTopColor: viKashColors.divider, paddingTop: 14 },
  switchTarget: { minHeight: 44, minWidth: 48, justifyContent: 'center' },
});
