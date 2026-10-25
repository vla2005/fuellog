import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  FUEL_TYPE_LABELS,
  FUEL_TYPE_SHORT_LABELS,
  getConsumptionCycles,
  getVehicleSummary,
  listFuelEntries,
  TANK_STATE_SHORT_LABELS,
  UNAVAILABLE_REASON_EXPLANATIONS,
} from '@/api/endpoints';
import {
  ApiError,
  CyclesResponse,
  FuelEntry,
  SummaryResponse,
} from '@/api/types';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { DiagonalPixelSpark, PixelMascot } from '@/components/brand/PixelMascot';
import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import {
  CalendarIcon,
  CarIcon,
  ChartBarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PixelCrossIcon,
  PlusIcon,
  ReceiptLogIcon,
  TagIcon,
  UserIcon,
} from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { FloatingDock } from '@/components/navigation/FloatingDock';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { VehicleFormSheet } from '@/features/vehicles/VehicleFormSheet';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, shadows, typography } from '@/theme/tokens';
import {
  formatDateTimeRowBR,
  listRecentMonthPeriods,
} from '@/utils/date';
import {
  formatConsumptionBR,
  formatCurrencyBRL,
  formatLitersBR,
  formatOdometerBR,
  formatUnitPriceBR,
} from '@/utils/decimal';

export function HomeScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const {
    status,
    user,
    vehicles,
    activeVehicle,
    selectVehicle,
    selectedPeriod,
    setSelectedPeriod,
    dataVersion,
  } = useSession();

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [cyclesData, setCyclesData] = useState<CyclesResponse | null>(null);
  const [recentEntries, setRecentEntries] = useState<FuelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestSeqRef = useRef(0);
  const latestContextKeyRef = useRef('');

  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const [createVehicleOpen, setCreateVehicleOpen] = useState(false);
  const [cycleDetailsOpen, setCycleDetailsOpen] = useState(false);

  const monthOptions = useMemo(() => listRecentMonthPeriods(12), []);

  const currentContextKey = `${status}:${user?.id ?? 'anon'}:${
    activeVehicle?.id ?? 'none'
  }:${selectedPeriod.from}_${selectedPeriod.to}:${dataVersion}`;
  latestContextKeyRef.current = currentContextKey;

  const fetchDashboardData = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    const contextSnap = `${status}:${user?.id ?? 'anon'}:${
      activeVehicle?.id ?? 'none'
    }:${selectedPeriod.from}_${selectedPeriod.to}:${dataVersion}`;
    latestContextKeyRef.current = contextSnap;

    // Limpa imediatamente os dados do contexto anterior para evitar exibir valores de A sob cabeçalho de B
    setSummary(null);
    setCyclesData(null);
    setRecentEntries([]);
    setErrorMessage(null);

    if (status !== 'authenticated' || !user || !activeVehicle) {
      setLoading(false);
      return;
    }

    const targetVehicleId = activeVehicle.id;
    const targetFrom = selectedPeriod.from;
    const targetTo = selectedPeriod.to;

    setLoading(true);
    try {
      const [summaryRes, cyclesRes, entriesPage] = await Promise.all([
        getVehicleSummary(targetVehicleId, {
          from: targetFrom,
          to: targetTo,
        }),
        getConsumptionCycles(targetVehicleId, {
          from: targetFrom,
          to: targetTo,
        }),
        listFuelEntries(targetVehicleId, {
          from: targetFrom,
          to: targetTo,
          page: 0,
          size: 3,
        }),
      ]);

      if (
        requestSeqRef.current !== seq ||
        latestContextKeyRef.current !== contextSnap
      ) {
        return;
      }

      setSummary(summaryRes);
      setCyclesData(cyclesRes);
      setRecentEntries(entriesPage.items);
    } catch (err: unknown) {
      if (
        requestSeqRef.current !== seq ||
        latestContextKeyRef.current !== contextSnap
      ) {
        return;
      }
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Não foi possível carregar o resumo do período.');
      }
    } finally {
      if (
        requestSeqRef.current === seq &&
        latestContextKeyRef.current === contextSnap
      ) {
        setLoading(false);
      }
    }
  }, [
    activeVehicle,
    dataVersion,
    selectedPeriod.from,
    selectedPeriod.to,
    status,
    user,
  ]);

  useEffect(() => {
    if (status !== 'authenticated' || !user || !activeVehicle) {
      requestSeqRef.current += 1;
      setSummary(null);
      setCyclesData(null);
      setRecentEntries([]);
      setErrorMessage(null);
      setLoading(false);
      return;
    }

    void fetchDashboardData();
    return () => {
      requestSeqRef.current += 1;
    };
  }, [activeVehicle, fetchDashboardData, status, user]);

  const lastValidCycle = summary?.lastValidCycle ?? null;

  const consumptionFormatted = formatConsumptionBR(
    lastValidCycle?.consumptionKmPerLiter,
  );

  const activeUnavailableReason = lastValidCycle
    ? null
    : summary?.lastConsumptionUnavailableReason ??
      cyclesData?.currentUnavailableReason ??
      summary?.periodUnavailableReason ??
      null;

  const unavailableExplanation = activeUnavailableReason
    ? UNAVAILABLE_REASON_EXPLANATIONS[activeUnavailableReason]
    : null;

  const effectiveCycleTimezone =
    summary?.timezone || user?.preferredTimezone || 'America/Sao_Paulo';

  const formatCycleDdMm = useCallback(
    (iso: string): string => {
      try {
        const d = new Date(iso);
        if (!Number.isNaN(d.getTime())) {
          return new Intl.DateTimeFormat('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            timeZone: effectiveCycleTimezone,
          }).format(d);
        }
      } catch {
        // Fallback regex
      }
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
      return m ? `${m[3]}/${m[2]}` : iso.slice(0, 10);
    },
    [effectiveCycleTimezone],
  );

  const formatCycleLocalIsoDate = useCallback(
    (iso: string): string => {
      try {
        const d = new Date(iso);
        if (!Number.isNaN(d.getTime())) {
          const parts = new Intl.DateTimeFormat('en-CA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            timeZone: effectiveCycleTimezone,
          }).formatToParts(d);
          const y = parts.find((p) => p.type === 'year')?.value;
          const m = parts.find((p) => p.type === 'month')?.value;
          const day = parts.find((p) => p.type === 'day')?.value;
          if (y && m && day) {
            return `${y}-${m}-${day}`;
          }
        }
      } catch {
        // Fallback below
      }
      return iso.slice(0, 10);
    },
    [effectiveCycleTimezone],
  );

  const lastCycleSubtitle = useMemo(() => {
    if (!lastValidCycle) return '';
    const endIsoDate = formatCycleLocalIsoDate(lastValidCycle.endedAt);
    const inSelectedPeriod =
      (summary?.validCycleCount ?? 0) > 0 &&
      summary?.periodUnavailableReason !== 'NO_VALID_CYCLE_IN_PERIOD' &&
      endIsoDate >= selectedPeriod.from &&
      endIsoDate <= selectedPeriod.to;

    const rangeText = `${formatCycleDdMm(
      lastValidCycle.startedAt,
    )}–${formatCycleDdMm(lastValidCycle.endedAt)}`;

    if (!inSelectedPeriod) {
      return `Ciclo ${rangeText} (${formatLitersBR(lastValidCycle.liters)})`;
    }
    return `Ciclo concluído (${formatLitersBR(lastValidCycle.liters)})`;
  }, [
    formatCycleDdMm,
    formatCycleLocalIsoDate,
    lastValidCycle,
    selectedPeriod.from,
    selectedPeriod.to,
    summary?.periodUnavailableReason,
    summary?.validCycleCount,
  ]);

  const sheetCyclesList = useMemo(() => {
    const periodItems = cyclesData?.items ?? [];
    if (!lastValidCycle) return periodItems;
    const alreadyInList = periodItems.some(
      (c) =>
        c.endEntryId === lastValidCycle.endEntryId &&
        c.startEntryId === lastValidCycle.startEntryId,
    );
    return alreadyInList ? periodItems : [lastValidCycle, ...periodItems];
  }, [cyclesData?.items, lastValidCycle]);

  const vehiclePillLabel = activeVehicle
    ? [
        activeVehicle.nickname,
        activeVehicle.modelYear ? `• ${activeVehicle.modelYear}` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : 'Selecionar veículo';

  const surfaceBg = colors.surface;
  const surfaceBorder = colors.borderSubtle;
  const badgeSquareBg = colors.subtle;

  const litersRegisteredLabel = useMemo(() => {
    const rawLiters = summary?.purchasedLiters ?? '0.000';
    const formatted = formatLitersBR(rawLiters).replace(/\s*L$/, '');
    return `${formatted} litros registrados`;
  }, [summary?.purchasedLiters]);

  return (
    <ScreenShell
      withDockClearance
      footer={<FloatingDock activeTab="home" />}
    >
      {/* Top Header: Wordmark alone on left + Profile circle on right */}
      <View style={styles.topHeader}>
        <BrandLockup mode="wordmark-only" wordmarkWidth={146} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ajustes e conta"
          onPress={() => router.push('/settings')}
          style={[
            styles.profileButton,
            {
              backgroundColor: badgeSquareBg,
            },
          ]}
        >
          <UserIcon size={20} color={colors.textPrimary} />
        </Pressable>
      </View>

      {vehicles.length === 0 ? (
        <View style={styles.emptyVehicleSection}>
          <EmptyState
            title="Bem-vindo ao FuelLog!"
            description="Cadastre seu primeiro veículo para registrar abastecimentos, acompanhar gastos reais e calcular ciclos válidos de consumo."
            action={
              <PrimaryButton
                label="Cadastrar primeiro veículo"
                leftIcon={<PlusIcon size={18} color="#FFFFFF" />}
                onPress={() => setCreateVehicleOpen(true)}
              />
            }
          />
        </View>
      ) : (
        <View style={styles.dashboardStack}>
          {/* 2-Column Selector Row: Vehicle + Period */}
          <View style={styles.selectorRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Veículo selecionado: ${
                activeVehicle?.nickname ?? 'Selecionar veículo'
              }`}
              onPress={() => setVehiclePickerOpen(true)}
              style={[
                styles.selectorPill,
                styles.vehicleSelectorPill,
                {
                  backgroundColor: surfaceBg,
                  borderColor: surfaceBorder,
                },
              ]}
            >
              <CarIcon size={17} color={colors.textPrimary} />
              <Text
                numberOfLines={1}
                style={[styles.selectorPillText, { color: colors.textPrimary }]}
              >
                {vehiclePillLabel}
              </Text>
              <ChevronDownIcon size={16} color={colors.textSecondary} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Período: ${selectedPeriod.label}`}
              onPress={() => setPeriodPickerOpen(true)}
              style={[
                styles.selectorPill,
                styles.periodSelectorPill,
                {
                  backgroundColor: surfaceBg,
                  borderColor: surfaceBorder,
                },
              ]}
            >
              <CalendarIcon size={16} color={colors.textPrimary} />
              <Text
                numberOfLines={1}
                style={[styles.periodPillText, { color: colors.textPrimary }]}
              >
                {selectedPeriod.label}
              </Text>
              <ChevronDownIcon size={15} color={colors.textSecondary} />
            </Pressable>
          </View>

          {errorMessage ? (
            <InlineNotice
              tone="danger"
              title="Falha ao atualizar painel"
              message={errorMessage}
              action={
                <PrimaryButton
                  label="Tentar novamente"
                  variant="secondary"
                  onPress={fetchDashboardData}
                />
              }
            />
          ) : null}

          {/* Hero Card: Gasto no mês */}
          <View
            style={[
              styles.heroCard,
              {
                backgroundColor: surfaceBg,
                borderColor: surfaceBorder,
              },
              isDark ? shadows.darkCard : shadows.lightCard,
            ]}
          >
            <View style={styles.heroLeftColumn}>
              <Text style={[styles.heroLabel, { color: colors.textSecondary }]}>
                Gasto no mês
              </Text>
              <Text
                style={[styles.heroAmount, { color: colors.textPrimary }]}
                accessibilityLabel={`Gasto no mês: ${formatCurrencyBRL(
                  summary?.paidTotal ?? '0.00',
                )}`}
              >
                {loading && !summary
                  ? 'R$ —'
                  : formatCurrencyBRL(summary?.paidTotal ?? '0.00')}
              </Text>
              <Text
                style={[styles.heroSubtitle, { color: colors.textSecondary }]}
              >
                {litersRegisteredLabel}
              </Text>
            </View>

            <View style={styles.heroMascotWrap}>
              <View style={styles.heroSparkTopRight}>
                <DiagonalPixelSpark size={6} />
              </View>
              <PixelMascot
                variant="full"
                size={88}
                pulseKey={`${activeVehicle?.id}-${dataVersion}`}
              />
            </View>
          </View>

          {/* Dual Metric Card: Último consumo & Preço médio */}
          <View
            style={[
              styles.dualMetricCard,
              {
                backgroundColor: surfaceBg,
                borderColor: surfaceBorder,
              },
              isDark ? shadows.darkCard : shadows.lightCard,
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ver detalhes dos ciclos de consumo"
              onPress={() => setCycleDetailsOpen(true)}
              style={styles.metricColumn}
            >
              <View style={styles.metricTitleRow}>
                <ChartBarIcon size={16} color={colors.accentPrimary} />
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  Último consumo
                </Text>
              </View>

              {consumptionFormatted ? (
                <>
                  <Text
                    style={[styles.metricValue, { color: colors.textPrimary }]}
                  >
                    {consumptionFormatted}
                  </Text>
                  <Text
                    style={[styles.metricSubtext, { color: colors.textSecondary }]}
                  >
                    {lastCycleSubtitle}
                  </Text>
                </>
              ) : (
                <>
                  <Text
                    style={[
                      styles.metricUnavailableValue,
                      { color: colors.textMuted },
                    ]}
                  >
                    Em formação
                  </Text>
                  <Text
                    style={[styles.metricSubtext, { color: colors.textSecondary }]}
                  >
                    {unavailableExplanation?.badge ?? 'Toque para entender o ciclo'}
                  </Text>
                </>
              )}
            </Pressable>

            <View
              style={[
                styles.metricDivider,
                { backgroundColor: surfaceBorder },
              ]}
            />

            <View style={styles.metricColumn}>
              <View style={styles.metricTitleRow}>
                <TagIcon size={15} color={colors.accentPrimary} />
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  Preço médio
                </Text>
              </View>

              {summary?.weightedPaidPrice ? (
                <>
                  <Text
                    style={[styles.metricValue, { color: colors.textPrimary }]}
                  >
                    {formatUnitPriceBR(summary.weightedPaidPrice, true)}/L
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.metricSubtext, { color: colors.textSecondary }]}
                  >
                    Média ponderada
                  </Text>
                </>
              ) : (
                <>
                  <Text
                    style={[
                      styles.metricUnavailableValue,
                      { color: colors.textMuted },
                    ]}
                  >
                    Sem compras
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.metricSubtext, { color: colors.textMuted }]}
                  >
                    Média ponderada
                  </Text>
                </>
              )}
            </View>
          </View>

          {/* Primary Action CTA: Novo abastecimento */}
          <PrimaryButton
            label="Novo abastecimento"
            leftIcon={<PixelCrossIcon size={16} color="#FFFFFF" />}
            onPress={() => router.push('/fueling/new')}
          />

          {/* Section: Últimos registros */}
          <View style={styles.recentSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                Últimos registros
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Ver histórico completo"
                onPress={() => router.push('/history')}
                style={styles.seeAllBtn}
              >
                <Text
                  style={[styles.seeAllText, { color: colors.accentPrimary }]}
                >
                  Ver todos
                </Text>
                <ChevronRightIcon size={15} color={colors.accentPrimary} />
              </Pressable>
            </View>

            {loading && recentEntries.length === 0 ? (
              <View
                style={[
                  styles.loadingCard,
                  {
                    backgroundColor: surfaceBg,
                    borderColor: surfaceBorder,
                  },
                ]}
              >
                <ActivityIndicator size="small" color={colors.accentPrimary} />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                  Sincronizando registros do período...
                </Text>
              </View>
            ) : recentEntries.length === 0 ? (
              <View
                style={[
                  styles.emptyRecentCard,
                  {
                    backgroundColor: surfaceBg,
                    borderColor: surfaceBorder,
                  },
                ]}
              >
                <Text
                  style={[styles.emptyRecentTitle, { color: colors.textPrimary }]}
                >
                  Nenhum lançamento em {selectedPeriod.label}
                </Text>
                <Text
                  style={[
                    styles.emptyRecentSubtitle,
                    { color: colors.textSecondary },
                  ]}
                >
                  Toque em &ldquo;Novo abastecimento&rdquo; acima para registrar sua parada no posto.
                </Text>
              </View>
            ) : (
              <View style={styles.entriesList}>
                {recentEntries.map((entry) => {
                  const rowDateFull = formatDateTimeRowBR(
                    entry.occurredAt,
                    entry.timezone,
                  );
                  const shortDayMonth = (
                    rowDateFull.split(',')[0] || rowDateFull
                  )
                    .replace(/\s+de\s+/i, ' ')
                    .replace(/\./g, '')
                    .trim();
                  const fuelLabel =
                    FUEL_TYPE_LABELS[entry.fuelType] ??
                    FUEL_TYPE_SHORT_LABELS[entry.fuelType] ??
                    entry.fuelType;
                  const tankLabel =
                    entry.tankState === 'FULL'
                      ? 'Cheio'
                      : TANK_STATE_SHORT_LABELS[entry.tankState] ?? entry.tankState;

                  return (
                    <Pressable
                      key={entry.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Abastecimento de ${formatCurrencyBRL(
                        entry.paidTotal,
                      )} em ${rowDateFull}`}
                      onPress={() =>
                        router.push({
                          pathname: '/fueling/[entryId]',
                          params: { entryId: entry.id },
                        })
                      }
                      style={({ pressed }) => [
                        styles.entryRow,
                        {
                          borderBottomColor: surfaceBorder,
                          opacity: pressed ? 0.82 : 1,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.entryIconSquare,
                          {
                            backgroundColor: badgeSquareBg,
                          },
                        ]}
                      >
                        <ReceiptLogIcon size={18} color={colors.textPrimary} />
                      </View>

                      <View style={styles.entryCenterCol}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.entryPrimaryLine,
                            { color: colors.textPrimary },
                          ]}
                        >
                          {shortDayMonth} • {fuelLabel}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.entrySecondaryLine,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {formatLitersBR(entry.liters)} •{' '}
                          {formatOdometerBR(entry.odometerKm)} • {tankLabel}
                        </Text>
                      </View>

                      <Text
                        style={[
                          styles.entryPaidValue,
                          { color: colors.textPrimary },
                        ]}
                      >
                        {formatCurrencyBRL(entry.paidTotal)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {/* Brand Footer */}
          <View style={styles.brandFooterRow}>
            <DiagonalPixelSpark size={5} />
            <Text style={[styles.brandFooterText, { color: colors.textSecondary }]}>
              Cada abastecimento conta.
            </Text>
            <DiagonalPixelSpark size={5} />
          </View>
        </View>
      )}

      {/* Sheet: Seletor de veículo */}
      <AppSheet
        visible={vehiclePickerOpen}
        title="Selecionar veículo"
        subtitle="Alterne o veículo ou cadastre um novo"
        onClose={() => setVehiclePickerOpen(false)}
      >
        {vehicles.map((vehicle) => {
          const isSelected = activeVehicle?.id === vehicle.id;
          return (
            <Pressable
              key={vehicle.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              aria-checked={isSelected}
              accessibilityLabel={vehicle.nickname}
              onPress={async () => {
                await selectVehicle(vehicle.id);
                setVehiclePickerOpen(false);
              }}
              style={[
                styles.sheetOptionRow,
                {
                  backgroundColor: isSelected
                    ? colors.accentSoft
                    : colors.bgSecondary,
                  borderColor: isSelected
                    ? colors.accentPrimary
                    : colors.borderDefault,
                },
              ]}
            >
              <View style={styles.sheetOptionText}>
                <Text
                  style={[styles.sheetOptionTitle, { color: colors.textPrimary }]}
                >
                  {vehicle.nickname}
                </Text>
                <Text
                  style={[
                    styles.sheetOptionSubtitle,
                    { color: colors.textSecondary },
                  ]}
                >
                  {[vehicle.brand, vehicle.model, vehicle.plate]
                    .filter(Boolean)
                    .join(' • ') || 'Veículo cadastrado'}
                </Text>
              </View>
              {isSelected ? (
                <CheckIcon size={18} color={colors.accentPrimary} />
              ) : null}
            </Pressable>
          );
        })}

        <PrimaryButton
          label="Cadastrar novo veículo"
          variant="secondary"
          leftIcon={<PlusIcon size={18} color={colors.textPrimary} />}
          onPress={() => {
            setVehiclePickerOpen(false);
            setCreateVehicleOpen(true);
          }}
        />
      </AppSheet>

      {/* Sheet: Seletor de período */}
      <AppSheet
        visible={periodPickerOpen}
        title="Período de consulta"
        subtitle="Selecione o mês para filtrar gastos e ciclos"
        onClose={() => setPeriodPickerOpen(false)}
      >
        {monthOptions.map((option) => {
          const isSelected = option.monthKey === selectedPeriod.monthKey;
          return (
            <Pressable
              key={option.monthKey}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              aria-checked={isSelected}
              accessibilityLabel={option.label}
              onPress={() => {
                setSelectedPeriod(option);
                setPeriodPickerOpen(false);
              }}
              style={[
                styles.sheetOptionRow,
                {
                  backgroundColor: isSelected
                    ? colors.accentSoft
                    : colors.bgSecondary,
                  borderColor: isSelected
                    ? colors.accentPrimary
                    : colors.borderDefault,
                },
              ]}
            >
              <View style={styles.sheetOptionText}>
                <Text
                  style={[styles.sheetOptionTitle, { color: colors.textPrimary }]}
                >
                  {option.label}
                </Text>
                <Text
                  style={[
                    styles.sheetOptionSubtitle,
                    { color: colors.textSecondary },
                  ]}
                >
                  {option.from} até {option.to}
                </Text>
              </View>
              {isSelected ? (
                <CheckIcon size={18} color={colors.accentPrimary} />
              ) : null}
            </Pressable>
          );
        })}
      </AppSheet>

      {/* Sheet: Detalhes dos ciclos de consumo */}
      <AppSheet
        visible={cycleDetailsOpen}
        title="Ciclos de consumo (km/L)"
        subtitle="Cálculo entre tanques cheios consecutivos"
        onClose={() => setCycleDetailsOpen(false)}
      >
        {unavailableExplanation ? (
          <InlineNotice
            tone="warning"
            title={unavailableExplanation.title}
            message={unavailableExplanation.description}
          />
        ) : null}

        {summary?.periodConsumptionKmPerLiter &&
        (summary?.validCycleCount ?? 0) > 1 ? (
          <InlineNotice
            tone="info"
            title={`Média do período (${summary.validCycleCount} ciclos): ${formatConsumptionBR(
              summary.periodConsumptionKmPerLiter,
            )}`}
            message={`Distância acumulada nos ciclos do mês: ${formatOdometerBR(
              summary.cycleDistanceKm,
            )} com ${formatLitersBR(summary.cycleLiters)}.`}
          />
        ) : null}

        {sheetCyclesList.length > 0 ? (
          sheetCyclesList.map((cycle, index) => {
            const isLastValid =
              lastValidCycle &&
              cycle.startEntryId === lastValidCycle.startEntryId &&
              cycle.endEntryId === lastValidCycle.endEntryId;
            return (
              <View
                key={`${cycle.startEntryId}-${cycle.endEntryId}-${index}`}
                style={[
                  styles.cycleCard,
                  {
                    backgroundColor: colors.bgSecondary,
                    borderColor: isLastValid
                      ? colors.borderFocus
                      : colors.borderDefault,
                  },
                ]}
              >
                <View style={styles.cycleCardHeader}>
                  <Text
                    style={[styles.sheetOptionTitle, { color: colors.textPrimary }]}
                  >
                    {formatConsumptionBR(cycle.consumptionKmPerLiter) ??
                      'Ciclo inválido'}
                    {isLastValid ? ' • Último ciclo' : ''}
                  </Text>
                  <Text
                    style={[styles.entryPaidValue, { color: colors.textPrimary }]}
                  >
                    {formatOdometerBR(cycle.distanceKm)}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.sheetOptionSubtitle,
                    { color: colors.textSecondary },
                  ]}
                >
                  Período: {formatCycleDdMm(cycle.startedAt)} a{' '}
                  {formatCycleDdMm(cycle.endedAt)} • Volume:{' '}
                  {formatLitersBR(cycle.liters)} • Pago:{' '}
                  {formatCurrencyBRL(cycle.paidTotal)}
                </Text>
                {cycle.replacementCostPerKm ? (
                  <Text
                    style={[
                      styles.sheetOptionSubtitle,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Custo por km: R${' '}
                    {cycle.replacementCostPerKm.replace('.', ',')}/km
                    {cycle.mixed ? ' • Combustível misto' : ''}
                  </Text>
                ) : null}
              </View>
            );
          })
        ) : (
          <Text style={[styles.sheetOptionSubtitle, { color: colors.textSecondary }]}>
            O FuelLog nunca exibe &ldquo;0 km/L&rdquo; enganoso. Um ciclo válido começa em um abastecimento com tanque cheio e se encerra no próximo tanque cheio sem lacuna de histórico.
          </Text>
        )}

        <PrimaryButton
          label="Fechar"
          variant="secondary"
          onPress={() => setCycleDetailsOpen(false)}
        />
      </AppSheet>

      <VehicleFormSheet
        visible={createVehicleOpen}
        onClose={() => setCreateVehicleOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  profileButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyVehicleSection: {
    marginTop: 20,
  },
  dashboardStack: {
    gap: 14,
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectorPill: {
    minHeight: 44,
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  vehicleSelectorPill: {
    flex: 1,
    minWidth: 0,
  },
  periodSelectorPill: {
    flexShrink: 0,
  },
  selectorPillText: {
    flex: 1,
    ...typography.bodyStrong,
    fontSize: 13,
  },
  periodPillText: {
    ...typography.bodyStrong,
    fontSize: 13,
  },
  heroCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroLeftColumn: {
    flex: 1,
    gap: 6,
  },
  heroLabel: {
    ...typography.body,
    fontSize: 15,
  },
  heroAmount: {
    ...typography.heroValue,
    fontSize: 36,
    lineHeight: 42,
  },
  heroSubtitle: {
    ...typography.body,
    fontSize: 14,
  },
  heroMascotWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: 4,
  },
  heroSparkTopRight: {
    position: 'absolute',
    top: -2,
    right: -2,
    zIndex: 2,
  },
  dualMetricCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 14,
  },
  metricColumn: {
    flex: 1,
    gap: 4,
  },
  metricDivider: {
    width: 1,
    marginVertical: 2,
  },
  metricTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metricLabel: {
    ...typography.body,
    fontSize: 13,
  },
  metricValue: {
    ...typography.cardTitle,
    fontSize: 20,
    lineHeight: 25,
  },
  metricUnavailableValue: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
  metricSubtext: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 16,
  },
  recentSection: {
    marginTop: 4,
    gap: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    fontSize: 19,
  },
  seeAllBtn: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  loadingCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    ...typography.caption,
  },
  emptyRecentCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 18,
    gap: 4,
  },
  emptyRecentTitle: {
    ...typography.bodyStrong,
  },
  emptyRecentSubtitle: {
    ...typography.caption,
  },
  entriesList: {
    gap: 0,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  entryIconSquare: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryCenterCol: {
    flex: 1,
    gap: 3,
  },
  entryPrimaryLine: {
    ...typography.bodyStrong,
    fontSize: 15,
  },
  entrySecondaryLine: {
    ...typography.caption,
    fontSize: 13,
  },
  entryPaidValue: {
    ...typography.cardTitle,
    fontSize: 16,
  },
  brandFooterRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  brandFooterText: {
    ...typography.caption,
    fontSize: 13,
  },
  sheetOptionRow: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sheetOptionText: {
    flex: 1,
    gap: 2,
  },
  sheetOptionTitle: {
    ...typography.bodyStrong,
  },
  sheetOptionSubtitle: {
    ...typography.caption,
  },
  cycleCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  cycleCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
