import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getConsumptionCycles,
  getVehicleSummary,
} from '@/api/endpoints';
import {
  CyclesResponse,
  SummaryResponse,
  UnavailableReason,
  Vehicle,
} from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
} from '@/components/icons/AppIcons';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useMotionPolicy } from '@/motion/useMotionPolicy';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';
import { listRecentMonthPeriods, MonthPeriodOption } from '@/utils/date';
import {
  formatConsumptionBR,
  formatCurrencyBRL,
  formatLitersBR,
  formatOdometerBR,
  formatUnitPriceBR,
} from '@/utils/decimal';

export interface MonthlySummaryModalProps {
  visible: boolean;
  onClose: () => void;
}

const UNAVAILABLE_REASON_MESSAGES: Record<UnavailableReason, string> = {
  NEEDS_FULL_TANK_BASELINE:
    'Necessário pelo menos um abastecimento com tanque cheio anterior como linha de base.',
  OPEN_CYCLE:
    'Ciclo em andamento: aguardando o próximo abastecimento com tanque cheio para fechar o ciclo.',
  HISTORY_GAP:
    'Houve abastecimento intermediário não registrado, interrompendo o ciclo de consumo.',
  ZERO_DISTANCE:
    'Quilometragem igual à do registro anterior (distância zero).',
  NO_VALID_CYCLE_IN_PERIOD:
    'Não há ciclos de consumo concluídos no período selecionado.',
};

export function MonthlySummaryModal({
  visible,
  onClose,
}: MonthlySummaryModalProps) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { reduceMotion } = useMotionPolicy();
  const {
    status,
    user,
    vehicles,
    activeVehicle,
    selectVehicle,
    selectedPeriod: sessionPeriod,
    setSelectedPeriod: setSessionPeriod,
  } = useSession();

  const monthOptions = React.useMemo(() => listRecentMonthPeriods(12), []);

  const [currentVehicle, setCurrentVehicle] = useState<Vehicle | null>(
    activeVehicle,
  );
  const [currentPeriod, setCurrentPeriod] = useState<MonthPeriodOption>(
    sessionPeriod ?? monthOptions[0],
  );

  const [vehicleDropdownOpen, setVehicleDropdownOpen] = useState(false);
  const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [cycles, setCycles] = useState<CyclesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync with session when modal becomes visible
  useEffect(() => {
    if (visible) {
      if (activeVehicle) setCurrentVehicle(activeVehicle);
      if (sessionPeriod) setCurrentPeriod(sessionPeriod);
    }
  }, [visible, activeVehicle, sessionPeriod]);

  const requestSeqRef = React.useRef(0);
  const lastIdentityScopeRef = React.useRef('');

  // Fetch summary and consumption cycles whenever vehicle or period changes
  useEffect(() => {
    const identityScope = `${status}:${user?.id ?? 'anon'}:${currentVehicle?.id ?? 'none'}`;
    if (lastIdentityScopeRef.current !== identityScope) {
      lastIdentityScopeRef.current = identityScope;
      setSummary(null);
      setCycles(null);
    }

    if (!visible || !currentVehicle || status !== 'authenticated' || !user) {
      requestSeqRef.current++;
      setSummary(null);
      setCycles(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const seq = ++requestSeqRef.current;
    // Clear previous results immediately upon vehicle/period change to avoid showing stale data
    setSummary(null);
    setCycles(null);
    setLoading(true);
    setErrorMessage(null);

    Promise.all([
      getVehicleSummary(currentVehicle.id, {
        from: currentPeriod.from,
        to: currentPeriod.to,
      }),
      getConsumptionCycles(currentVehicle.id, {
        from: currentPeriod.from,
        to: currentPeriod.to,
      }),
    ])
      .then(([summaryRes, cyclesRes]) => {
        if (!cancelled && requestSeqRef.current === seq) {
          setSummary(summaryRes);
          setCycles(cyclesRes);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && requestSeqRef.current === seq) {
          setSummary(null);
          setCycles(null);
          setErrorMessage(
            err instanceof Error
              ? err.message
              : 'Não foi possível carregar os dados do resumo mensal.',
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      requestSeqRef.current++;
    };
  }, [visible, currentVehicle?.id, currentPeriod.from, currentPeriod.to, status, user]);

  const handleSelectVehicle = (veh: Vehicle) => {
    setCurrentVehicle(veh);
    setVehicleDropdownOpen(false);
    void selectVehicle(veh.id);
  };

  const handleSelectPeriod = (p: MonthPeriodOption) => {
    setCurrentPeriod(p);
    setMonthDropdownOpen(false);
    setSessionPeriod(p);
  };

  const handleNavigateToHistory = () => {
    if (currentVehicle) {
      void selectVehicle(currentVehicle.id);
    }
    setSessionPeriod(currentPeriod);
    onClose();
    router.push({
      pathname: '/history',
      params: {
        vehicleId: currentVehicle?.id,
        from: currentPeriod.from,
        to: currentPeriod.to,
      },
    });
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'none' : 'slide'}
      transparent={false}
      onRequestClose={onClose}
    >
      <SafeAreaView
        edges={['top', 'left', 'right', 'bottom']}
        style={[styles.modalScreen, { backgroundColor: colors.bgPrimary }]}
      >
        {/* Top Header */}
        <View style={[styles.headerBar, { borderBottomColor: colors.borderSubtle }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar resumo"
            onPress={onClose}
            style={[styles.backBtn, { borderColor: colors.borderSubtle, backgroundColor: colors.surface }]}
          >
            <ChevronLeftIcon size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
            Resumo mensal
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Dual Selectors: Vehicle and Month */}
          <View style={styles.selectorsRow}>
            {/* Vehicle Selector */}
            <View style={styles.selectorCol}>
              <Text style={[styles.selectorLabel, { color: colors.textSecondary }]}>
                Veículo
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Veículo: ${currentVehicle?.nickname ?? 'Selecionar'}`}
                onPress={() => {
                  setVehicleDropdownOpen((prev) => !prev);
                  setMonthDropdownOpen(false);
                }}
                style={[
                  styles.selectorBox,
                  {
                    backgroundColor: colors.surface,
                    borderColor: vehicleDropdownOpen ? colors.brandPrimary : colors.borderSubtle,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.selectorValueText, { color: colors.textPrimary }]}
                >
                  {currentVehicle?.nickname ?? 'Selecione'}
                </Text>
                <View style={vehicleDropdownOpen ? { transform: [{ rotate: '180deg' }] } : undefined}>
                  <ChevronDownIcon size={16} color={colors.textSecondary} />
                </View>
              </Pressable>

              {vehicleDropdownOpen ? (
                <View style={[styles.dropdownMenu, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
                  {vehicles.map((v) => {
                    const isSelected = v.id === currentVehicle?.id;
                    return (
                      <Pressable
                        key={v.id}
                        onPress={() => handleSelectVehicle(v)}
                        style={[
                          styles.dropdownItem,
                          isSelected && { backgroundColor: colors.accentSoft },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dropdownItemText,
                            { color: isSelected ? colors.brandPrimary : colors.textPrimary },
                          ]}
                        >
                          {v.nickname}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>

            {/* Month Selector */}
            <View style={styles.selectorCol}>
              <Text style={[styles.selectorLabel, { color: colors.textSecondary }]}>
                Mês
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Mês: ${currentPeriod.label}`}
                onPress={() => {
                  setMonthDropdownOpen((prev) => !prev);
                  setVehicleDropdownOpen(false);
                }}
                style={[
                  styles.selectorBox,
                  {
                    backgroundColor: colors.surface,
                    borderColor: monthDropdownOpen ? colors.brandPrimary : colors.borderSubtle,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.selectorValueText, { color: colors.textPrimary }]}
                >
                  {currentPeriod.label}
                </Text>
                <View style={monthDropdownOpen ? { transform: [{ rotate: '180deg' }] } : undefined}>
                  <ChevronDownIcon size={16} color={colors.textSecondary} />
                </View>
              </Pressable>

              {monthDropdownOpen ? (
                <View style={[styles.dropdownMenu, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
                  {monthOptions.map((p) => {
                    const isSelected = p.from === currentPeriod.from && p.to === currentPeriod.to;
                    return (
                      <Pressable
                        key={p.from + p.to}
                        onPress={() => handleSelectPeriod(p)}
                        style={[
                          styles.dropdownItem,
                          isSelected && { backgroundColor: colors.accentSoft },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dropdownItemText,
                            { color: isSelected ? colors.brandPrimary : colors.textPrimary },
                          ]}
                        >
                          {p.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          </View>

          {errorMessage ? (
            <InlineNotice tone="danger" message={errorMessage} />
          ) : null}

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={colors.brandPrimary} />
            </View>
          ) : (
            <>
              {/* Hero Summary Card */}
              <View
                style={[
                  styles.heroCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderSubtle,
                  },
                ]}
              >
                <View style={styles.heroRow}>
                  <View style={styles.heroCol}>
                    <Text style={[styles.heroPeriodLabel, { color: colors.textSecondary }]}>
                      {currentPeriod.label}
                    </Text>
                    <Text style={[styles.heroHeading, { color: colors.textPrimary }]}>
                      Gasto no mês
                    </Text>
                    <Text style={[styles.heroAmount, { color: colors.textPrimary }]}>
                      {formatCurrencyBRL(summary?.paidTotal ?? '0')}
                    </Text>
                    <Text style={[styles.heroEntryCount, { color: colors.textSecondary }]}>
                      {summary?.purchaseCount ?? 0} abastecimento
                      {summary?.purchaseCount === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Image
                    source={require('@/assets/brand/pixel_notebook.png')}
                    style={styles.heroNotebook}
                    resizeMode="contain"
                    accessibilityLabel="Caderninho FuelLog"
                  />
                </View>
              </View>

              {/* Detailed Metrics */}
              <View
                style={[
                  styles.metricsCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderSubtle,
                  },
                ]}
              >
                <View style={styles.metricItemRow}>
                  <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                    Litros registrados
                  </Text>
                  <Text style={[styles.metricValue, { color: colors.textPrimary }]}>
                    {formatLitersBR(summary?.purchasedLiters ?? '0')}
                  </Text>
                </View>

                <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

                <View style={styles.metricItemRow}>
                  <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                    Preço médio pago
                  </Text>
                  <Text style={[styles.metricValue, { color: colors.textPrimary }]}>
                    {summary?.weightedPaidPrice
                      ? `${formatUnitPriceBR(summary.weightedPaidPrice, true)}/L`
                      : '—'}
                  </Text>
                </View>
              </View>

              {/* Consumption Cycles Section */}
              <View
                style={[
                  styles.cyclesCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderSubtle,
                  },
                ]}
              >
                <Text style={[styles.cyclesTitle, { color: colors.textPrimary }]}>
                  Ciclos de consumo
                </Text>

                {summary?.periodConsumptionKmPerLiter ? (
                  <View style={styles.cycleDataWrap}>
                    <View style={styles.metricItemRow}>
                      <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                        Média de consumo
                      </Text>
                      <Text style={[styles.metricValueHighlight, { color: colors.brandPrimary }]}>
                        {formatConsumptionBR(summary.periodConsumptionKmPerLiter)}
                      </Text>
                    </View>

                    <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

                    <View style={styles.metricItemRow}>
                      <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                        Distância percorrida em ciclos
                      </Text>
                      <Text style={[styles.metricValue, { color: colors.textPrimary }]}>
                        {formatOdometerBR(summary.cycleDistanceKm)}
                      </Text>
                    </View>

                    <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

                    <View style={styles.metricItemRow}>
                      <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                        Volume consumido em ciclos
                      </Text>
                      <Text style={[styles.metricValue, { color: colors.textPrimary }]}>
                        {formatLitersBR(summary.cycleLiters)}
                      </Text>
                    </View>

                    {summary.periodReplacementCostPerKm ? (
                      <>
                        <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
                        <View style={styles.metricItemRow}>
                          <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                            Custo por quilômetro
                          </Text>
                          <Text style={[styles.metricValue, { color: colors.textPrimary }]}>
                            {formatCurrencyBRL(summary.periodReplacementCostPerKm)}/km
                          </Text>
                        </View>
                      </>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.cycleNoticeWrap}>
                    <InlineNotice
                      tone="info"
                      title="Consumo não disponível"
                      message={
                        summary?.periodUnavailableReason
                          ? UNAVAILABLE_REASON_MESSAGES[summary.periodUnavailableReason] ??
                            'Sem ciclos de consumo completos no período selecionado.'
                          : 'Necessário registrar pelo menos dois abastecimentos com tanque cheio consecutivos para calcular o consumo.'
                      }
                    />
                  </View>
                )}
              </View>

              {/* Action Button: Navigate to History with Applied Filters */}
              <PrimaryButton
                label="Ver abastecimentos do mês"
                onPress={handleNavigateToHistory}
                stepped
                style={styles.actionBtn}
              />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalScreen: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
  },
  headerSpacer: {
    width: 38,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 36,
  },
  selectorsRow: {
    flexDirection: 'row',
    gap: 12,
    zIndex: 20,
  },
  selectorCol: {
    flex: 1,
    gap: 4,
    position: 'relative',
  },
  selectorLabel: {
    ...typography.caption,
    fontSize: 12,
  },
  selectorBox: {
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorValueText: {
    ...typography.bodyStrong,
    fontSize: 14,
    flex: 1,
    marginRight: 6,
  },
  dropdownMenu: {
    position: 'absolute',
    top: 68,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: radii.md,
    maxHeight: 180,
    zIndex: 50,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  dropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  dropdownItemText: {
    ...typography.body,
    fontSize: 14,
  },
  loadingWrap: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 20,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroCol: {
    flex: 1,
    gap: 4,
  },
  heroPeriodLabel: {
    ...typography.caption,
    fontSize: 13,
  },
  heroHeading: {
    ...typography.cardTitle,
    fontSize: 15,
  },
  heroAmount: {
    ...typography.heroValue,
    fontSize: 32,
    lineHeight: 38,
  },
  heroEntryCount: {
    ...typography.body,
    fontSize: 14,
    marginTop: 2,
  },
  heroNotebook: {
    width: 60,
    height: 66,
  },
  metricsCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cyclesCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cyclesTitle: {
    ...typography.cardTitle,
    fontSize: 16,
  },
  cycleDataWrap: {
    gap: 12,
  },
  cycleNoticeWrap: {
    paddingVertical: 4,
  },
  metricItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  metricLabel: {
    ...typography.body,
    fontSize: 14,
  },
  metricValue: {
    ...typography.bodyStrong,
    fontSize: 15,
  },
  metricValueHighlight: {
    ...typography.heroValue,
    fontSize: 18,
  },
  divider: {
    height: 1,
    width: '100%',
  },
  actionBtn: {
    marginTop: 8,
  },
});
