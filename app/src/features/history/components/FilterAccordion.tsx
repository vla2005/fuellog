import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ChevronDownIcon } from '@/components/icons/AppIcons';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export interface FilterAccordionProps {
  totalPaidMin: string;
  totalPaidMax: string;
  onChangeTotalPaidMin: (val: string) => void;
  onChangeTotalPaidMax: (val: string) => void;

  litersMin: string;
  litersMax: string;
  onChangeLitersMin: (val: string) => void;
  onChangeLitersMax: (val: string) => void;

  priceMin: string;
  priceMax: string;
  onChangePriceMin: (val: string) => void;
  onChangePriceMax: (val: string) => void;

  errorTotalPaid?: string | null;
  errorLiters?: string | null;
  errorPrice?: string | null;
}

type AccordionSection = 'paid' | 'liters' | 'price' | null;

export function FilterAccordion({
  totalPaidMin,
  totalPaidMax,
  onChangeTotalPaidMin,
  onChangeTotalPaidMax,
  litersMin,
  litersMax,
  onChangeLitersMin,
  onChangeLitersMax,
  priceMin,
  priceMax,
  onChangePriceMin,
  onChangePriceMax,
  errorTotalPaid,
  errorLiters,
  errorPrice,
}: FilterAccordionProps) {
  const { colors } = useAppTheme();
  // Começa com 'paid' aberto conforme a imagem de referência
  const [openSection, setOpenSection] = useState<AccordionSection>('paid');

  // Abre automaticamente a primeira seção que contiver erro de validação
  useEffect(() => {
    if (errorTotalPaid) {
      setOpenSection('paid');
    } else if (errorLiters) {
      setOpenSection('liters');
    } else if (errorPrice) {
      setOpenSection('price');
    }
  }, [errorTotalPaid, errorLiters, errorPrice]);

  const toggleSection = (section: AccordionSection) => {
    setOpenSection((prev) => (prev === section ? null : section));
  };

  const getPaidSummary = () => {
    const min = totalPaidMin.trim();
    const max = totalPaidMax.trim();
    if (!min && !max) return 'Sem limite';
    if (min && max) return `R$ ${min} — R$ ${max}`;
    if (min) return `A partir de R$ ${min}`;
    return `Até R$ ${max}`;
  };

  const getLitersSummary = () => {
    const min = litersMin.trim();
    const max = litersMax.trim();
    if (!min && !max) return 'Sem limite';
    if (min && max) return `${min} L — ${max} L`;
    if (min) return `A partir de ${min} L`;
    return `Até ${max} L`;
  };

  const getPriceSummary = () => {
    const min = priceMin.trim();
    const max = priceMax.trim();
    if (!min && !max) return 'Sem limite';
    if (min && max) return `R$ ${min} — R$ ${max}`;
    if (min) return `A partir de R$ ${min}`;
    return `Até R$ ${max}`;
  };

  const isPaidOpen = openSection === 'paid';
  const isLitersOpen = openSection === 'liters';
  const isPriceOpen = openSection === 'price';

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSubtle,
        },
      ]}
    >
      {/* 1. Valor pago */}
      <View style={styles.sectionWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Valor pago. ${isPaidOpen ? 'Recolher' : 'Expandir'}. Resumo: ${getPaidSummary()}`}
          accessibilityState={{ expanded: isPaidOpen }}
          onPress={() => toggleSection('paid')}
          style={styles.headerRow}
        >
          <View style={styles.headerLeft}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Valor pago
            </Text>
            {!isPaidOpen ? (
              <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                {getPaidSummary()}
              </Text>
            ) : null}
          </View>
          <View
            style={[
              styles.chevronWrap,
              isPaidOpen ? styles.chevronRotated : null,
            ]}
          >
            <ChevronDownIcon size={18} color={colors.textSecondary} />
          </View>
        </Pressable>

        {isPaidOpen ? (
          <View style={styles.inputsRow}>
            <View style={styles.inputCol}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Mínimo
              </Text>
              <TextInput
                accessibilityLabel="Valor pago mínimo"
                value={totalPaidMin}
                onChangeText={onChangeTotalPaidMin}
                placeholder="R$ 0,00"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={[
                  styles.inputBox,
                  {
                    backgroundColor: colors.bgSecondary,
                    borderColor: errorTotalPaid ? colors.dangerBorder : colors.borderDefault,
                    color: colors.textPrimary,
                  },
                ]}
              />
            </View>
            <View style={styles.inputCol}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Máximo
              </Text>
              <TextInput
                accessibilityLabel="Valor pago máximo"
                value={totalPaidMax}
                onChangeText={onChangeTotalPaidMax}
                placeholder="R$ 0,00"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={[
                  styles.inputBox,
                  {
                    backgroundColor: colors.bgSecondary,
                    borderColor: errorTotalPaid ? colors.dangerBorder : colors.borderDefault,
                    color: colors.textPrimary,
                  },
                ]}
              />
            </View>
          </View>
        ) : null}
        {errorTotalPaid ? (
          <Text style={[styles.errorMsg, { color: colors.dangerText }]}>
            {errorTotalPaid}
          </Text>
        ) : null}
      </View>

      <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

      {/* 2. Quantidade de litros */}
      <View style={styles.sectionWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Quantidade de litros. ${isLitersOpen ? 'Recolher' : 'Expandir'}. Resumo: ${getLitersSummary()}`}
          accessibilityState={{ expanded: isLitersOpen }}
          onPress={() => toggleSection('liters')}
          style={styles.headerRow}
        >
          <View style={styles.headerLeft}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Quantidade de litros
            </Text>
            {!isLitersOpen ? (
              <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                {getLitersSummary()}
              </Text>
            ) : null}
          </View>
          <View style={styles.headerRight}>
            <Text style={[styles.unitLabel, { color: colors.textSecondary }]}>
              L
            </Text>
            <View
              style={[
                styles.chevronWrap,
                isLitersOpen ? styles.chevronRotated : null,
              ]}
            >
              <ChevronDownIcon size={18} color={colors.textSecondary} />
            </View>
          </View>
        </Pressable>

        {isLitersOpen ? (
          <View style={styles.inputsRow}>
            <View style={styles.inputCol}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Mínimo
              </Text>
              <TextInput
                accessibilityLabel="Quantidade de litros mínima"
                value={litersMin}
                onChangeText={onChangeLitersMin}
                placeholder="0,000"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={[
                  styles.inputBox,
                  {
                    backgroundColor: colors.bgSecondary,
                    borderColor: errorLiters ? colors.dangerBorder : colors.borderDefault,
                    color: colors.textPrimary,
                  },
                ]}
              />
            </View>
            <View style={styles.inputCol}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Máximo
              </Text>
              <TextInput
                accessibilityLabel="Quantidade de litros máxima"
                value={litersMax}
                onChangeText={onChangeLitersMax}
                placeholder="0,000"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={[
                  styles.inputBox,
                  {
                    backgroundColor: colors.bgSecondary,
                    borderColor: errorLiters ? colors.dangerBorder : colors.borderDefault,
                    color: colors.textPrimary,
                  },
                ]}
              />
            </View>
          </View>
        ) : null}
        {errorLiters ? (
          <Text style={[styles.errorMsg, { color: colors.dangerText }]}>
            {errorLiters}
          </Text>
        ) : null}
      </View>

      <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

      {/* 3. Preço por litro */}
      <View style={styles.sectionWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Preço por litro. ${isPriceOpen ? 'Recolher' : 'Expandir'}. Resumo: ${getPriceSummary()}`}
          accessibilityState={{ expanded: isPriceOpen }}
          onPress={() => toggleSection('price')}
          style={styles.headerRow}
        >
          <View style={styles.headerLeft}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Preço por litro
            </Text>
            {!isPriceOpen ? (
              <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                {getPriceSummary()}
              </Text>
            ) : null}
          </View>
          <View style={styles.headerRight}>
            <Text style={[styles.unitLabel, { color: colors.textSecondary }]}>
              R$/L
            </Text>
            <View
              style={[
                styles.chevronWrap,
                isPriceOpen ? styles.chevronRotated : null,
              ]}
            >
              <ChevronDownIcon size={18} color={colors.textSecondary} />
            </View>
          </View>
        </Pressable>

        {isPriceOpen ? (
          <View style={styles.inputsRow}>
            <View style={styles.inputCol}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Mínimo
              </Text>
              <TextInput
                accessibilityLabel="Preço por litro mínimo"
                value={priceMin}
                onChangeText={onChangePriceMin}
                placeholder="0,0000"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={[
                  styles.inputBox,
                  {
                    backgroundColor: colors.bgSecondary,
                    borderColor: errorPrice ? colors.dangerBorder : colors.borderDefault,
                    color: colors.textPrimary,
                  },
                ]}
              />
            </View>
            <View style={styles.inputCol}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Máximo
              </Text>
              <TextInput
                accessibilityLabel="Preço por litro máximo"
                value={priceMax}
                onChangeText={onChangePriceMax}
                placeholder="0,0000"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={[
                  styles.inputBox,
                  {
                    backgroundColor: colors.bgSecondary,
                    borderColor: errorPrice ? colors.dangerBorder : colors.borderDefault,
                    color: colors.textPrimary,
                  },
                ]}
              />
            </View>
          </View>
        ) : null}
        {errorPrice ? (
          <Text style={[styles.errorMsg, { color: colors.dangerText }]}>
            {errorPrice}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sectionWrap: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 38,
  },
  headerLeft: {
    flex: 1,
    justifyContent: 'center',
  },
  sectionTitle: {
    ...typography.cardTitle,
    fontSize: 15,
    fontWeight: '700',
  },
  sectionSubtitle: {
    ...typography.caption,
    fontSize: 13,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unitLabel: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '600',
  },
  chevronWrap: {
    transform: [{ rotate: '0deg' }],
  },
  chevronRotated: {
    transform: [{ rotate: '180deg' }],
  },
  inputsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    marginBottom: 4,
  },
  inputCol: {
    flex: 1,
  },
  inputLabel: {
    ...typography.caption,
    fontSize: 12,
    marginBottom: 4,
  },
  inputBox: {
    borderWidth: 1,
    borderRadius: radii.md,
    height: 44,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    width: '100%',
  },
  errorMsg: {
    ...typography.caption,
    fontSize: 12,
    marginTop: 4,
  },
});
