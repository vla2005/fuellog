import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRightIcon } from '@/components/icons/AppIcons';
import { ViKashBrand, ViKashState, viKashConnectionLabel } from './ViKashBrand';
import { useViKash } from './useViKash';
import { viKashColors, viKashStyles } from './viKashTheme';

export function ViKashMenuCard({ active, onPress }: { active: boolean; onPress: () => void }) {
  const { status, loading, error } = useViKash(active, false);
  return <Pressable accessibilityRole="button" accessibilityLabel="Integrações, ViKash" onPress={onPress}
    testID="vikash-menu-card" style={({ pressed }) => [viKashStyles.panel, styles.card, { opacity: pressed ? 0.8 : 1 }]}>
    <View style={viKashStyles.column}>
      <ViKashBrand />
      <Text style={viKashStyles.caption}>Seus abastecimentos nas suas finanças</Text>
      <ViKashState label={viKashConnectionLabel(status, loading, error)} connected={status?.status === 'CONNECTED'} />
    </View>
    <ChevronRightIcon size={22} color={viKashColors.amber} />
  </Pressable>;
}
const styles = StyleSheet.create({ card: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 16 } });
