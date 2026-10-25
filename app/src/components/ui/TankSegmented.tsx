import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TANK_STATE_LABELS } from '@/api/endpoints';
import { TankState } from '@/api/types';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

const TANK_OPTIONS: {
  value: TankState;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  {
    value: 'FULL',
    label: TANK_STATE_LABELS.FULL,
    shortLabel: 'Cheio',
    description: 'Fecha ou inicia um ciclo válido de consumo (km/L).',
  },
  {
    value: 'PARTIAL',
    label: TANK_STATE_LABELS.PARTIAL,
    shortLabel: 'Parcial',
    description: 'Soma litros e custo ao ciclo em aberto até o próximo tanque cheio.',
  },
  {
    value: 'UNKNOWN',
    label: TANK_STATE_LABELS.UNKNOWN,
    shortLabel: 'Não sei',
    description: 'Registra o gasto financeiro, mas não fecha o ciclo de consumo.',
  },
];

export interface TankSegmentedProps {
  value: TankState | null;
  onChange: (next: TankState) => void;
  errorText?: string | null;
}

export function TankSegmented({ value, onChange, errorText }: TankSegmentedProps) {
  const { colors, isDark } = useAppTheme();

  return (
    <View style={styles.container}>
      <View
        style={styles.track}
        accessibilityRole="radiogroup"
        accessibilityLabel="Estado do tanque"
      >
        {TANK_OPTIONS.map((option) => {
          const isSelected = value === option.value;
          const surfaceBg = colors.surface;
          const surfaceBorder = errorText
            ? colors.dangerBorder
            : colors.borderSubtle;

          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              aria-checked={isSelected}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.segment,
                {
                  backgroundColor: isSelected ? colors.brandPrimary : surfaceBg,
                  borderColor: isSelected ? colors.brandPrimary : surfaceBorder,
                },
                pressed && !isSelected && { opacity: 0.78 },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.segmentLabel,
                  {
                    color: isSelected ? '#FFFFFF' : colors.textPrimary,
                  },
                ]}
              >
                {option.shortLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {errorText ? (
        <Text style={[styles.errorText, { color: colors.dangerText }]}>{errorText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  track: {
    flexDirection: 'row',
    gap: 8,
  },
  segment: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentLabel: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
  },
});
