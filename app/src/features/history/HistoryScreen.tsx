import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
  TANK_STATE_LABELS,
  TANK_STATE_SHORT_LABELS,
} from '@/api/endpoints';
import {
  ApiError,
  ConsumptionCycle,
  FuelEntry,
  FuelType,
  SummaryResponse,
  TankState,
} from '@/api/types';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { PixelMascot } from '@/components/brand/PixelMascot';
import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
} from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { FloatingDock } from '@/components/navigation/FloatingDock';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, shadows, typography } from '@/theme/tokens';
import {
  formatDateTimeRowBR,
  groupMonthLabelBR,
  listRecentMonthPeriods,
} from '@/utils/date';
import {
  formatConsumptionBR,
  formatCurrencyBRL,
  formatLitersBR,
  formatOdometerBR,
  formatUnitPriceBR,
} from '@/utils/decimal';

const PAGE_SIZE = 30;

const WEEKDAY_NAMES_PT = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];

function formatHistoryItemDate(
  iso: string,
  timezone?: string,
): string {
  try {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      const tz = timezone || 'America/Sao_Paulo';
      const day = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        timeZone: tz,
      }).format(d);
      const wdShort = new Intl.DateTimeFormat('pt-BR', {
        weekday: 'short',
        timeZone: tz,
      })
        .format(d)
        .replace(/\./g, '')
        .trim();
      const cleanWd = wdShort.split('-')[0] || '';
      const capitalizedWd = cleanWd
        ? cleanWd.charAt(0).toUpperCase() + cleanWd.slice(1)
        : WEEKDAY_NAMES_PT[d.getDay()]?.slice(0, 3) ?? '';
      return capitalizedWd ? `${day}, ${capitalizedWd}` : day;
    }
  } catch {
    // Fallback below
  }
  return iso.slice(8, 10);
}

export function HistoryScreen({
  embeddedInShell = false,
}: {
  embeddedInShell?: boolean;
} = {}) {
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

  const [useAllPeriods, setUseAllPeriods] = useState(false);
  const [filterFuel, setFilterFuel] = useState<FuelType | null>(null);
  const [filterTank, setFilterTank] = useState<TankState | null>(null);

  const [entries, setEntries] = useState<FuelEntry[]>([]);
  const [periodSummary, setPeriodSummary] = useState<SummaryResponse | null>(
    null,
  );
  const [cyclesByEndEntry, setCyclesByEndEntry] = useState<
    Record<string, ConsumptionCycle>
  >({});
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestSeqRef = useRef(0);
  const latestContextKeyRef = useRef('');
  const lastIdentityScopeRef = useRef('');

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [vehicleSheetOpen, setVehicleSheetOpen] = useState(false);

  const monthOptions = useMemo(() => listRecentMonthPeriods(12), []);
  const params = useLocalSearchParams<{ vehicleId?: string; from?: string; to?: string }>();
  const lastAppliedParamsKeyRef = useRef<string>('');

  useEffect(() => {
    const key = `${params.vehicleId ?? ''}:${params.from ?? ''}:${params.to ?? ''}`;
    if (!key || key === '::' || key === lastAppliedParamsKeyRef.current) {
      return;
    }
    lastAppliedParamsKeyRef.current = key;

    if (params.vehicleId) {
      void selectVehicle(params.vehicleId);
    }
    if (params.from && params.to) {
      setUseAllPeriods(false);
      const found = monthOptions.find((p) => p.from === params.from && p.to === params.to);
      if (found) {
        setSelectedPeriod(found);
      }
    }
  }, [params.vehicleId, params.from, params.to, monthOptions, selectVehicle, setSelectedPeriod]);

  const currentContextKey = `${status}:${user?.id ?? 'anon'}:${
    activeVehicle?.id ?? 'none'
  }:${useAllPeriods ? 'ALL' : `${selectedPeriod.from}_${selectedPeriod.to}`}:${
    filterFuel ?? 'ALL'
  }:${filterTank ?? 'ALL'}:${dataVersion}`;
  latestContextKeyRef.current = currentContextKey;

  const loadPage = useCallback(
    async (targetPage: number, append: boolean) => {
      const seq = ++requestSeqRef.current;
      const identityScope = `${status}:${user?.id ?? 'anon'}:${
        activeVehicle?.id ?? 'none'
      }`;
      const contextSnap = `${identityScope}:${
        useAllPeriods ? 'ALL' : `${selectedPeriod.from}_${selectedPeriod.to}`
      }:${filterFuel ?? 'ALL'}:${filterTank ?? 'ALL'}:${dataVersion}`;
      latestContextKeyRef.current = contextSnap;

      if (
        lastIdentityScopeRef.current !== identityScope ||
        status !== 'authenticated' ||
        !user ||
        !activeVehicle
      ) {
        lastIdentityScopeRef.current = identityScope;
        setEntries([]);
        setPeriodSummary(null);
        setCyclesByEndEntry({});
        setPage(0);
        setTotalPages(0);
        setTotalElements(0);
        setLoadingMore(false);
      } else if (!append) {
        setLoadingMore(false);
      }

      setErrorMessage(null);

      if (status !== 'authenticated' || !user || !activeVehicle) {
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      const targetVehicleId = activeVehicle.id;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const fromParam = useAllPeriods ? undefined : selectedPeriod.from;
        const toParam = useAllPeriods ? undefined : selectedPeriod.to;

        const [pageData, summaryData, cyclesData] = await Promise.all([
          listFuelEntries(targetVehicleId, {
            from: fromParam,
            to: toParam,
            fuelType: filterFuel,
            tankState: filterTank,
            page: targetPage,
            size: PAGE_SIZE,
          }),
          targetPage === 0 && typeof getVehicleSummary === 'function'
            ? getVehicleSummary(targetVehicleId, {
                from: fromParam,
                to: toParam,
              }).catch(() => null)
            : Promise.resolve(null),
          targetPage === 0
            ? getConsumptionCycles(targetVehicleId, {
                from: fromParam,
                to: toParam,
              }).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (
          requestSeqRef.current !== seq ||
          latestContextKeyRef.current !== contextSnap
        ) {
          return;
        }

        setEntries((prev) =>
          append ? [...prev, ...pageData.items] : pageData.items,
        );
        setPage(pageData.page);
        setTotalPages(pageData.totalPages);
        setTotalElements(pageData.totalElements);

        if (!append) {
          setPeriodSummary(summaryData);
          const map: Record<string, ConsumptionCycle> = {};
          for (const c of cyclesData?.items ?? []) {
            map[c.endEntryId] = c;
          }
          setCyclesByEndEntry(map);
        } else if (cyclesData?.items) {
          const map: Record<string, ConsumptionCycle> = {};
          for (const c of cyclesData.items) {
            map[c.endEntryId] = c;
          }
          setCyclesByEndEntry(map);
        }
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
          setErrorMessage('Não foi possível carregar o histórico.');
        }
      } finally {
        if (
          requestSeqRef.current === seq &&
          latestContextKeyRef.current === contextSnap
        ) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [
      activeVehicle,
      dataVersion,
      filterFuel,
      filterTank,
      selectedPeriod.from,
      selectedPeriod.to,
      status,
      useAllPeriods,
      user,
    ],
  );

  useEffect(() => {
    if (status !== 'authenticated' || !user || !activeVehicle) {
      requestSeqRef.current += 1;
      setEntries([]);
      setPeriodSummary(null);
      setCyclesByEndEntry({});
      setPage(0);
      setTotalPages(0);
      setTotalElements(0);
      setErrorMessage(null);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    void loadPage(0, false);
    return () => {
      requestSeqRef.current += 1;
    };
  }, [activeVehicle, loadPage, status, user]);

  const groupedSections = useMemo(() => {
    const groups: { title: string; items: FuelEntry[] }[] = [];
    for (const entry of entries) {
      const monthLabel = groupMonthLabelBR(entry.occurredAt, entry.timezone);
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.title !== monthLabel) {
        groups.push({ title: monthLabel, items: [entry] });
      } else {
        lastGroup.items.push(entry);
      }
    }
    return groups;
  }, [entries]);

  const surfaceBg = colors.surface;
  const surfaceBorder = colors.borderSubtle;

  const vehiclePillLabel = activeVehicle
    ? [
        activeVehicle.nickname,
        activeVehicle.modelYear ? `• ${activeVehicle.modelYear}` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : 'Selecionar veículo';

  return (
    <ScreenShell
      withDockClearance
      omitTopSafeArea={embeddedInShell}
      footer={embeddedInShell ? undefined : <FloatingDock activeTab="history" />}
    >
      {/* Top Row: Wordmark on left + Mascot Avatar on right */}
      {!embeddedInShell ? (
        <View style={styles.topHeader}>
          <BrandLockup mode="wordmark-only" wordmarkWidth={146} />
          <PixelMascot variant="avatar" size={30} withFrame />
        </View>
      ) : null}

      {/* Title with Pixel Notebook Icon */}
      <View style={styles.historyTitleRow}>
        <Image
          source={require('@/assets/brand/pixel_notebook.png')}
          style={{ width: 28, height: 35 }}
          resizeMode="contain"
        />
        <Text style={[styles.historyTitleText, { color: colors.textPrimary }]}>
          Histórico
        </Text>
      </View>

      {vehicles.length > 0 ? (
        <View style={styles.controlsBlock}>
          {/* 2-Column Filters Row: Vehicle + Period (Print 3) */}
          <View style={styles.filterTwoColRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Veículo: ${vehiclePillLabel}`}
              onPress={() => setVehicleSheetOpen(true)}
              style={[
                styles.dropdownPill,
                {
                  backgroundColor: surfaceBg,
                  borderColor: surfaceBorder,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[styles.dropdownPillText, { color: colors.textPrimary }]}
              >
                {vehiclePillLabel}
              </Text>
              <ChevronDownIcon size={16} color={colors.brandPrimary} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Período: ${
                useAllPeriods ? 'Todos os meses' : selectedPeriod.label
              }`}
              onPress={() => setFilterSheetOpen(true)}
              style={[
                styles.dropdownPill,
                {
                  backgroundColor: surfaceBg,
                  borderColor: surfaceBorder,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[styles.dropdownPillText, { color: colors.textPrimary }]}
              >
                {useAllPeriods ? 'Todos os meses' : selectedPeriod.label}
              </Text>
              <ChevronDownIcon size={16} color={colors.brandPrimary} />
            </Pressable>
          </View>

          {/* Period Totals Bar: Total no período | Litros registrados */}
          <View style={styles.summaryBar}>
            <View style={styles.summaryCol}>
              <Text
                style={[styles.summaryLabel, { color: colors.textSecondary }]}
              >
                Total no período
              </Text>
              <Text
                style={[styles.summaryValue, { color: colors.textPrimary }]}
              >
                {formatCurrencyBRL(periodSummary?.paidTotal ?? '0.00')}
              </Text>
            </View>

            <View
              style={[
                styles.summaryDivider,
                { backgroundColor: surfaceBorder },
              ]}
            />

            <View style={styles.summaryCol}>
              <Text
                style={[styles.summaryLabel, { color: colors.textSecondary }]}
              >
                Litros registrados
              </Text>
              <Text
                style={[styles.summaryValue, { color: colors.textPrimary }]}
              >
                {formatLitersBR(periodSummary?.purchasedLiters ?? '0.000')}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {errorMessage ? (
        <InlineNotice
          tone="danger"
          message={errorMessage}
          action={
            <PrimaryButton
              label="Tentar novamente"
              variant="secondary"
              onPress={() => loadPage(0, false)}
            />
          }
          style={styles.noticeSpacing}
        />
      ) : null}

      {loading && entries.length === 0 ? (
        <View
          style={[
            styles.loadingBox,
            {
              backgroundColor: surfaceBg,
              borderColor: surfaceBorder,
            },
          ]}
        >
          <ActivityIndicator size="small" color={colors.accentPrimary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Carregando histórico...
          </Text>
        </View>
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nenhum abastecimento encontrado"
          description="Não há lançamentos para os filtros selecionados. Você pode ampliar o período para todo o histórico ou registrar um novo abastecimento."
          action={
            <View style={styles.emptyActions}>
              {!useAllPeriods || filterFuel || filterTank ? (
                <PrimaryButton
                  label="Limpar filtros e ver tudo"
                  variant="secondary"
                  onPress={() => {
                    setUseAllPeriods(true);
                    setFilterFuel(null);
                    setFilterTank(null);
                  }}
                />
              ) : null}
              <PrimaryButton
                label="Novo abastecimento"
                leftIcon={<PlusIcon size={18} color="#FFFFFF" />}
                onPress={() => router.push('/fueling/new')}
              />
            </View>
          }
        />
      ) : (
        <View style={styles.sectionsColumn}>
          {groupedSections.map((group) => {
            const shortMonthHeading = group.title.split(' de ')[0] || group.title;

            return (
              <View
                key={group.title}
                style={[
                  styles.monthSection,
                  {
                    backgroundColor: surfaceBg,
                    borderColor: surfaceBorder,
                  },
                  isDark ? shadows.darkCard : shadows.lightCard,
                ]}
              >
                <View style={[styles.monthHeaderRow, { borderBottomColor: surfaceBorder }]}>
                  <Text style={[styles.monthHeaderText, { color: colors.textPrimary }]}>
                    {shortMonthHeading}
                  </Text>
                </View>

                <View style={styles.rowsStack}>
                  {group.items.map((entry, idx) => {
                    const isLastInMonth = idx === group.items.length - 1;
                    const formattedDate = formatHistoryItemDate(
                      entry.occurredAt,
                      entry.timezone,
                    );
                    const fuelLabel =
                      FUEL_TYPE_LABELS[entry.fuelType] ??
                      FUEL_TYPE_SHORT_LABELS[entry.fuelType] ??
                      entry.fuelType;
                    const fullDateRow = formatDateTimeRowBR(
                      entry.occurredAt,
                      entry.timezone,
                    );

                    return (
                      <Pressable
                        key={entry.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Abastecimento de ${formatCurrencyBRL(
                          entry.paidTotal,
                        )}, ${fuelLabel}, em ${fullDateRow}`}
                        accessibilityHint="Toque para ver os detalhes deste abastecimento"
                        onPress={() =>
                          router.push({
                            pathname: '/fueling/[entryId]',
                            params: { entryId: entry.id },
                          })
                        }
                        style={({ pressed }) => [
                          styles.entryRow,
                          !isLastInMonth && {
                            borderBottomWidth: StyleSheet.hairlineWidth,
                            borderBottomColor: surfaceBorder,
                          },
                          pressed && {
                            backgroundColor: colors.subtle,
                            opacity: 0.85,
                          },
                        ]}
                      >
                        <View style={styles.entryLeftCol}>
                          <Text
                            style={[styles.entryTitle, { color: colors.textPrimary }]}
                          >
                            <Text style={styles.entryDateText}>{formattedDate}</Text>
                            <Text style={[styles.entryDot, { color: colors.textSecondary }]}>
                              {' '}•{' '}
                            </Text>
                            <Text style={styles.entryFuelText}>{fuelLabel}</Text>
                          </Text>

                          <Text
                            style={[styles.entrySubtitle, { color: colors.textSecondary }]}
                          >
                            {formatLitersBR(entry.liters)} × {formatUnitPriceBR(entry.unitPrice)}
                          </Text>
                        </View>

                        <View style={styles.entryRightCol}>
                          <Text
                            style={[styles.entryAmount, { color: colors.textPrimary }]}
                          >
                            {formatCurrencyBRL(entry.paidTotal)}
                          </Text>
                          <ChevronRightIcon
                            size={14}
                            color={colors.accentPrimary}
                          />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}

          {page + 1 < totalPages ? (
            <PrimaryButton
              label="Carregar mais registros"
              variant="secondary"
              loading={loadingMore}
              onPress={() => loadPage(page + 1, true)}
            />
          ) : null}

          {/* Mascot Footer */}
          <View style={styles.mascotFooterRow}>
            <PixelMascot variant="full" size={62} />
            <View style={styles.mascotFooterTextCol}>
              <Text
                style={[styles.mascotFooterTitle, { color: colors.textPrimary }]}
              >
                Seu histórico, sempre à mão.
              </Text>
              <Text
                style={[
                  styles.mascotFooterSubtitle,
                  { color: colors.textSecondary },
                ]}
              >
                Toque em um registro para ver os detalhes.
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Sheet: Filtros do Histórico */}
      <AppSheet
        visible={filterSheetOpen}
        title="Filtrar histórico"
        subtitle="Combine período, combustível e estado do tanque"
        onClose={() => setFilterSheetOpen(false)}
      >
        <View style={styles.filterSection}>
          <Text style={[styles.filterHeading, { color: colors.textSecondary }]}>
            Período
          </Text>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: useAllPeriods }}
            aria-checked={useAllPeriods}
            onPress={() => setUseAllPeriods(true)}
            style={[
              styles.sheetRow,
              {
                backgroundColor: useAllPeriods
                  ? colors.accentSoft
                  : colors.bgSecondary,
                borderColor: useAllPeriods
                  ? colors.accentPrimary
                  : colors.borderDefault,
              },
            ]}
          >
            <Text style={[styles.sheetRowText, { color: colors.textPrimary }]}>
              Todo o histórico (sem recorte de mês)
            </Text>
            {useAllPeriods ? (
              <CheckIcon size={16} color={colors.accentPrimary} />
            ) : null}
          </Pressable>

          {monthOptions.slice(0, 6).map((opt) => {
            const isSelected =
              !useAllPeriods && opt.monthKey === selectedPeriod.monthKey;
            return (
              <Pressable
                key={opt.monthKey}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                aria-checked={isSelected}
                onPress={() => {
                  setUseAllPeriods(false);
                  setSelectedPeriod(opt);
                }}
                style={[
                  styles.sheetRow,
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
                <Text
                  style={[styles.sheetRowText, { color: colors.textPrimary }]}
                >
                  {opt.label}
                </Text>
                {isSelected ? (
                  <CheckIcon size={16} color={colors.accentPrimary} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.filterSection}>
          <Text style={[styles.filterHeading, { color: colors.textSecondary }]}>
            Combustível
          </Text>
          <View style={styles.filterPillsWrap}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: filterFuel === null }}
              aria-checked={filterFuel === null}
              onPress={() => setFilterFuel(null)}
              style={[
                styles.optionPill,
                {
                  backgroundColor:
                    filterFuel === null
                      ? colors.accentPrimary
                      : colors.bgSecondary,
                },
              ]}
            >
              <Text
                style={[
                  styles.optionPillText,
                  {
                    color: filterFuel === null ? '#FFFFFF' : colors.textPrimary,
                  },
                ]}
              >
                Todos
              </Text>
            </Pressable>
            {(activeVehicle?.allowedFuels ?? []).map((fuel) => {
              const isSelected = filterFuel === fuel;
              return (
                <Pressable
                  key={fuel}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  aria-checked={isSelected}
                  onPress={() => setFilterFuel(fuel)}
                  style={[
                    styles.optionPill,
                    {
                      backgroundColor: isSelected
                        ? colors.accentPrimary
                        : colors.bgSecondary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionPillText,
                      { color: isSelected ? '#FFFFFF' : colors.textPrimary },
                    ]}
                  >
                    {FUEL_TYPE_LABELS[fuel]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.filterSection}>
          <Text style={[styles.filterHeading, { color: colors.textSecondary }]}>
            Estado do tanque
          </Text>
          <View style={styles.filterPillsWrap}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: filterTank === null }}
              aria-checked={filterTank === null}
              onPress={() => setFilterTank(null)}
              style={[
                styles.optionPill,
                {
                  backgroundColor:
                    filterTank === null
                      ? colors.accentPrimary
                      : colors.bgSecondary,
                },
              ]}
            >
              <Text
                style={[
                  styles.optionPillText,
                  {
                    color: filterTank === null ? '#FFFFFF' : colors.textPrimary,
                  },
                ]}
              >
                Todos
              </Text>
            </Pressable>
            {(['FULL', 'PARTIAL', 'UNKNOWN'] as TankState[]).map((st) => {
              const isSelected = filterTank === st;
              return (
                <Pressable
                  key={st}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  aria-checked={isSelected}
                  onPress={() => setFilterTank(st)}
                  style={[
                    styles.optionPill,
                    {
                      backgroundColor: isSelected
                        ? colors.accentPrimary
                        : colors.bgSecondary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionPillText,
                      { color: isSelected ? '#FFFFFF' : colors.textPrimary },
                    ]}
                  >
                    {TANK_STATE_LABELS[st]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <PrimaryButton
          label="Aplicar filtros"
          onPress={() => setFilterSheetOpen(false)}
        />
      </AppSheet>

      {/* Sheet: Seletor de veículo */}
      <AppSheet
        visible={vehicleSheetOpen}
        title="Veículo do histórico"
        onClose={() => setVehicleSheetOpen(false)}
      >
        {vehicles.map((vehicle) => {
          const isSelected = activeVehicle?.id === vehicle.id;
          return (
            <Pressable
              key={vehicle.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              aria-checked={isSelected}
              onPress={async () => {
                await selectVehicle(vehicle.id);
                setVehicleSheetOpen(false);
              }}
              style={[
                styles.sheetRow,
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
              <Text style={[styles.sheetRowText, { color: colors.textPrimary }]}>
                {vehicle.nickname}
              </Text>
              {isSelected ? (
                <CheckIcon size={16} color={colors.accentPrimary} />
              ) : null}
            </Pressable>
          );
        })}
      </AppSheet>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  historyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  historyTitleText: {
    ...typography.screenTitle,
    fontSize: 26,
    fontWeight: '800',
  },
  filterTwoColRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
  },
  dropdownPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1.5,
  },
  dropdownPillText: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  screenTitle: {
    ...typography.screenTitle,
    fontSize: 28,
    lineHeight: 34,
  },
  newEntrySquareBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlsBlock: {
    gap: 10,
    marginBottom: 14,
  },
  selectorPill: {
    minHeight: 44,
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectorPillText: {
    flex: 1,
    ...typography.bodyStrong,
    fontSize: 14,
  },
  secondControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  periodPill: {
    flex: 1.85,
  },
  filterPill: {
    flex: 1,
    justifyContent: 'space-between',
  },
  filterActiveText: {
    flex: 1,
    ...typography.caption,
    fontSize: 12,
  },
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 16,
  },
  summaryCol: {
    flex: 1,
    gap: 2,
  },
  summaryDivider: {
    width: 1,
    height: 38,
  },
  summaryLabel: {
    ...typography.caption,
    fontSize: 13,
  },
  summaryValue: {
    ...typography.heroValue,
    fontSize: 24,
    lineHeight: 30,
  },
  noticeSpacing: {
    marginBottom: 12,
  },
  loadingBox: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    ...typography.caption,
  },
  emptyActions: {
    gap: 10,
  },
  sectionsColumn: {
    gap: 16,
  },
  monthSection: {
    borderRadius: radii.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  monthHeaderRow: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  monthHeaderText: {
    ...typography.cardTitle,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  rowsStack: {
    gap: 0,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  entryLeftCol: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
    gap: 3,
  },
  entryTitle: {
    ...typography.bodyStrong,
    fontSize: 15,
    lineHeight: 20,
  },
  entryDateText: {
    fontWeight: '600',
  },
  entryDot: {
    fontWeight: '400',
  },
  entryFuelText: {
    fontWeight: '600',
  },
  entrySubtitle: {
    ...typography.caption,
    fontSize: 13,
    lineHeight: 18,
  },
  entryRightCol: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    flexShrink: 0,
  },
  entryAmount: {
    ...typography.cardTitle,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  mascotFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 8,
    paddingBottom: 18,
    paddingHorizontal: 4,
  },
  mascotFooterTextCol: {
    flex: 1,
    gap: 2,
  },
  mascotFooterTitle: {
    ...typography.bodyStrong,
    fontSize: 15,
  },
  mascotFooterSubtitle: {
    ...typography.caption,
    fontSize: 13,
  },
  filterSection: {
    gap: 8,
  },
  filterHeading: {
    ...typography.caption,
  },
  sheetRow: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetRowText: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  filterPillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
  },
  optionPillText: {
    ...typography.caption,
    fontSize: 12,
  },
});
