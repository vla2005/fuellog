import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import {
  FUEL_TYPE_SHORT_LABELS,
  getConsumptionCycles,
  getVehicleSummary,
  listFuelEntries,
} from '@/api/endpoints';
import {
  ApiError,
  CyclesResponse,
  FuelEntry,
  SummaryResponse,
} from '@/api/types';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import {
  CarIcon,
  ChevronDownIcon,
  PlusIcon,
  SettingsIcon,
} from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { useAuthenticatedHeader } from '@/components/navigation/AuthenticatedTabShell';
import { FloatingDock } from '@/components/navigation/FloatingDock';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { MonthlySummaryModal } from '@/features/home/MonthlySummaryModal';
import { VehicleFormSheet } from '@/features/vehicles/VehicleFormSheet';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { layout, radii, shadows, typography } from '@/theme/tokens';
import {
  formatDateTimeRowBR,
  listRecentMonthPeriods,
} from '@/utils/date';
import { formatCurrencyBRL, formatLitersBR, formatUnitPriceBR } from '@/utils/decimal';

export function HomeScreen({
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
    dataVersion,
  } = useSession();

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [cyclesData, setCyclesData] = useState<CyclesResponse | null>(null);
  const [recentEntries, setRecentEntries] = useState<FuelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestSeqRef = useRef(0);
  const latestContextKeyRef = useRef('');
  const lastIdentityScopeRef = useRef('');

  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [createVehicleOpen, setCreateVehicleOpen] = useState(false);
  const [monthlySummaryOpen, setMonthlySummaryOpen] = useState(false);

  const fetchDashboardData = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    const identityScope = `${status}:${user?.id ?? 'anon'}:${
      activeVehicle?.id ?? 'none'
    }`;
    const contextSnap = `${identityScope}:${selectedPeriod.from}_${selectedPeriod.to}:${dataVersion}`;
    latestContextKeyRef.current = contextSnap;

    if (
      lastIdentityScopeRef.current !== identityScope ||
      status !== 'authenticated' ||
      !user ||
      !activeVehicle
    ) {
      lastIdentityScopeRef.current = identityScope;
      setSummary(null);
      setCyclesData(null);
      setRecentEntries([]);
    }
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

  const latestEntry = recentEntries.length > 0 ? recentEntries[0] : null;

  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { headerHeight: measuredHeaderHeight } = useAuthenticatedHeader();
  const headerHeight =
    measuredHeaderHeight > 0 ? measuredHeaderHeight : Math.round(insets.top + 56);
  const isIntegratedMode = vehicles.length > 0;

  const heroImageSource = isDark
    ? require('@/assets/brand/scene_night_road_integrated.png')
    : require('@/assets/brand/scene_day_road_integrated.png');

  const staticRatio = isDark ? 1355 / 1160 : 1355 / 1161;
  const resolvedAsset = Image.resolveAssetSource?.(heroImageSource);
  const assetRatio =
    resolvedAsset && resolvedAsset.width && resolvedAsset.height
      ? resolvedAsset.height / resolvedAsset.width
      : staticRatio;
  const totalImageHeight = Math.round(windowWidth * assetRatio);

  // Useful visual end of scene: wheels at ~0.61*w, road shoulder at ~0.70*w.
  // We cut off empty tail at 0.74*w with a smooth fade starting below wheels.
  const usefulSceneHeight = Math.round(windowWidth * 0.74);
  const heroHeight = Math.max(usefulSceneHeight - headerHeight, 160);

  const fullBleedHero = isIntegratedMode ? (
    <View style={[styles.integratedHeroContainer, { height: heroHeight }]}>
      <Image
        source={heroImageSource}
        style={[
          styles.integratedHeroImage,
          {
            width: windowWidth,
            height: totalImageHeight,
            top: -headerHeight,
          },
        ]}
        resizeMode="cover"
        pointerEvents="none"
        accessibilityLabel={
          isDark
            ? 'Cena noturna integrada com Renault azul e mascote na estrada'
            : 'Cena diurna integrada com Renault azul e mascote na estrada'
        }
      />

      {/* SVG Gradient over tail at bottom (compact 26px fade below wheels) */}
      <Svg
        height={26}
        width="100%"
        style={styles.heroTailGradient}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="roadTailGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.bgPrimary} stopOpacity="0" />
            <Stop offset="0.6" stopColor={colors.bgPrimary} stopOpacity="0.7" />
            <Stop offset="1" stopColor={colors.bgPrimary} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={26} fill="url(#roadTailGrad)" />
      </Svg>
    </View>
  ) : undefined;

  return (
    <ScreenShell
      withDockClearance
      omitTopSafeArea={embeddedInShell}
      fullBleedHero={fullBleedHero}
      footer={embeddedInShell ? undefined : <FloatingDock activeTab="home" />}
    >
      {/* Fallback Standalone Header if not embedded in shell */}
      {!embeddedInShell ? (
        <View style={styles.standaloneHeader}>
          <BrandLockup mode="wordmark-only" wordmarkWidth={146} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ajustes"
            onPress={() => router.push('/settings')}
          >
            <SettingsIcon size={24} color={colors.brandPrimary} />
          </Pressable>
        </View>
      ) : null}

      {/* Vehicle Selector Dropdown: Besourão ⌄ in normal flow on calm area (16-24px from transition) */}
      {vehicles.length > 0 ? (
        <View style={styles.topSelectorRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Veículo selecionado: ${
              activeVehicle?.nickname ?? 'Selecionar veículo'
            }`}
            onPress={() => setVehiclePickerOpen(true)}
            style={styles.vehicleDropdown}
          >
            <Text style={[styles.vehicleDropdownText, { color: colors.textPrimary }]}>
              {activeVehicle?.nickname ?? 'Selecionar veículo'}
            </Text>
            <ChevronDownIcon size={20} color={colors.brandPrimary} />
          </Pressable>
        </View>
      ) : null}

      {vehicles.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            title="Bem-vindo ao FuelLog!"
            description="Cadastre seu primeiro veículo para acompanhar gastos e abastecimentos."
            action={
              <PrimaryButton
                label="Cadastrar veículo"
                leftIcon={<PlusIcon size={18} color="#FFFFFF" />}
                onPress={() => setCreateVehicleOpen(true)}
              />
            }
          />
        </View>
      ) : (
        <View style={styles.mainContent}>
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

          {/* Month & Spent Section in normal flow on calm area */}
          <View style={styles.spentSection}>
            <Text style={[styles.periodText, { color: colors.textSecondary }]}>
              {selectedPeriod.label}
            </Text>
            <Text style={[styles.spentTitle, { color: colors.textPrimary }]}>
              Gasto no mês
            </Text>
            <Text style={[styles.spentAmount, { color: colors.textPrimary }]}>
              {formatCurrencyBRL(summary?.paidTotal ?? '0')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ver resumo do mês"
              onPress={() => setMonthlySummaryOpen(true)}
              style={styles.linkRow}
            >
              <Text style={[styles.linkText, { color: colors.brandPrimary }]}>
                Ver resumo &gt;
              </Text>
            </Pressable>
          </View>

          {/* Section: Último abastecimento */}
          <View style={[styles.latestCard, { borderTopColor: colors.borderSubtle }]}>
            <Text style={[styles.latestHeading, { color: colors.textPrimary }]}>
              Último abastecimento
            </Text>
            {loading && !latestEntry ? (
              <ActivityIndicator size="small" color={colors.brandPrimary} style={{ marginVertical: 10 }} />
            ) : latestEntry ? (
              <View style={styles.latestItemRow}>
                <Text style={[styles.latestMeta, { color: colors.textSecondary }]}>
                  {formatDateTimeRowBR(latestEntry.occurredAt, user?.preferredTimezone || 'America/Sao_Paulo')} • {FUEL_TYPE_SHORT_LABELS[latestEntry.fuelType] ?? latestEntry.fuelType}
                </Text>
                <Text style={[styles.latestPrice, { color: colors.textPrimary }]}>
                  {formatCurrencyBRL(latestEntry.paidTotal)}
                </Text>
              </View>
            ) : (
              <Text style={[styles.latestEmpty, { color: colors.textMuted }]}>
                Nenhum abastecimento no período selecionado.
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ver histórico completo"
              onPress={() => router.replace('/history')}
              style={styles.linkRow}
            >
              <Text style={[styles.linkText, { color: colors.brandPrimary }]}>
                Ver histórico &gt;
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Vehicle Picker Modal */}
      <AppSheet
        visible={vehiclePickerOpen}
        title="Selecionar veículo"
        subtitle="Escolha o veículo ativo para abastecimentos e estatísticas"
        onClose={() => setVehiclePickerOpen(false)}
      >
        <View style={styles.sheetList}>
          {vehicles.map((v) => {
            const isSelected = v.id === activeVehicle?.id;
            return (
              <Pressable
                key={v.id}
                onPress={() => {
                  void selectVehicle(v.id);
                  setVehiclePickerOpen(false);
                }}
                style={[
                  styles.vehicleOption,
                  {
                    backgroundColor: isSelected ? colors.brandSoft : colors.bgElevated,
                    borderColor: isSelected ? colors.borderFocus : colors.borderSubtle,
                  },
                ]}
              >
                <CarIcon size={20} color={isSelected ? colors.brandPrimary : colors.textPrimary} />
                <View style={styles.vehicleOptionTextCol}>
                  <Text style={[styles.vehicleOptionTitle, { color: colors.textPrimary }]}>
                    {v.nickname}
                  </Text>
                  <Text style={[styles.vehicleOptionSub, { color: colors.textSecondary }]}>
                    {v.brand} {v.model} • {v.modelYear || 'Ano não inf.'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          <PrimaryButton
            label="Novo veículo"
            leftIcon={<PlusIcon size={18} color="#FFFFFF" />}
            variant="secondary"
            onPress={() => {
              setVehiclePickerOpen(false);
              setCreateVehicleOpen(true);
            }}
            style={{ marginTop: 8 }}
          />
        </View>
      </AppSheet>

      {/* Vehicle Creation Form Modal */}
      <VehicleFormSheet
        visible={createVehicleOpen}
        onClose={() => setCreateVehicleOpen(false)}
        onCreated={async (saved) => {
          await selectVehicle(saved.id);
          setCreateVehicleOpen(false);
        }}
      />
          {/* Functional Monthly Summary Modal (Print 4) */}
      <MonthlySummaryModal
        visible={monthlySummaryOpen}
        onClose={() => setMonthlySummaryOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  summarySheetContent: {
    paddingVertical: 12,
    gap: 12,
  },
  summaryHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryHeroTextCol: {
    gap: 2,
  },
  summaryMonthLabel: {
    ...typography.body,
    fontSize: 14,
  },
  summaryHeroTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    fontWeight: '700',
  },
  summaryHeroAmount: {
    ...typography.heroValue,
    fontSize: 34,
    fontWeight: '800',
  },
  summaryHeroSub: {
    ...typography.body,
    fontSize: 14,
  },
  sheetDivider: {
    height: 1,
    marginVertical: 4,
  },
  metricRow: {
    gap: 4,
  },
  metricRowLabel: {
    ...typography.body,
    fontSize: 14,
  },
  metricRowValue: {
    ...typography.sectionTitle,
    fontSize: 24,
    fontWeight: '700',
  },
  summaryActionRow: {
    paddingVertical: 8,
  },
  summaryActionText: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
  standaloneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  topSelectorRow: {
    paddingTop: 16,
    paddingBottom: 4,
    marginBottom: 4,
  },
  vehicleDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  vehicleDropdownText: {
    ...typography.sectionTitle,
    fontSize: 20,
    fontWeight: '700',
  },
  emptyWrap: {
    paddingVertical: 32,
  },
  mainContent: {
    gap: 16,
  },
  sceneContainer: {
    width: '100%',
    height: 190,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: '#080E18',
  },
  sceneImage: {
    width: '100%',
    height: '100%',
  },
  spentSection: {
    paddingVertical: 8,
    gap: 4,
  },
  periodText: {
    ...typography.body,
    fontSize: 14,
  },
  spentTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
    fontWeight: '700',
  },
  spentAmount: {
    ...typography.heroValue,
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  linkRow: {
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  linkText: {
    ...typography.bodyStrong,
    fontSize: 15,
  },
  latestCard: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#162338',
    gap: 6,
  },
  latestHeading: {
    ...typography.sectionTitle,
    fontSize: 18,
    fontWeight: '700',
  },
  latestItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  latestMeta: {
    ...typography.body,
    fontSize: 15,
  },
  latestPrice: {
    ...typography.sectionTitle,
    fontSize: 18,
    fontWeight: '700',
  },
  latestEmpty: {
    ...typography.body,
    fontSize: 14,
    paddingVertical: 4,
  },
  integratedHeroContainer: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  integratedHeroImage: {
    position: 'absolute',
    left: 0,
  },
  heroTailGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  integratedHeroContent: {
    width: '100%',
    paddingTop: 8,
    paddingBottom: 12,
  },
  heroInnerContainer: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    paddingHorizontal: layout.horizontalPadding,
  },
  sheetList: {
    gap: 10,
    paddingVertical: 8,
  },
  vehicleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1.5,
  },
  vehicleOptionTextCol: {
    flex: 1,
    gap: 2,
  },
  vehicleOptionTitle: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
  vehicleOptionSub: {
    ...typography.caption,
    fontSize: 13,
  },
});
