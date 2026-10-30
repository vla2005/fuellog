import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@/components/icons/AppIcons';
import { AppSheet } from '@/components/overlays/AppSheet';
import { FuelType } from '@/api/types';
import { FUEL_TYPE_LABELS } from '@/api/endpoints';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';
import {
  formatPeriodSummaryBR,
} from '../helpers/calendarHelper';
import {
  LITERS_CONFIG,
  PRICE_PER_LITER_CONFIG,
  TOTAL_PAID_CONFIG,
  validateDateRange,
  validateDecimalRange,
} from '../helpers/filterValidationHelper';
import { CalendarRangePicker } from './CalendarRangePicker';
import { FilterAccordion } from './FilterAccordion';

export interface HistoryFilterValues {
  from: string | null;
  to: string | null;
  fuelType: FuelType | null;
  minTotalPaid: string;
  maxTotalPaid: string;
  minLiters: string;
  maxLiters: string;
  minPricePerLiter: string;
  maxPricePerLiter: string;
}

export interface HistoryFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  onApply: (appliedFilters: HistoryFilterValues) => void;
  initialFilters: HistoryFilterValues;
  allowedFuels: FuelType[];
}

export function HistoryFilterSheet({
  visible,
  onClose,
  onApply,
  initialFilters,
  allowedFuels,
}: HistoryFilterSheetProps) {
  const { colors } = useAppTheme();

  // Etapa atual: 'main' ("Filtrar histórico") ou 'calendar' ("Selecionar período")
  const [currentStep, setCurrentStep] = useState<'main' | 'calendar'>('main');

  // Rascunho de filtros da etapa principal
  const [draftFilters, setDraftFilters] = useState<HistoryFilterValues>(initialFilters);

  // Erros de validação
  const [errorPaid, setErrorPaid] = useState<string | null>(null);
  const [errorLiters, setErrorLiters] = useState<string | null>(null);
  const [errorPrice, setErrorPrice] = useState<string | null>(null);
  const [errorDate, setErrorDate] = useState<string | null>(null);

  // Sempre que o modal abre, reinicializa o rascunho com os filtros ativos e vai para o passo 'main'
  useEffect(() => {
    if (visible) {
      setDraftFilters(initialFilters);
      setCurrentStep('main');
      setErrorPaid(null);
      setErrorLiters(null);
      setErrorPrice(null);
      setErrorDate(null);
    }
  }, [visible, initialFilters]);

  // Cancelar fecha o modal e descarta o rascunho
  const handleCancel = () => {
    onClose();
  };

  // Limpar zera todos os campos do rascunho (inclusive período -> Todo o histórico)
  const handleClearDraft = () => {
    setDraftFilters({
      from: null,
      to: null,
      fuelType: null,
      minTotalPaid: '',
      maxTotalPaid: '',
      minLiters: '',
      maxLiters: '',
      minPricePerLiter: '',
      maxPricePerLiter: '',
    });
    setErrorPaid(null);
    setErrorLiters(null);
    setErrorPrice(null);
    setErrorDate(null);
  };

  // Validação estrita e aplicação dos filtros
  const handleApply = () => {
    let hasError = false;

    // 1. Validação de datas
    const dateValidation = validateDateRange(draftFilters.from, draftFilters.to);
    if (!dateValidation.valid) {
      setErrorDate(dateValidation.errorMessage ?? 'Intervalo de datas inválido');
      hasError = true;
    } else {
      setErrorDate(null);
    }

    // 2. Validação de Valor Pago (escala 2, máx 9999999999.99)
    const paidValidation = validateDecimalRange(
      draftFilters.minTotalPaid,
      draftFilters.maxTotalPaid,
      TOTAL_PAID_CONFIG,
    );
    if (!paidValidation.valid) {
      setErrorPaid(paidValidation.errorMessage ?? 'Valor pago inválido');
      hasError = true;
    } else {
      setErrorPaid(null);
    }

    // 3. Validação de Quantidade de Litros (escala 3, máx 9999999.999)
    const litersValidation = validateDecimalRange(
      draftFilters.minLiters,
      draftFilters.maxLiters,
      LITERS_CONFIG,
    );
    if (!litersValidation.valid) {
      setErrorLiters(litersValidation.errorMessage ?? 'Litros inválidos');
      hasError = true;
    } else {
      setErrorLiters(null);
    }

    // 4. Validação de Preço por Litro (escala 4, máx 999999.9999)
    const priceValidation = validateDecimalRange(
      draftFilters.minPricePerLiter,
      draftFilters.maxPricePerLiter,
      PRICE_PER_LITER_CONFIG,
    );
    if (!priceValidation.valid) {
      setErrorPrice(priceValidation.errorMessage ?? 'Preço por litro inválido');
      hasError = true;
    } else {
      setErrorPrice(null);
    }

    if (hasError) {
      return;
    }

    onApply({
      ...draftFilters,
      minTotalPaid: paidValidation.minCanonical ?? '',
      maxTotalPaid: paidValidation.maxCanonical ?? '',
      minLiters: litersValidation.minCanonical ?? '',
      maxLiters: litersValidation.maxCanonical ?? '',
      minPricePerLiter: priceValidation.minCanonical ?? '',
      maxPricePerLiter: priceValidation.maxCanonical ?? '',
    });
    onClose();
  };

  // Confirmação do calendário: salva no rascunho e retorna ao passo principal
  const handleConfirmCalendarPeriod = (start: string | null, end: string | null) => {
    setDraftFilters((prev) => ({
      ...prev,
      from: start,
      to: end,
    }));
    setErrorDate(null);
    setCurrentStep('main');
  };

  // Selecionar todo o histórico no calendário
  const handleSelectAllHistory = () => {
    setDraftFilters((prev) => ({
      ...prev,
      from: null,
      to: null,
    }));
    setErrorDate(null);
    setCurrentStep('main');
  };

  const periodSummaryText = formatPeriodSummaryBR(draftFilters.from, draftFilters.to);

  return (
    <AppSheet
      visible={visible}
      title={currentStep === 'main' ? 'Filtrar histórico' : 'Selecionar período'}
      onClose={handleCancel}
    >
      {currentStep === 'calendar' ? (
        <View style={styles.calendarContainer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar para filtros"
            onPress={() => setCurrentStep('main')}
            style={[styles.backButton, { backgroundColor: colors.bgSecondary }]}
          >
            <ChevronLeftIcon size={18} color={colors.textPrimary} />
            <Text style={[styles.backButtonText, { color: colors.textPrimary }]}>
              Voltar para filtros
            </Text>
          </Pressable>

          <CalendarRangePicker
            initialStart={draftFilters.from}
            initialEnd={draftFilters.to}
            onConfirm={handleConfirmCalendarPeriod}
            onSelectAllHistory={handleSelectAllHistory}
          />
        </View>
      ) : (
        <View style={styles.mainContainer}>
          {/* Seção 1: Linha de Período navegável para o calendário */}
          <View style={styles.sectionBlock}>
            <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
              Período
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Selecionar período. Atual: ${periodSummaryText}`}
              onPress={() => setCurrentStep('calendar')}
              style={[
                styles.periodSelectorCard,
                {
                  backgroundColor: colors.bgSecondary,
                  borderColor: errorDate ? colors.dangerBorder : colors.borderSubtle,
                },
              ]}
            >
              <View style={styles.periodSelectorLeft}>
                <CalendarIcon size={20} color={colors.accentPrimary} />
                <View style={styles.periodTextCol}>
                  <Text style={[styles.periodTitle, { color: colors.textPrimary }]}>
                    {periodSummaryText}
                  </Text>
                  <Text style={[styles.periodSubtitle, { color: colors.textSecondary }]}>
                    Toque para alterar as datas
                  </Text>
                </View>
              </View>
              <ChevronRightIcon size={20} color={colors.textSecondary} />
            </Pressable>
            {errorDate ? (
              <Text style={[styles.errorText, { color: colors.dangerText }]}>
                {errorDate}
              </Text>
            ) : null}
          </View>

          {/* Seção 2: Tipo de Combustível (removido tanque conforme especificação) */}
          <View style={styles.sectionBlock}>
            <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
              Tipo de combustível
            </Text>
            <View style={styles.fuelChipsWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Todos os combustíveis"
                accessibilityState={{ selected: draftFilters.fuelType === null }}
                onPress={() => setDraftFilters((prev) => ({ ...prev, fuelType: null }))}
                style={[
                  styles.fuelChip,
                  {
                    backgroundColor:
                      draftFilters.fuelType === null
                        ? colors.accentSoft
                        : colors.bgSecondary,
                    borderColor:
                      draftFilters.fuelType === null
                        ? colors.accentPrimary
                        : colors.borderSubtle,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.fuelChipText,
                    {
                      color:
                        draftFilters.fuelType === null
                          ? colors.accentPrimary
                          : colors.textPrimary,
                      fontWeight: draftFilters.fuelType === null ? '700' : '500',
                    },
                  ]}
                >
                  Todos
                </Text>
              </Pressable>

              {allowedFuels.map((type) => {
                const isSelected = draftFilters.fuelType === type;
                const label = FUEL_TYPE_LABELS[type] || type;
                return (
                  <Pressable
                    key={type}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() =>
                      setDraftFilters((prev) => ({
                        ...prev,
                        fuelType: isSelected ? null : type,
                      }))
                    }
                    style={[
                      styles.fuelChip,
                      {
                        backgroundColor: isSelected
                          ? colors.accentSoft
                          : colors.bgSecondary,
                        borderColor: isSelected
                          ? colors.accentPrimary
                          : colors.borderSubtle,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.fuelChipText,
                        {
                          color: isSelected ? colors.accentPrimary : colors.textPrimary,
                          fontWeight: isSelected ? '700' : '500',
                        },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Seção 3: Accordion de Min/Max para Valor Pago, Litros e Preço/Litro */}
          <View style={styles.sectionBlock}>
            <FilterAccordion
              totalPaidMin={draftFilters.minTotalPaid}
              totalPaidMax={draftFilters.maxTotalPaid}
              onChangeTotalPaidMin={(val: string) => {
                setDraftFilters((prev) => ({ ...prev, minTotalPaid: val }));
                setErrorPaid(null);
              }}
              onChangeTotalPaidMax={(val: string) => {
                setDraftFilters((prev) => ({ ...prev, maxTotalPaid: val }));
                setErrorPaid(null);
              }}
              errorTotalPaid={errorPaid}
              litersMin={draftFilters.minLiters}
              litersMax={draftFilters.maxLiters}
              onChangeLitersMin={(val: string) => {
                setDraftFilters((prev) => ({ ...prev, minLiters: val }));
                setErrorLiters(null);
              }}
              onChangeLitersMax={(val: string) => {
                setDraftFilters((prev) => ({ ...prev, maxLiters: val }));
                setErrorLiters(null);
              }}
              errorLiters={errorLiters}
              priceMin={draftFilters.minPricePerLiter}
              priceMax={draftFilters.maxPricePerLiter}
              onChangePriceMin={(val: string) => {
                setDraftFilters((prev) => ({ ...prev, minPricePerLiter: val }));
                setErrorPrice(null);
              }}
              onChangePriceMax={(val: string) => {
                setDraftFilters((prev) => ({ ...prev, maxPricePerLiter: val }));
                setErrorPrice(null);
              }}
              errorPrice={errorPrice}
            />
          </View>

          {/* Barra de Ações Inferiores: Limpar e Aplicar */}
          <View style={styles.footerActionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Limpar filtros"
              onPress={handleClearDraft}
              style={[
                styles.clearBtn,
                {
                  borderColor: colors.borderStrong,
                  backgroundColor: 'transparent',
                },
              ]}
            >
              <Text style={[styles.clearBtnText, { color: colors.textPrimary }]}>
                Limpar
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Aplicar filtros"
              onPress={handleApply}
              style={[
                styles.applyBtn,
                {
                  backgroundColor: colors.accentPrimary,
                },
              ]}
            >
              <Text style={styles.applyBtnText}>Aplicar</Text>
            </Pressable>
          </View>
        </View>
      )}
    </AppSheet>
  );
}

const styles = StyleSheet.create({
  mainContainer: {
    gap: 20,
    paddingBottom: 8,
  },
  calendarContainer: {
    gap: 16,
    paddingBottom: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    marginBottom: 4,
  },
  backButtonText: {
    ...typography.bodyStrong,
    fontSize: 14,
    fontWeight: '600',
  },
  sectionBlock: {
    gap: 8,
  },
  sectionLabel: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  periodSelectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    minHeight: 48,
  },
  periodSelectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  periodTextCol: {
    flex: 1,
    gap: 2,
  },
  periodTitle: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  periodSubtitle: {
    ...typography.caption,
    fontSize: 12,
  },
  fuelChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fuelChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fuelChipText: {
    ...typography.caption,
    fontSize: 13,
  },
  footerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 12,
    paddingTop: 8,
    flexWrap: 'wrap',
  },
  clearBtn: {
    flex: 1,
    minWidth: 120,
    minHeight: 44,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  clearBtnText: {
    ...typography.bodyStrong,
    fontSize: 15,
  },
  applyBtn: {
    flex: 2,
    minWidth: 150,
    minHeight: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  applyBtnText: {
    ...typography.bodyStrong,
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
    marginTop: 2,
  },
});
