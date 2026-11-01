import { useGlobalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable as GesturePressable } from 'react-native-gesture-handler';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  FUEL_TYPE_LABELS,
  FUEL_TYPE_SHORT_LABELS,
  listFuelEntries,
} from '@/api/endpoints';
import {
  ApiError,
  FuelEntry,
  FuelType,
  FuelEntryPage,
} from '@/api/types';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { PixelMascot } from '@/components/brand/PixelMascot';
import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import {
  CalendarIcon,
  CarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
} from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { FloatingDock } from '@/components/navigation/FloatingDock';
import { TabActiveContext } from '@/components/navigation/AuthenticatedTabShell';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';
import {
  listRecentMonthPeriods,
} from '@/utils/date';
import {
  formatCurrencyBRL,
  formatLitersBR,
  formatUnitPriceBR,
} from '@/utils/decimal';
import {
  HistoryFilterSheet,
  type HistoryFilterValues,
} from './components/HistoryFilterSheet';
import {
  formatDisplayDateBR,
  formatPeriodSummaryBR,
} from './helpers/calendarHelper';
import { DeleteFuelEntrySheet } from './components/DeleteFuelEntrySheet';
import { HistorySwipeRow } from './components/HistorySwipeRow';

const PAGE_SIZES = [5, 10, 20] as const;
// The new gesture-handler web pressable loses its hit area after the list scrolls.
const EntryPressable = Platform.OS === 'web' ? Pressable : GesturePressable;

function historyDate(iso: string, timezone: string) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return {
    monthKey: `${part('year')}-${part('month')}`,
    day: part('day'),
    month: new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, month: 'short' }).format(date).replace('.', '').toUpperCase(),
    title: new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, month: 'long', year: 'numeric' }).format(date).replace(/^./, letter => letter.toUpperCase()).replace(' de ', ' '),
  };
}

export function HistoryScreen({
  embeddedInShell = false,
}: {
  embeddedInShell?: boolean;
} = {}) {
  const router = useRouter();
  const isTabActive = useContext(TabActiveContext);
  const { colors } = useAppTheme();
  const { width, fontScale } = useWindowDimensions();
  const reflow = width < 360 || fontScale > 1.15;
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

  const [activeFilters, setActiveFilters] = useState<HistoryFilterValues>(() => ({
    from: selectedPeriod.from,
    to: selectedPeriod.to,
    fuelType: null,
    minTotalPaid: '',
    maxTotalPaid: '',
    minLiters: '',
    maxLiters: '',
    minPricePerLiter: '',
    maxPricePerLiter: '',
  }));



  const [entries, setEntries] = useState<FuelEntry[]>([]);
  const [periodSummary, setPeriodSummary] = useState<FuelEntryPage['summary'] | null>(null);
  const [monthlyCounts, setMonthlyCounts] = useState<FuelEntryPage['monthlyCounts']>([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(20);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadedContext, setLoadedContext] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<FuelEntry | null>(null);
  const [sizeSheetOpen, setSizeSheetOpen] = useState(false);
  useEffect(() => { setDeletingEntry(null); }, [activeVehicle?.id, isTabActive, user?.id]);
  const requestSeqRef = useRef(0);
  const latestContextKeyRef = useRef('');
  const lastQueryContextRef = useRef('');

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [vehicleSheetOpen, setVehicleSheetOpen] = useState(false);

  const monthOptions = useMemo(() => listRecentMonthPeriods(12), []);
  const params = useGlobalSearchParams<{ vehicleId?: string; from?: string; to?: string; fuelType?: FuelType;
    occurredFrom?: string; occurredTo?: string; entryId?: string; source?: string; selection?: string }>();
  const [exactSlice,setExactSlice] = useState<{vehicleId?:string;userId?:string;occurredFrom?:string;occurredTo?:string;entryId?:string}>({});
  const slice = exactSlice.vehicleId === activeVehicle?.id && exactSlice.userId === user?.id ? exactSlice : {};
  const sliceKey = `${slice.occurredFrom ?? ''}:${slice.occurredTo ?? ''}:${slice.entryId ?? ''}`;
  const lastAppliedParamsKeyRef = useRef<string>('');

  useEffect(() => {
    const key = JSON.stringify([user?.id,params.vehicleId,params.from,params.to,params.fuelType,params.occurredFrom,params.occurredTo,params.entryId,params.source,params.selection]);
    if (!isTabActive || (!params.vehicleId && !params.from && !params.to) || key === lastAppliedParamsKeyRef.current) {
      return;
    }
    lastAppliedParamsKeyRef.current = key;
    requestSeqRef.current += 1;

    if (params.vehicleId) {
      void selectVehicle(params.vehicleId);
    }
    if (params.source === 'dashboard') {
      setActiveFilters({from:params.from ?? null,to:params.to ?? null,
        fuelType:params.fuelType && params.fuelType in FUEL_TYPE_LABELS ? params.fuelType : null,
        minTotalPaid:'',maxTotalPaid:'',minLiters:'',maxLiters:'',minPricePerLiter:'',maxPricePerLiter:''});
      setExactSlice({vehicleId:params.vehicleId,userId:user?.id,occurredFrom:params.occurredFrom,occurredTo:params.occurredTo,entryId:params.entryId});
    } else if (params.from && params.to) {
      setExactSlice({});
      setActiveFilters((prev) => ({
        ...prev,
        from: params.from ?? null,
        to: params.to ?? null,
      }));
      const found = monthOptions.find((p) => p.from === params.from && p.to === params.to);
      if (found) {
        setSelectedPeriod(found);
      }
    }
  }, [isTabActive,user?.id,params.vehicleId,params.from,params.to,params.fuelType,params.occurredFrom,params.occurredTo,params.entryId,params.source,params.selection,monthOptions,selectVehicle,setSelectedPeriod]);

  const prevSelectedPeriodRef = useRef(selectedPeriod);
  useEffect(() => {
    if (
      prevSelectedPeriodRef.current.from !== selectedPeriod.from ||
      prevSelectedPeriodRef.current.to !== selectedPeriod.to
    ) {
      prevSelectedPeriodRef.current = selectedPeriod;
      setActiveFilters((prev) => ({
        ...prev,
        from: selectedPeriod.from,
        to: selectedPeriod.to,
      }));
    }
  }, [selectedPeriod]);

  const timezone = user?.preferredTimezone || 'America/Sao_Paulo';
  const queryContextKey = JSON.stringify([status, user?.id, activeVehicle?.id, activeFilters, sliceKey, pageSize, timezone]);
  const currentContextKey = `${queryContextKey}:${dataVersion}:${page}`;
  latestContextKeyRef.current = currentContextKey;

  const loadPage = useCallback(async (targetPage: number) => {
    const seq = ++requestSeqRef.current;
    const contextSnap = currentContextKey;
    setEntries([]);
    setPeriodSummary(null);
    setMonthlyCounts([]);
    setTotalElements(0);
    setTotalPages(0);
    setErrorMessage(null);
    if (status !== 'authenticated' || !user || !activeVehicle) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const pageData = await listFuelEntries(activeVehicle.id, {
        from: activeFilters.from ?? undefined,
        to: activeFilters.to ?? undefined,
        timezone,
        fuelType: activeFilters.fuelType,
        occurredFrom: slice.occurredFrom, occurredTo: slice.occurredTo, entryId: slice.entryId,
        minTotalPaid: activeFilters.minTotalPaid || undefined,
        maxTotalPaid: activeFilters.maxTotalPaid || undefined,
        minLiters: activeFilters.minLiters || undefined,
        maxLiters: activeFilters.maxLiters || undefined,
        minPricePerLiter: activeFilters.minPricePerLiter || undefined,
        maxPricePerLiter: activeFilters.maxPricePerLiter || undefined,
        page: targetPage,
        size: pageSize,
      });
      if (requestSeqRef.current !== seq || latestContextKeyRef.current !== contextSnap) return;
      // A deletion or edit can remove the final page from the current slice.
      if (targetPage > 0 && targetPage >= pageData.totalPages) {
        setPage(Math.max(0, pageData.totalPages - 1));
        return;
      }
      setEntries(pageData.items);
      setPeriodSummary(pageData.summary);
      setMonthlyCounts(pageData.monthlyCounts);
      setTotalPages(pageData.totalPages);
      setTotalElements(pageData.totalElements);
      setLoadedContext(contextSnap);
    } catch (err: unknown) {
      if (requestSeqRef.current !== seq || latestContextKeyRef.current !== contextSnap) return;
      setErrorMessage(err instanceof ApiError ? err.message : 'Não foi possível carregar o histórico.');
      setLoadedContext(contextSnap);
    } finally {
      if (requestSeqRef.current === seq && latestContextKeyRef.current === contextSnap) setLoading(false);
    }
  }, [currentContextKey]);

  useEffect(() => {
    const resetPage = lastQueryContextRef.current !== queryContextKey;
    lastQueryContextRef.current = queryContextKey;
    if (resetPage && page !== 0) {
      setPage(0);
      return;
    }
    void loadPage(page);
    return () => { requestSeqRef.current += 1; };
  }, [loadPage, queryContextKey, page]);

  const contextReady = loadedContext === currentContextKey;
  const pending = loading || (!contextReady && status === 'authenticated' && Boolean(activeVehicle));
  const groupedSections = useMemo(() => {
    const groups: { key: string; title: string; count: number; items: FuelEntry[] }[] = [];
    if (!contextReady) return groups;
    for (const entry of entries) {
      const { monthKey } = historyDate(entry.occurredAt, timezone);
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.key !== monthKey) {
        groups.push({ key: monthKey, title: historyDate(entry.occurredAt, timezone).title,
          count: monthlyCounts?.find(month => month.month === monthKey)?.purchaseCount ?? 0, items: [entry] });
      } else lastGroup.items.push(entry);
    }
    return groups;
  }, [contextReady, entries, monthlyCounts, timezone]);

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

  const periodPillLabel = useMemo(() => {
    if (!activeFilters.from && !activeFilters.to) {
      return 'Todo o histórico';
    }
    if (activeFilters.from && activeFilters.to) {
      const found = monthOptions.find(
        (opt) => opt.from === activeFilters.from && opt.to === activeFilters.to,
      );
      if (found) {
        return found.label;
      }
      return `${formatDisplayDateBR(activeFilters.from)} — ${formatDisplayDateBR(activeFilters.to)}`;
    }
    return formatPeriodSummaryBR(activeFilters.from, activeFilters.to);
  }, [activeFilters.from, activeFilters.to, monthOptions]);

  const hasActiveFilters = Boolean(
    activeFilters.from ||
      activeFilters.to ||
      activeFilters.fuelType !== null ||
      activeFilters.minTotalPaid !== '' ||
      activeFilters.maxTotalPaid !== '' ||
      activeFilters.minLiters !== '' ||
      activeFilters.maxLiters !== '' ||
      activeFilters.minPricePerLiter !== '' ||
      activeFilters.maxPricePerLiter !== '',
  );

  return (
    <ScreenShell
      transitionActive={!filterSheetOpen}
      transitionOrder={filterSheetOpen ? 1 : 0}
      withDockClearance
      omitTopSafeArea={embeddedInShell}
      footer={embeddedInShell ? undefined : <FloatingDock activeTab="history" />}
    >
      {deletingEntry && activeVehicle?.id === deletingEntry.vehicleId ? (
        <DeleteFuelEntrySheet
          key={deletingEntry.id}
          entry={deletingEntry}
          vehicleName={activeVehicle.nickname}
          onClose={() => setDeletingEntry(null)}
          onDeleted={(deleted) => {
            setEntries((current) => current.filter((item) => item.id !== deleted.id));
            setDeletingEntry(null);
          }}
        />
      ) : null}
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
          <View testID="history-selectors" style={[styles.filterTwoColRow, reflow && styles.stacked]}>
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
              <CarIcon size={21} color={colors.brandPrimary} />
              <Text style={[styles.dropdownPillText, { color: colors.textPrimary }]}>
                {vehiclePillLabel}
              </Text>
              <ChevronDownIcon size={16} color={colors.brandPrimary} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Período: ${periodPillLabel}`}
              onPress={() => setFilterSheetOpen(true)}
              style={[
                styles.dropdownPill,
                styles.periodSelector,
                {
                  backgroundColor: surfaceBg,
                  borderColor: surfaceBorder,
                },
              ]}
            >
              <CalendarIcon size={21} color={colors.brandPrimary} />
              <Text style={[styles.dropdownPillText, { color: colors.textPrimary }]}>
                {periodPillLabel}
              </Text>
              <ChevronDownIcon size={16} color={colors.brandPrimary} />
            </Pressable>
          </View>

          {slice.occurredFrom || slice.occurredTo || slice.entryId ? <View>
            <Text style={[typography.caption,{color:colors.textSecondary}]}>Recorte exato do gráfico</Text>
            <Pressable accessibilityRole="button" onPress={()=>setExactSlice({})} style={{minHeight:48,justifyContent:'center'}}>
              <Text style={[typography.bodyStrong,{color:colors.brandPrimary}]}>Remover recorte do gráfico</Text>
            </Pressable>
          </View> : null}
          {/* Period Totals Bar: Gasto no período | Litros */}
          <View testID="history-summary" style={[styles.summaryBar, reflow && styles.stacked]}>
            <View style={styles.summaryCol}>
              <Text
                style={[styles.summaryLabel, { color: colors.textSecondary }]}
              >
                Gasto no período
              </Text>
              <Text
                style={[styles.summaryValue, { color: colors.textPrimary }]}
              >
                {contextReady && periodSummary ? formatCurrencyBRL(periodSummary.paidTotal) : '—'}
              </Text>
            </View>

            <View
              style={[
                styles.summaryDivider,
                reflow && styles.summaryDividerHorizontal,
                { backgroundColor: surfaceBorder },
              ]}
            />

            <View style={styles.summaryCol}>
              <Text
                style={[styles.summaryLabel, { color: colors.textSecondary }]}
              >
                Litros
              </Text>
              <Text
                style={[styles.summaryValue, { color: colors.textPrimary }]}
              >
                {contextReady && periodSummary ? formatLitersBR(periodSummary.purchasedLiters) : '—'}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {contextReady && errorMessage ? (
        <InlineNotice
          tone="danger"
          message={errorMessage}
          action={
            <PrimaryButton
              label="Tentar novamente"
              variant="secondary"
              onPress={() => void loadPage(page)}
            />
          }
          style={styles.noticeSpacing}
        />
      ) : null}

      {pending ? (
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
      ) : errorMessage ? null : entries.length === 0 ? (
        <EmptyState
          title="Nenhum abastecimento encontrado"
          description="Não há lançamentos para os filtros selecionados. Você pode ampliar o período para todo o histórico ou registrar um novo abastecimento."
          action={
            <View style={styles.emptyActions}>
              {hasActiveFilters ? (
                <PrimaryButton
                  label="Limpar filtros e ver tudo"
                  variant="secondary"
                  onPress={() => {
                    setExactSlice({});
                    setActiveFilters({
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
          {groupedSections.map((group) => (
            <View key={group.key} style={styles.monthSection}>
              <View style={[styles.monthHeaderRow, { borderBottomColor: surfaceBorder }]}>
                <Text style={[styles.monthHeaderText, { color: colors.textPrimary }]}>{group.title.replace(' de ', ' ')}</Text>
                <Text accessibilityLabel={`${group.count} registros no mês, em todo o recorte`}
                  style={[styles.monthCount, { color: colors.textSecondary }]}>
                  {group.count} {group.count === 1 ? 'registro' : 'registros'}
                </Text>
              </View>
              {group.items.map((entry) => {
                const date = historyDate(entry.occurredAt, timezone);
                const fuelLabel = FUEL_TYPE_LABELS[entry.fuelType] ?? FUEL_TYPE_SHORT_LABELS[entry.fuelType] ?? entry.fuelType;
                const fullDateRow = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.occurredAt));
                return (
                  <HistorySwipeRow key={entry.id}
                    label={`abastecimento de ${formatCurrencyBRL(entry.paidTotal)}, em ${fullDateRow}`}
                    onOpen={() => router.push({ pathname: '/fueling/[entryId]', params: { entryId: entry.id } })}
                    onDelete={() => setDeletingEntry(entry)}>
                    {(openDetails) => (
                    <EntryPressable accessibilityRole="button"
                      accessibilityLabel={`Abastecimento de ${formatCurrencyBRL(entry.paidTotal)}, ${fuelLabel}, em ${fullDateRow}`}
                      accessibilityHint="Toque para ver detalhes. Mantenha pressionado para excluir."
                      accessibilityActions={[{ name: 'delete', label: 'Excluir abastecimento' }]}
                      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'delete') setDeletingEntry(entry); }}
                      onLongPress={() => setDeletingEntry(entry)}
                      onPress={openDetails}
                      style={({ pressed }) => [styles.entryRow, { borderBottomColor: surfaceBorder }, pressed && { backgroundColor: colors.subtle }]}>
                      <View style={[styles.dateCol, { borderRightColor: colors.borderDefault }]}>
                        <Text style={[styles.entryDay, { color: colors.textPrimary }]}>{date.day}</Text>
                        <Text style={[styles.entryMonth, { color: colors.textSecondary }]}>{date.month}</Text>
                      </View>
                      <View style={[styles.entryBody, reflow && styles.stacked]}>
                        <View style={styles.entryLeftCol}>
                          <Text style={[styles.entryTitle, { color: colors.textPrimary }]}>{fuelLabel}</Text>
                          <View style={styles.entryMetrics}>
                            <Text style={[styles.entrySubtitle, { color: colors.textSecondary }]}>{formatLitersBR(entry.liters)} ·</Text>
                            <Text style={[styles.entrySubtitle, { color: colors.textSecondary }]}>{formatUnitPriceBR(entry.unitPrice)}/L</Text>
                          </View>
                        </View>
                        <View style={[styles.entryRightCol, reflow && styles.entryRightReflow]}>
                          <Text style={[styles.entryAmount, { color: colors.textPrimary }]}>{formatCurrencyBRL(entry.paidTotal)}</Text>
                        </View>
                      </View>
                    </EntryPressable>
                    )}
                  </HistorySwipeRow>
                );
              })}
            </View>
          ))}
        </View>
      )}

      {vehicles.length > 0 ? (
        <View style={styles.pagination} testID="history-pagination">
          <Pressable accessibilityRole="button" accessibilityLabel={`${pageSize} por página. Alterar tamanho da página`}
            accessibilityState={{ expanded: sizeSheetOpen }} onPress={() => setSizeSheetOpen(true)}
            style={[styles.sizeSelector, { backgroundColor: surfaceBg, borderColor: surfaceBorder }]}>
            <Text style={[styles.paginationText, { color: colors.textPrimary }]}>{pageSize} por página</Text>
            <ChevronDownIcon size={17} color={colors.brandPrimary} />
          </Pressable>
          <Text accessibilityLiveRegion="polite" style={[styles.paginationText, { color: colors.textSecondary }]}>
            {contextReady && !errorMessage ? `${totalElements === 0 ? 0 : page * pageSize + 1}–${Math.min((page + 1) * pageSize, totalElements)} de ${totalElements}` : '—'}
          </Text>
          <View style={styles.pageNavigation}>
            <Pressable accessibilityRole="button" accessibilityLabel="Página anterior"
              disabled={pending || !contextReady || Boolean(errorMessage) || page === 0}
              accessibilityState={{ disabled: pending || !contextReady || Boolean(errorMessage) || page === 0 }}
              onPress={() => setPage(page - 1)}
              style={[styles.pageButton, { backgroundColor: colors.subtle }, (pending || page === 0) && styles.disabled]}>
              <ChevronLeftIcon size={22} color={colors.textSecondary} />
            </Pressable>
            <Text accessibilityLiveRegion="polite" accessibilityLabel={contextReady && !errorMessage ? `Página ${totalPages ? page + 1 : 0} de ${totalPages}` : 'Página indisponível'}
              style={[styles.paginationText, { color: colors.textPrimary }]}>{contextReady && !errorMessage ? `${totalPages ? page + 1 : 0} / ${totalPages}` : '—'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Próxima página"
              disabled={pending || !contextReady || Boolean(errorMessage) || page + 1 >= totalPages}
              accessibilityState={{ disabled: pending || !contextReady || Boolean(errorMessage) || page + 1 >= totalPages }}
              onPress={() => setPage(page + 1)}
              style={[styles.pageButton, { backgroundColor: colors.brandPrimary }, (pending || page + 1 >= totalPages) && styles.disabled]}>
              <ChevronRightIcon size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      ) : null}

      <AppSheet visible={sizeSheetOpen} title="Registros por página" onClose={() => setSizeSheetOpen(false)}>
        {PAGE_SIZES.map(size => (
          <Pressable key={size} accessibilityRole="radio" accessibilityLabel={`${size} por página`}
            accessibilityState={{ checked: pageSize === size }} aria-checked={pageSize === size}
            onPress={() => { setPageSize(size); setSizeSheetOpen(false); }}
            style={[styles.sheetRow, { backgroundColor: pageSize === size ? colors.accentSoft : colors.bgSecondary, borderColor: surfaceBorder }]}>
            <Text style={[styles.sheetRowText, { color: colors.textPrimary }]}>{size} por página</Text>
            {pageSize === size ? <CheckIcon size={18} color={colors.brandPrimary} /> : null}
          </Pressable>
        ))}
      </AppSheet>

      {/* Sheet: Filtros do Histórico */}
      <HistoryFilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        onApply={(applied) => {
          setExactSlice({});
          setActiveFilters(applied);
          if (applied.from && applied.to) {
            const found = monthOptions.find(
              (opt) => opt.from === applied.from && opt.to === applied.to,
            );
            if (found) {
              setSelectedPeriod(found);
            }
          }
        }}
        initialFilters={activeFilters}
        allowedFuels={activeVehicle?.allowedFuels ?? []}
      />

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
  topHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  historyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 14 },
  historyTitleText: { ...typography.screenTitle, fontSize: 28, lineHeight: 36, fontWeight: '800' },
  controlsBlock: { gap: 14, marginBottom: 22 },
  filterTwoColRow: { flexDirection: 'row', gap: 10 },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  dropdownPill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48,
    paddingHorizontal: 12, paddingVertical: 12, borderRadius: radii.md, borderWidth: 1 },
  dropdownPillText: { ...typography.bodyStrong, fontSize: 14, lineHeight: 20, flex: 1, flexShrink: 1 },
  periodSelector: { flex: 1.25 },
  summaryBar: { flexDirection: 'row', alignItems: 'stretch', gap: 18, paddingTop: 6 },
  summaryCol: { flex: 1, minWidth: 0, gap: 4 },
  summaryDivider: { width: 1 },
  summaryDividerHorizontal: { width: '100%', height: 1 },
  summaryLabel: { ...typography.caption, fontSize: 13, lineHeight: 20 },
  summaryValue: { ...typography.heroValue, fontSize: 23, lineHeight: 32, fontVariant: ['tabular-nums'] },
  noticeSpacing: { marginBottom: 12 },
  loadingBox: { paddingVertical: 32, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { ...typography.caption },
  emptyActions: { gap: 10 },
  sectionsColumn: { gap: 24 },
  monthSection: { gap: 0 },
  monthHeaderRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
    paddingBottom: 10, borderBottomWidth: 1 },
  monthHeaderText: { ...typography.cardTitle, fontSize: 20, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  monthCount: { ...typography.caption, fontSize: 12, lineHeight: 20 },
  entryRow: { flexDirection: 'row', alignItems: 'center', minHeight: 62, paddingVertical: 10 },
  dateCol: { minWidth: 44, alignItems: 'center', paddingRight: 10, marginRight: 13, borderRightWidth: 1 },
  entryDay: { ...typography.cardTitle, fontSize: 22, lineHeight: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
  entryMonth: { ...typography.caption, fontSize: 12, lineHeight: 16 },
  entryBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  entryLeftCol: { flex: 1, minWidth: 0, gap: 4 },
  entryTitle: { ...typography.bodyStrong, fontSize: 14, lineHeight: 20 },
  entryMetrics: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 4 },
  entrySubtitle: { ...typography.caption, fontSize: 12, lineHeight: 18, fontVariant: ['tabular-nums'] },
  entryRightCol: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexShrink: 0 },
  entryRightReflow: { justifyContent: 'space-between' },
  entryAmount: { ...typography.cardTitle, fontSize: 16, lineHeight: 24, fontWeight: '800', fontVariant: ['tabular-nums'], flexShrink: 1 },
  pagination: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 24, paddingBottom: 12 },
  sizeSelector: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 10 },
  paginationText: { ...typography.caption, fontSize: 12, lineHeight: 20, fontVariant: ['tabular-nums'] },
  pageNavigation: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  pageButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md },
  disabled: { opacity: 0.4 },
  sheetRow: { borderRadius: radii.md, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 14, minHeight: 48,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sheetRowText: { ...typography.bodyStrong, fontSize: 14, flexShrink: 1 },
});
