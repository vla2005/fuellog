import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  getConsumptionCycles,
  getFuelEntry,
  TANK_STATE_LABELS,
} from '@/api/endpoints';
import {
  ApiError,
  ConsumptionCycle,
  FuelEntry,
} from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { ChevronLeftIcon, PencilIcon } from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { LocationMap } from '@/components/location/LocationMap';
import { FloatingDock } from '@/components/navigation/FloatingDock';
import { IconButton } from '@/components/ui/IconButton';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, shadows, typography } from '@/theme/tokens';
import { formatDateTimeFullBR } from '@/utils/date';
import {
  formatConsumptionBR,
  formatCurrencyBRL,
  formatLitersBR,
  formatOdometerBR,
  formatUnitPriceBR,
} from '@/utils/decimal';

export function FuelEntryDetailScreen({
  embeddedInShell = false,
  entryIdOverride,
}: {
  embeddedInShell?: boolean;
  entryIdOverride?: string;
} = {}) {
  const router = useRouter();
  const { entryId } = useLocalSearchParams<{ entryId: string }>();
  const resolvedEntryId =
    entryIdOverride !== undefined ? entryIdOverride : entryId;
  const { colors, isDark } = useAppTheme();
  const { activeVehicle } = useSession();

  const [entry, setEntry] = useState<FuelEntry | null>(null);
  const [matchingCycle, setMatchingCycle] = useState<ConsumptionCycle | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastEntryScopeRef = useRef('');
  const currentReqIdRef = useRef(0);
  const isDisposedRef = useRef(false);

  useEffect(() => {
    isDisposedRef.current = false;
    return () => {
      isDisposedRef.current = true;
      currentReqIdRef.current++;
    };
  }, []);

  const loadDetail = useCallback(async () => {
    const reqId = ++currentReqIdRef.current;
    const currentVehicleId = activeVehicle?.id ?? null;
    const currentEntryId = resolvedEntryId ?? null;
    const scopeKey = `${currentVehicleId ?? 'none'}:${currentEntryId ?? 'none'}`;

    if (lastEntryScopeRef.current !== scopeKey) {
      lastEntryScopeRef.current = scopeKey;
      setEntry(null);
      setMatchingCycle(null);
    }

    if (!currentVehicleId || !currentEntryId) {
      if (!isDisposedRef.current && currentReqIdRef.current === reqId) {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const [fetchedEntry, cyclesRes] = await Promise.all([
        getFuelEntry(currentVehicleId, currentEntryId),
        getConsumptionCycles(currentVehicleId).catch(() => null),
      ]);

      if (isDisposedRef.current || currentReqIdRef.current !== reqId) {
        return;
      }

      setEntry(fetchedEntry);
      if (cyclesRes?.items) {
        const found = cyclesRes.items.find(
          (c) =>
            c.endEntryId === fetchedEntry.id ||
            c.startEntryId === fetchedEntry.id,
        );
        setMatchingCycle(found ?? null);
      } else {
        setMatchingCycle(null);
      }
    } catch (err: unknown) {
      if (isDisposedRef.current || currentReqIdRef.current !== reqId) {
        return;
      }
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(
          'Não foi possível carregar os detalhes do abastecimento.',
        );
      }
    } finally {
      if (!isDisposedRef.current && currentReqIdRef.current === reqId) {
        setLoading(false);
      }
    }
  }, [activeVehicle?.id, resolvedEntryId]);

  useEffect(() => {
    void loadDetail();
    return () => {
      currentReqIdRef.current++;
    };
  }, [loadDetail]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [limitationNotice, setLimitationNotice] = useState<string | null>(null);

  const topBarContent = (
    <View style={styles.cleanDetailHeader}>
      <View style={styles.headerLeftRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/history');
            }
          }}
          style={styles.backBtn}
        >
          <ChevronLeftIcon size={22} color={colors.brandPrimary} />
        </Pressable>
        <View style={styles.titleSubtitleCol}>
          <Text style={[styles.detailTitleText, { color: colors.textPrimary }]}>
            Abastecimento
          </Text>
          <Text style={[styles.detailSubtitleText, { color: colors.textSecondary }]}>
            {entry ? `${formatDateTimeFullBR(entry.occurredAt, entry.timezone).split(' às ')[0]} • ${activeVehicle?.nickname ?? 'Veículo'}` : ''}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Opções do abastecimento"
        onPress={() => setMenuOpen(true)}
        style={styles.menuDotsBtn}
      >
        <Text style={[styles.menuDotsText, { color: colors.brandPrimary }]}>•••</Text>
      </Pressable>
    </View>
  );

  return (
    <ScreenShell
      withDockClearance={false}
      omitTopSafeArea={false}
      footer={undefined}
      header={
        !embeddedInShell ? (
          <View
            style={[
              styles.topBar,
              {
                backgroundColor: colors.bgPrimary,
                borderBottomColor: colors.borderDefault,
              },
            ]}
          >
            {topBarContent}
          </View>
        ) : undefined
      }
    >
      {embeddedInShell ? (
        <View style={styles.inlineTopBar}>{topBarContent}</View>
      ) : null}

      {loading && !entry ? (
        <View
          style={[
            styles.loadingCard,
            {
              backgroundColor: colors.bgElevated,
              borderColor: colors.borderDefault,
            },
          ]}
        >
          <ActivityIndicator size="small" color={colors.accentPrimary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Carregando registro...
          </Text>
        </View>
      ) : errorMessage || !entry ? (
        <InlineNotice
          tone="danger"
          title="Registro indisponível"
          message={
            errorMessage ?? 'O abastecimento solicitado não foi encontrado.'
          }
          action={
            <PrimaryButton
              label="Tentar novamente"
              variant="secondary"
              onPress={loadDetail}
            />
          }
        />
      ) : (
        <View style={styles.stack}>
          {/* Hero: Pixel Notebook + Paid Value (Print 3) */}
          <View style={styles.cleanHeroCard}>
            <Image
              source={require('@/assets/brand/pixel_notebook.png')}
              style={{ width: 38, height: 48 }}
              resizeMode="contain"
            />
            <View style={styles.cleanHeroTextCol}>
              <Text style={[styles.cleanHeroLabel, { color: colors.textSecondary }]}>
                Valor pago
              </Text>
              <Text style={[styles.cleanHeroAmount, { color: colors.textPrimary }]}>
                {formatCurrencyBRL(entry.paidTotal)}
              </Text>
            </View>
          </View>

          {/* Clean Detail Rows (Print 3) */}
          <View style={styles.cleanDetailsBlock}>
            <View style={styles.cleanLineItem}>
              <Text style={[styles.cleanLineLabel, { color: colors.textSecondary }]}>Litros</Text>
              <Text style={[styles.cleanLineValue, { color: colors.textPrimary }]}>{formatLitersBR(entry.liters)}</Text>
            </View>
            <View style={[styles.cleanLineDivider, { backgroundColor: colors.borderSubtle }]} />

            <View style={styles.cleanLineItem}>
              <Text style={[styles.cleanLineLabel, { color: colors.textSecondary }]}>Preço por litro</Text>
              <Text style={[styles.cleanLineValue, { color: colors.textPrimary }]}>{formatUnitPriceBR(entry.unitPrice)}</Text>
            </View>
            <View style={[styles.cleanLineDivider, { backgroundColor: colors.borderSubtle }]} />

            <View style={styles.cleanLineItem}>
              <Text style={[styles.cleanLineLabel, { color: colors.textSecondary }]}>Quilometragem</Text>
              <Text style={[styles.cleanLineValue, { color: colors.textPrimary }]}>{formatOdometerBR(entry.odometerKm)}</Text>
            </View>
            <View style={[styles.cleanLineDivider, { backgroundColor: colors.borderSubtle }]} />

            <View style={styles.cleanLineItem}>
              <Text style={[styles.cleanLineLabel, { color: colors.textSecondary }]}>Combustível</Text>
              <Text style={[styles.cleanLineValue, { color: colors.textPrimary }]}>{FUEL_TYPE_LABELS[entry.fuelType] ?? entry.fuelType}</Text>
            </View>
            <View style={[styles.cleanLineDivider, { backgroundColor: colors.borderSubtle }]} />

            {entry.tankState && entry.tankState !== 'UNKNOWN' ? (
              <>
                <View style={styles.cleanLineItem}>
                  <Text style={[styles.cleanLineLabel, { color: colors.textSecondary }]}>Tanque</Text>
                  <Text style={[styles.cleanLineValue, { color: colors.textPrimary }]}>{TANK_STATE_LABELS[entry.tankState]} ✓</Text>
                </View>
                <View style={[styles.cleanLineDivider, { backgroundColor: colors.borderSubtle }]} />
              </>
            ) : null}

            {/* Posto e observacao row */}
            {(entry.stationName || entry.notes) ? (
              <View style={styles.cleanLineItem}>
                <Text style={[styles.cleanLineLabel, { color: colors.textSecondary }]}>Posto e observação</Text>
                <Text style={[styles.cleanLineValue, { color: colors.textPrimary }]}>{entry.stationName || entry.notes}</Text>
              </View>
            ) : null}
          </View>

          {/* Location Section: Square real map for saved coordinates */}
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: colors.bgElevated,
                borderColor: colors.borderDefault,
              },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Localização do abastecimento
            </Text>

            {entry.latitude != null && entry.longitude != null ? (
              <LocationMap
                latitude={entry.latitude}
                longitude={entry.longitude}
              />
            ) : (
              <Text style={[styles.unavailableLocationText, { color: colors.textSecondary }]}>
                Localização indisponível para este registro (salvo antes da integração com GPS).
              </Text>
            )}
          </View>

          {limitationNotice ? (
            <InlineNotice
              tone="warning"
              title="Recurso indisponível na API"
              message={limitationNotice}
            />
          ) : null}

          {/* Stepped CTA: Editar abastecimento */}
          <PrimaryButton
            label="Editar abastecimento"
            leftIcon={<PencilIcon size={18} color="#FFFFFF" />}
            onPress={() => setLimitationNotice('A versão atual da API do FuelLog suporta apenas visualização e criação. Edição e exclusão serão disponibilizadas em versão futura.')}
            stepped
            style={{ marginTop: 12, marginBottom: 24 }}
          />

          {/* Odometer & Tank Context */}
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: colors.bgElevated,
                borderColor: colors.borderDefault,
              },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              {entry.tankState !== 'UNKNOWN' || entry.historyGapBefore || entry.stationName || entry.notes
                ? 'Hodômetro e estado do tanque'
                : 'Hodômetro e detalhes'}
            </Text>

            <DetailItem
              label="Hodômetro registrado"
              value={formatOdometerBR(entry.odometerKm)}
            />
            {entry.tankState && entry.tankState !== 'UNKNOWN' ? (
              <DetailItem
                label="Estado do tanque"
                value={TANK_STATE_LABELS[entry.tankState]}
              />
            ) : null}
            {entry.historyGapBefore ? (
              <DetailItem
                label="Lacuna anterior no histórico"
                value="Sim (ciclo reiniciado)"
              />
            ) : null}
            {entry.stationName ? (
              <DetailItem label="Posto" value={entry.stationName} />
            ) : null}
            {entry.notes ? (
              <DetailItem label="Observações" value={entry.notes} />
            ) : null}
            <DetailItem
              label="Versão da entidade"
              value={`v${entry.version}`}
            />
          </View>

          {/* Cycle Participation */}
          {matchingCycle ? (
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: colors.bgElevated,
                  borderColor: colors.borderDefault,
                },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                Ciclo de consumo vinculado
              </Text>
              <DetailItem
                label="Consumo do ciclo"
                value={
                  formatConsumptionBR(matchingCycle.consumptionKmPerLiter) ??
                  'Indisponível'
                }
              />
              <DetailItem
                label="Distância percorrida no ciclo"
                value={formatOdometerBR(matchingCycle.distanceKm)}
              />
              <DetailItem
                label="Litros consumidos no ciclo"
                value={formatLitersBR(matchingCycle.liters)}
              />
            </View>
          ) : null}

          <InlineNotice
            tone="info"
            title="Registro consolidado para consulta"
            message="Os lançamentos salvos preservam o histórico contábil e de consumo do veículo. A edição e a exclusão estarão disponíveis em breve."
          />
        </View>
      )}
    </ScreenShell>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.detailRow,
        { borderBottomColor: colors.borderDefault },
      ]}
    >
      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cleanDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: 8,
  },
  headerLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    padding: 6,
    marginLeft: -6,
  },
  titleSubtitleCol: {
    gap: 2,
  },
  detailTitleText: {
    ...typography.screenTitle,
    fontSize: 22,
    fontWeight: '800',
  },
  detailSubtitleText: {
    ...typography.body,
    fontSize: 13,
  },
  menuDotsBtn: {
    padding: 8,
  },
  menuDotsText: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2,
  },
  cleanHeroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 14,
  },
  cleanHeroTextCol: {
    gap: 2,
  },
  cleanHeroLabel: {
    ...typography.body,
    fontSize: 14,
  },
  cleanHeroAmount: {
    ...typography.heroValue,
    fontSize: 38,
    fontWeight: '800',
  },
  cleanDetailsBlock: {
    paddingVertical: 8,
  },
  cleanLineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  cleanLineLabel: {
    ...typography.body,
    fontSize: 15,
  },
  cleanLineValue: {
    ...typography.cardTitle,
    fontSize: 16,
    fontWeight: '700',
  },
  cleanLineDivider: {
    height: 1,
  },
  topBar: {
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  inlineTopBar: {
    marginBottom: 8,
  },
  topBarInner: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
  },
  topBarSpacer: {
    width: 44,
  },
  loadingCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  loadingText: {
    ...typography.caption,
  },
  stack: {
    gap: 14,
    paddingTop: 6,
  },
  heroCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: 18,
    gap: 4,
  },
  overline: {
    ...typography.overline,
  },
  heroAmount: {
    ...typography.heroValue,
    fontSize: 32,
  },
  dateText: {
    ...typography.caption,
    marginTop: 2,
  },
  sectionCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    ...typography.cardTitle,
    marginBottom: 2,
  },
  detailRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  detailLabel: {
    ...typography.caption,
    fontSize: 12,
  },
  detailValue: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  unavailableLocationText: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: 4,
  },
});
