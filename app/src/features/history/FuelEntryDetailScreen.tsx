import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { ChevronLeftIcon } from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
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

export function FuelEntryDetailScreen() {
  const router = useRouter();
  const { entryId } = useLocalSearchParams<{ entryId: string }>();
  const { colors, isDark } = useAppTheme();
  const { activeVehicle } = useSession();

  const [entry, setEntry] = useState<FuelEntry | null>(null);
  const [matchingCycle, setMatchingCycle] = useState<ConsumptionCycle | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!activeVehicle || !entryId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const [fetchedEntry, cyclesRes] = await Promise.all([
        getFuelEntry(activeVehicle.id, entryId),
        getConsumptionCycles(activeVehicle.id).catch(() => null),
      ]);

      setEntry(fetchedEntry);
      if (cyclesRes?.items) {
        const found = cyclesRes.items.find(
          (c) => c.endEntryId === fetchedEntry.id || c.startEntryId === fetchedEntry.id,
        );
        setMatchingCycle(found ?? null);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Não foi possível carregar os detalhes do abastecimento.');
      }
    } finally {
      setLoading(false);
    }
  }, [activeVehicle, entryId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  return (
    <ScreenShell
      header={
        <View
          style={[
            styles.topBar,
            {
              backgroundColor: colors.bgPrimary,
              borderBottomColor: colors.borderDefault,
            },
          ]}
        >
          <View style={styles.topBarInner}>
            <IconButton
              icon={<ChevronLeftIcon size={20} color={colors.textPrimary} />}
              accessibilityLabel="Voltar"
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/history');
                }
              }}
            />
            <Text style={[styles.topBarTitle, { color: colors.textPrimary }]}>
              Detalhe do abastecimento
            </Text>
            <View style={styles.topBarSpacer} />
          </View>
        </View>
      }
    >
      {loading ? (
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
          message={errorMessage ?? 'O abastecimento solicitado não foi encontrado.'}
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
          {/* Hero Summary */}
          <View
            style={[
              styles.heroCard,
              {
                backgroundColor: colors.bgHero,
                borderColor: colors.borderStrong,
              },
              isDark ? shadows.darkCard : shadows.lightCard,
            ]}
          >
            <Text style={[styles.overline, { color: colors.textSecondary }]}>
              TOTAL EFETIVAMENTE PAGO
            </Text>
            <Text style={[styles.heroAmount, { color: colors.textPrimary }]}>
              {formatCurrencyBRL(entry.paidTotal)}
            </Text>
            <Text style={[styles.dateText, { color: colors.textSecondary }]}>
              {formatDateTimeFullBR(entry.occurredAt, entry.timezone)} (
              {entry.timezone})
            </Text>
          </View>

          {/* Financial & Volume Breakdown */}
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
              Valores e medição
            </Text>

            <DetailItem
              label="Combustível"
              value={FUEL_TYPE_LABELS[entry.fuelType]}
            />
            <DetailItem
              label="Volume abastecido"
              value={formatLitersBR(entry.liters)}
            />
            <DetailItem
              label="Preço por litro"
              value={`${formatUnitPriceBR(entry.unitPrice)}/L`}
            />
            <DetailItem
              label="Valor de referência (Litros × Preço/L)"
              value={formatCurrencyBRL(entry.referenceTotal)}
            />
            <DetailItem
              label="Ajuste sobre referência"
              value={formatCurrencyBRL(entry.adjustmentAmount)}
            />
            {entry.adjustmentReason ? (
              <DetailItem
                label="Justificativa do ajuste"
                value={entry.adjustmentReason}
              />
            ) : null}
          </View>

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
              Hodômetro e estado do tanque
            </Text>

            <DetailItem
              label="Hodômetro registrado"
              value={formatOdometerBR(entry.odometerKm)}
            />
            <DetailItem
              label="Estado do tanque"
              value={TANK_STATE_LABELS[entry.tankState]}
            />
            <DetailItem
              label="Lacuna anterior no histórico"
              value={entry.historyGapBefore ? 'Sim (ciclo reiniciado)' : 'Não'}
            />
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
  topBar: {
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
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
});
