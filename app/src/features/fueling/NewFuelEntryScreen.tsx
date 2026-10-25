import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createFuelEntry,
  FUEL_TYPE_LABELS,
} from '@/api/endpoints';
import {
  ApiError,
  CreateFuelEntryRequest,
  FuelType,
  TankState,
} from '@/api/types';
import { DiagonalPixelSpark, PixelMascot } from '@/components/brand/PixelMascot';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DropletIcon,
  GaugeIcon,
  PencilIcon,
  PlusIcon,
} from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TankSegmented } from '@/components/ui/TankSegmented';
import { VehicleFormSheet } from '@/features/vehicles/VehicleFormSheet';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, shadows, typography } from '@/theme/tokens';
import {
  detectDeviceTimezone,
  formatLocalDateInput,
  formatLocalTimeInput,
  parseLocalDateTimeToIso,
} from '@/utils/date';
import {
  calculateAdjustment,
  calculateReferenceTotal,
  formatCurrencyBRL,
  parsePositiveDecimalInput,
} from '@/utils/decimal';
import { generateUuidV4 } from '@/utils/uuid';

interface FuelEntryDraft {
  id: string;
  liters: string;
  unitPrice: string;
  manualPaidTotal: string;
  isManualPaidTotal: boolean;
  adjustmentReason: string;
  odometerKm: string;
  dateStr: string;
  timeStr: string;
  timezone: string;
  fuelType: FuelType | null;
  tankState: TankState | null;
  historyGapBefore: boolean;
  stationName: string;
  notes: string;
  showMoreDetails: boolean;
  uncertainPendingPayload?: CreateFuelEntryRequest | null;
}

function getDraftStorageKey(userId: string, vehicleId: string): string {
  return `fuellog.draft.fuel_entry.v1.${userId}.${vehicleId}`;
}

function formatDateBrFromIsoDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function NewFuelEntryScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const {
    user,
    vehicles,
    activeVehicle,
    selectVehicle,
    invalidateFuelData,
    showToast,
  } = useSession();

  const now = useMemo(() => new Date(), []);
  const defaultTimezone = useMemo(
    () => user?.preferredTimezone || detectDeviceTimezone(),
    [user?.preferredTimezone],
  );

  const [entryId, setEntryId] = useState<string>(() => generateUuidV4());
  const [liters, setLiters] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [manualPaidTotal, setManualPaidTotal] = useState('');
  const [isManualPaidTotal, setIsManualPaidTotal] = useState(false);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [odometerKm, setOdometerKm] = useState('');
  const [dateStr, setDateStr] = useState(() => formatLocalDateInput(now));
  const [timeStr, setTimeStr] = useState(() => formatLocalTimeInput(now));
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [fuelType, setFuelType] = useState<FuelType | null>(
    () => activeVehicle?.allowedFuels[0] ?? null,
  );
  const [tankState, setTankState] = useState<TankState | null>(null);
  const [historyGapBefore, setHistoryGapBefore] = useState(false);
  const [stationName, setStationName] = useState('');
  const [notes, setNotes] = useState('');
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  const [vehicleSheetOpen, setVehicleSheetOpen] = useState(false);
  const [fuelSheetOpen, setFuelSheetOpen] = useState(false);
  const [dateTimeSheetOpen, setDateTimeSheetOpen] = useState(false);
  const [createVehicleOpen, setCreateVehicleOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [uncertainPendingPayload, setUncertainPendingPayload] =
    useState<CreateFuelEntryRequest | null>(null);

  const [restoredScopeKey, setRestoredScopeKey] = useState<string | null>(null);
  const restoredScopeKeyRef = useRef<string | null>(null);
  const restoreSeqRef = useRef(0);

  // Carrega rascunho local vinculado exatamente a userId + vehicleId
  useEffect(() => {
    let active = true;
    const seq = ++restoreSeqRef.current;
    restoredScopeKeyRef.current = null;
    setRestoredScopeKey(null);
    setUncertainPendingPayload(null);
    setErrorMessage(null);
    setFieldErrors({});

    const freshNow = new Date();
    const freshDefaultFuel = activeVehicle?.allowedFuels[0] ?? null;

    // Reseta imediatamente os campos ao trocar de veículo para nunca herdar dados do veículo anterior
    setEntryId(generateUuidV4());
    setLiters('');
    setUnitPrice('');
    setManualPaidTotal('');
    setIsManualPaidTotal(false);
    setAdjustmentReason('');
    setOdometerKm('');
    setDateStr(formatLocalDateInput(freshNow));
    setTimeStr(formatLocalTimeInput(freshNow));
    setTimezone(defaultTimezone);
    setFuelType(freshDefaultFuel);
    setTankState(null);
    setHistoryGapBefore(false);
    setStationName('');
    setNotes('');
    setShowMoreDetails(false);

    if (!user || !activeVehicle) {
      return () => {
        active = false;
      };
    }

    const key = getDraftStorageKey(user.id, activeVehicle.id);
    const allowedFuels = activeVehicle.allowedFuels;

    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!active || seq !== restoreSeqRef.current) return;
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<FuelEntryDraft>;
            if (parsed.id) setEntryId(parsed.id);
            if (typeof parsed.liters === 'string') setLiters(parsed.liters);
            if (typeof parsed.unitPrice === 'string') setUnitPrice(parsed.unitPrice);
            if (typeof parsed.manualPaidTotal === 'string') {
              setManualPaidTotal(parsed.manualPaidTotal);
            }
            if (typeof parsed.isManualPaidTotal === 'boolean') {
              setIsManualPaidTotal(parsed.isManualPaidTotal);
            }
            if (typeof parsed.adjustmentReason === 'string') {
              setAdjustmentReason(parsed.adjustmentReason);
            }
            if (typeof parsed.odometerKm === 'string') setOdometerKm(parsed.odometerKm);
            if (typeof parsed.dateStr === 'string') setDateStr(parsed.dateStr);
            if (typeof parsed.timeStr === 'string') setTimeStr(parsed.timeStr);
            if (typeof parsed.timezone === 'string' && parsed.timezone) {
              setTimezone(parsed.timezone);
            }
            if (
              parsed.fuelType &&
              allowedFuels.includes(parsed.fuelType)
            ) {
              setFuelType(parsed.fuelType);
            }
            if (parsed.tankState) {
              setTankState(parsed.tankState);
            }
            if (typeof parsed.historyGapBefore === 'boolean') {
              setHistoryGapBefore(parsed.historyGapBefore);
            }
            if (typeof parsed.stationName === 'string') setStationName(parsed.stationName);
            if (typeof parsed.notes === 'string') setNotes(parsed.notes);
            if (typeof parsed.showMoreDetails === 'boolean') {
              setShowMoreDetails(parsed.showMoreDetails);
            }
            if (parsed.uncertainPendingPayload) {
              setUncertainPendingPayload(parsed.uncertainPendingPayload);
            }
          } catch {
            // Ignora rascunho corrompido mantendo estado limpo recém-inicializado
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active && seq === restoreSeqRef.current) {
          restoredScopeKeyRef.current = key;
          setRestoredScopeKey(key);
        }
      });

    return () => {
      active = false;
    };
  }, [activeVehicle, defaultTimezone, user]);

  // Salva rascunho somente quando o escopo restaurado coincide exatamente com userId + vehicleId atuais
  useEffect(() => {
    if (!user || !activeVehicle) return;
    const key = getDraftStorageKey(user.id, activeVehicle.id);
    if (restoredScopeKey !== key || restoredScopeKeyRef.current !== key) {
      return;
    }

    const draft: FuelEntryDraft = {
      id: entryId,
      liters,
      unitPrice,
      manualPaidTotal,
      isManualPaidTotal,
      adjustmentReason,
      odometerKm,
      dateStr,
      timeStr,
      timezone,
      fuelType,
      tankState,
      historyGapBefore,
      stationName,
      notes,
      showMoreDetails,
      uncertainPendingPayload,
    };
    void AsyncStorage.setItem(key, JSON.stringify(draft)).catch(() => {});
  }, [
    activeVehicle,
    adjustmentReason,
    dateStr,
    entryId,
    fuelType,
    historyGapBefore,
    isManualPaidTotal,
    liters,
    manualPaidTotal,
    notes,
    odometerKm,
    restoredScopeKey,
    showMoreDetails,
    stationName,
    tankState,
    timeStr,
    timezone,
    uncertainPendingPayload,
    unitPrice,
    user,
  ]);

  const referenceTotalDot = useMemo(
    () => calculateReferenceTotal(liters, unitPrice),
    [liters, unitPrice],
  );

  const effectivePaidTotalInput = isManualPaidTotal
    ? manualPaidTotal
    : referenceTotalDot ?? '';

  const adjustmentInfo = useMemo(
    () => calculateAdjustment(effectivePaidTotalInput, referenceTotalDot),
    [effectivePaidTotalInput, referenceTotalDot],
  );

  const parsedOccurredAtIso = useMemo(
    () => parseLocalDateTimeToIso(dateStr, timeStr),
    [dateStr, timeStr],
  );

  const isLockedForUncertainRetry = uncertainPendingPayload !== null;

  const handleToggleManualPaid = () => {
    if (isLockedForUncertainRetry) return;
    if (!isManualPaidTotal) {
      setManualPaidTotal(
        referenceTotalDot ? referenceTotalDot.replace('.', ',') : '',
      );
      setIsManualPaidTotal(true);
    } else {
      setIsManualPaidTotal(false);
      setManualPaidTotal('');
    }
  };

  const handleResetUncertainLock = () => {
    setUncertainPendingPayload(null);
    setEntryId(generateUuidV4());
    setErrorMessage(null);
  };

  const handleSubmit = async () => {
    if (!activeVehicle || !user) {
      setErrorMessage('Cadastre ou selecione um veículo antes de salvar.');
      return;
    }

    const expectedScopeKey = getDraftStorageKey(user.id, activeVehicle.id);
    if (
      restoredScopeKey !== expectedScopeKey ||
      restoredScopeKeyRef.current !== expectedScopeKey
    ) {
      setErrorMessage('Aguarde a preparação dos dados do veículo selecionado.');
      return;
    }

    setErrorMessage(null);
    setFieldErrors({});

    let payloadToSend: CreateFuelEntryRequest;

    if (uncertainPendingPayload) {
      payloadToSend = uncertainPendingPayload;
    } else {
      const localErrors: Record<string, string> = {};

      const parsedLiters = parsePositiveDecimalInput(liters, 3);
      if (!parsedLiters.valid || !parsedLiters.normalizedDot) {
        localErrors.liters =
          parsedLiters.errorReason === 'EXCESSIVE_SCALE'
            ? 'Litros aceita no máximo 3 casas decimais.'
            : 'Informe uma quantidade positiva de litros.';
      }

      const parsedUnitPrice = parsePositiveDecimalInput(unitPrice, 4);
      if (!parsedUnitPrice.valid || !parsedUnitPrice.normalizedDot) {
        localErrors.unitPrice =
          parsedUnitPrice.errorReason === 'EXCESSIVE_SCALE'
            ? 'Preço/L aceita no máximo 4 casas decimais.'
            : 'Informe um preço por litro positivo.';
      }

      const parsedPaid = parsePositiveDecimalInput(effectivePaidTotalInput, 2);
      if (!parsedPaid.valid || !parsedPaid.normalizedDot) {
        localErrors.paidTotal =
          parsedPaid.errorReason === 'EXCESSIVE_SCALE'
            ? 'Total pago aceita no máximo 2 casas decimais.'
            : 'Informe um valor total pago positivo.';
      }

      const cleanOdometer = odometerKm.trim();
      if (!/^\d+$/.test(cleanOdometer)) {
        localErrors.odometerKm = 'Informe o hodômetro como número inteiro (km >= 0).';
      }

      if (!parsedOccurredAtIso) {
        localErrors.occurredAt = 'Data ou hora inválida. Use AAAA-MM-DD e HH:MM.';
      }

      if (!fuelType || !activeVehicle.allowedFuels.includes(fuelType)) {
        localErrors.fuelType = 'Selecione um combustível permitido para este veículo.';
      }

      if (!tankState) {
        localErrors.tankState = 'Selecione o estado do tanque neste abastecimento.';
      }

      const cleanReason = adjustmentReason.trim();
      if (adjustmentInfo.requiresReason && !cleanReason) {
        localErrors.adjustmentReason =
          'Justifique a diferença superior a R$ 0,05 entre o total pago e o valor calculado.';
      } else if (cleanReason.length > 300) {
        localErrors.adjustmentReason =
          'A justificativa deve ter no máximo 300 caracteres.';
      }

      if (Object.keys(localErrors).length > 0) {
        setFieldErrors(localErrors);
        return;
      }

      payloadToSend = {
        id: entryId,
        occurredAt: parsedOccurredAtIso!,
        timezone: timezone.trim() || defaultTimezone,
        odometerKm: Number(cleanOdometer),
        fuelType: fuelType!,
        liters: parsedLiters.normalizedDot!,
        unitPrice: parsedUnitPrice.normalizedDot!,
        paidTotal: parsedPaid.normalizedDot!,
        tankState: tankState!,
        historyGapBefore,
        adjustmentReason: cleanReason || null,
        stationName: stationName.trim() || null,
        notes: notes.trim() || null,
      };
    }

    const targetVehicleId = activeVehicle.id;
    const targetVehicleNickname = activeVehicle.nickname;

    setSubmitting(true);
    try {
      const savedEntry = await createFuelEntry(targetVehicleId, payloadToSend);

      await AsyncStorage.removeItem(expectedScopeKey).catch(() => {});

      invalidateFuelData();
      showToast({
        tone: 'success',
        title: savedEntry.idempotentReplay
          ? 'Abastecimento confirmado'
          : 'Abastecimento salvo com sucesso',
        subtitle: `${formatCurrencyBRL(savedEntry.paidTotal)} registrado em ${targetVehicleNickname}.`,
      });
      router.replace('/');
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
        if (err.problem?.fieldErrors) {
          setFieldErrors(err.problem.fieldErrors);
        }
        if (err.isUncertainWrite || err.status === 409) {
          setUncertainPendingPayload(payloadToSend);
        }
      } else {
        setErrorMessage(
          'Falha inesperada ao comunicar com o servidor. Seus dados foram preservados.',
        );
        setUncertainPendingPayload(payloadToSend);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const surfaceBg = colors.surface;
  const surfaceBorder = colors.borderSubtle;
  const badgeSquareBg = colors.subtle;

  const vehicleHeaderSubtitle = activeVehicle
    ? [
        activeVehicle.nickname,
        activeVehicle.modelYear ? `• ${activeVehicle.modelYear}` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : 'Selecionar veículo';

  return (
    <ScreenShell contentContainerStyle={styles.scrollContent}>
      {/* Header Row: Back Button + Title/Vehicle Subtitle + Mascot Avatar */}
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar novo abastecimento"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/');
            }
          }}
          style={[
            styles.backButton,
            {
              backgroundColor: surfaceBg,
              borderColor: surfaceBorder,
            },
          ]}
        >
          <ChevronLeftIcon size={20} color={colors.textPrimary} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Veículo: ${vehicleHeaderSubtitle}`}
          disabled={isLockedForUncertainRetry}
          onPress={() => setVehicleSheetOpen(true)}
          style={styles.headerTitleCol}
        >
          <Text
            numberOfLines={1}
            style={[styles.headerTitle, { color: colors.textPrimary }]}
          >
            Novo abastecimento
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.headerSubtitle, { color: colors.textSecondary }]}
          >
            {vehicleHeaderSubtitle}
          </Text>
        </Pressable>

        <PixelMascot variant="avatar" size={30} withFrame />
      </View>

      {vehicles.length === 0 ? (
        <View style={styles.noVehicleWrap}>
          <InlineNotice
            tone="warning"
            title="Cadastre um veículo primeiro"
            message="Para registrar um abastecimento, é necessário ter pelo menos um veículo cadastrado na sua conta."
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
        <View style={styles.formStack}>
          <View style={styles.formTopGroup}>
            {errorMessage ? (
              <InlineNotice tone="danger" message={errorMessage} />
            ) : null}

            {isLockedForUncertainRetry ? (
              <InlineNotice
                tone="warning"
                title="Reenvio seguro com proteção contra duplicidade"
                message="A tentativa anterior teve resposta incerta ou conflito. Reenvie com o mesmo código para não duplicar o lançamento, ou descarte explicitamente se quiser alterar os dados como um novo registro."
                action={
                  <PrimaryButton
                    label="Descartar envio pendente e editar como novo"
                    variant="secondary"
                    onPress={handleResetUncertainLock}
                  />
                }
              />
            ) : null}

          {/* Hero Card: Valor pago */}
          <View
            style={[
              styles.paidHeroCard,
              {
                backgroundColor: surfaceBg,
                borderColor: fieldErrors.paidTotal
                  ? colors.dangerBorder
                  : surfaceBorder,
              },
              isDark ? shadows.darkCard : shadows.lightCard,
            ]}
          >
            <View style={styles.paidHeroRow}>
              <View style={styles.paidHeroLeft}>
                <Text style={[styles.paidLabel, { color: colors.textSecondary }]}>
                  Valor pago
                </Text>

                {isManualPaidTotal ? (
                  <View style={styles.manualPaidInputRow}>
                    <Text
                      style={[
                        styles.currencyPrefix,
                        { color: colors.textPrimary },
                      ]}
                    >
                      R$
                    </Text>
                    <TextInput
                      accessibilityLabel="Valor total pago"
                      value={manualPaidTotal}
                      onChangeText={setManualPaidTotal}
                      editable={!isLockedForUncertainRetry}
                      keyboardType="decimal-pad"
                      placeholder="0,00"
                      placeholderTextColor={colors.textMuted}
                      style={[
                        styles.manualPaidInput,
                        { color: colors.textPrimary },
                      ]}
                    />
                  </View>
                ) : (
                  <Text
                    style={[
                      styles.paidHeroDisplay,
                      { color: colors.textPrimary },
                    ]}
                    accessibilityLabel={`Valor total pago calculado: ${formatCurrencyBRL(
                      referenceTotalDot ?? '0.00',
                    )}`}
                  >
                    {formatCurrencyBRL(referenceTotalDot ?? '0.00')}
                  </Text>
                )}

                <Text
                  style={[styles.referenceText, { color: colors.textSecondary }]}
                >
                  {adjustmentInfo.adjustmentDot &&
                  adjustmentInfo.diffCents !== 0n
                    ? `Ref. ${formatCurrencyBRL(
                        referenceTotalDot ?? '0.00',
                      )} • Ajuste ${formatCurrencyBRL(
                        adjustmentInfo.adjustmentDot,
                      )}`
                    : 'Calculado por litros × preço'}
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isManualPaidTotal
                    ? 'Usar valor calculado automaticamente'
                    : 'Editar valor total pago manualmente'
                }
                disabled={isLockedForUncertainRetry}
                onPress={handleToggleManualPaid}
                style={[
                  styles.editPaidButton,
                  {
                    backgroundColor: colors.brandSoft,
                  },
                ]}
              >
                <PencilIcon
                  size={18}
                  color={isDark ? colors.borderFocus : colors.brandPrimary}
                />
              </Pressable>
            </View>

            {fieldErrors.paidTotal ? (
              <Text style={[styles.errorText, { color: colors.dangerText }]}>
                {fieldErrors.paidTotal}
              </Text>
            ) : null}
          </View>

          {/* 2-Column Inputs: Litros & Preço por litro */}
          <View style={styles.twoColRow}>
            <View style={styles.col}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Litros
              </Text>
              <View
                style={[
                  styles.decimalBox,
                  {
                    backgroundColor: surfaceBg,
                    borderColor: fieldErrors.liters
                      ? colors.dangerBorder
                      : surfaceBorder,
                  },
                ]}
              >
                <TextInput
                  accessibilityLabel="Litros abastecidos"
                  value={liters}
                  onChangeText={setLiters}
                  editable={!isLockedForUncertainRetry}
                  keyboardType="decimal-pad"
                  placeholder="35,000"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.decimalInput, { color: colors.textPrimary }]}
                />
                <View
                  style={[
                    styles.affixDivider,
                    { backgroundColor: surfaceBorder },
                  ]}
                />
                <Text
                  style={[styles.affixText, { color: colors.textSecondary }]}
                >
                  L
                </Text>
              </View>
              {fieldErrors.liters ? (
                <Text style={[styles.errorText, { color: colors.dangerText }]}>
                  {fieldErrors.liters}
                </Text>
              ) : null}
            </View>

            <View style={styles.col}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Preço por litro
              </Text>
              <View
                style={[
                  styles.decimalBox,
                  {
                    backgroundColor: surfaceBg,
                    borderColor: fieldErrors.unitPrice
                      ? colors.dangerBorder
                      : surfaceBorder,
                  },
                ]}
              >
                <Text
                  style={[styles.affixText, { color: colors.textSecondary }]}
                >
                  R$
                </Text>
                <TextInput
                  accessibilityLabel="Preço por litro"
                  value={unitPrice}
                  onChangeText={setUnitPrice}
                  editable={!isLockedForUncertainRetry}
                  keyboardType="decimal-pad"
                  placeholder="6,0900"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.decimalInput, { color: colors.textPrimary }]}
                />
              </View>
              {fieldErrors.unitPrice ? (
                <Text style={[styles.errorText, { color: colors.dangerText }]}>
                  {fieldErrors.unitPrice}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Conditional Adjustment Reason when abs(paidTotal - referenceTotal) > 0.05 */}
          {adjustmentInfo.requiresReason || isManualPaidTotal ? (
            <View
              style={[
                styles.adjustmentCard,
                {
                  backgroundColor: adjustmentInfo.requiresReason
                    ? colors.warningSoft
                    : surfaceBg,
                  borderColor: fieldErrors.adjustmentReason
                    ? colors.dangerBorder
                    : adjustmentInfo.requiresReason
                      ? colors.warningBorder
                      : surfaceBorder,
                },
              ]}
            >
              <Text
                style={[
                  styles.adjustmentLabel,
                  {
                    color: adjustmentInfo.requiresReason
                      ? colors.warningText
                      : colors.textSecondary,
                  },
                ]}
              >
                {adjustmentInfo.requiresReason
                  ? 'Justificativa do ajuste (obrigatória para diferença > R$ 0,05) *'
                  : 'Motivo do ajuste no valor pago (opcional até R$ 0,05)'}
              </Text>
              <TextInput
                accessibilityLabel="Justificativa do ajuste"
                value={adjustmentReason}
                onChangeText={setAdjustmentReason}
                editable={!isLockedForUncertainRetry}
                placeholder="Ex: Desconto no app do posto ou arredondamento na bomba"
                placeholderTextColor={colors.textMuted}
                maxLength={300}
                style={[
                  styles.adjustmentInput,
                  {
                    backgroundColor: surfaceBg,
                    borderColor: surfaceBorder,
                    color: colors.textPrimary,
                  },
                ]}
              />
              {fieldErrors.adjustmentReason ? (
                <Text style={[styles.errorText, { color: colors.dangerText }]}>
                  {fieldErrors.adjustmentReason}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Grouped 3-Row Card: Quilometragem, Data, Combustível */}
          <View
            style={[
              styles.groupedCard,
              {
                backgroundColor: surfaceBg,
                borderColor:
                  fieldErrors.odometerKm ||
                  fieldErrors.occurredAt ||
                  fieldErrors.fuelType
                    ? colors.dangerBorder
                    : surfaceBorder,
              },
              isDark ? shadows.darkCard : shadows.lightCard,
            ]}
          >
            {/* Row 1: Quilometragem (inline editable odometer) */}
            <View
              style={[
                styles.groupedRow,
                styles.groupedRowBorder,
                { borderBottomColor: surfaceBorder },
              ]}
            >
              <View
                style={[
                  styles.rowIconBadge,
                  { backgroundColor: badgeSquareBg },
                ]}
              >
                <GaugeIcon size={16} color={colors.textPrimary} />
              </View>
              <Text
                style={[styles.groupedRowLabel, { color: colors.textSecondary }]}
              >
                Quilometragem
              </Text>
              <View style={styles.odometerInlineRight}>
                <TextInput
                  accessibilityLabel="Hodômetro atual (km inteiro)"
                  value={odometerKm}
                  onChangeText={(val) => setOdometerKm(val.replace(/[^\d]/g, ''))}
                  editable={!isLockedForUncertainRetry}
                  keyboardType="number-pad"
                  placeholder="58420"
                  placeholderTextColor={colors.textMuted}
                  style={[
                    styles.odometerInlineInput,
                    { color: colors.textPrimary },
                  ]}
                />
                <Text
                  style={[
                    styles.odometerUnitText,
                    { color: colors.textPrimary },
                  ]}
                >
                  km
                </Text>
                <ChevronRightIcon size={15} color={colors.accentPrimary} />
              </View>
            </View>

            {/* Row 2: Data */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Data e hora do abastecimento: ${formatDateBrFromIsoDate(
                dateStr,
              )}`}
              disabled={isLockedForUncertainRetry}
              onPress={() => setDateTimeSheetOpen(true)}
              style={[
                styles.groupedRow,
                styles.groupedRowBorder,
                { borderBottomColor: surfaceBorder },
              ]}
            >
              <View
                style={[
                  styles.rowIconBadge,
                  { backgroundColor: badgeSquareBg },
                ]}
              >
                <CalendarIcon size={16} color={colors.textPrimary} />
              </View>
              <Text
                style={[styles.groupedRowLabel, { color: colors.textSecondary }]}
              >
                Data
              </Text>
              <View style={styles.groupedRowRight}>
                <Text
                  style={[styles.groupedRowValue, { color: colors.textPrimary }]}
                >
                  {formatDateBrFromIsoDate(dateStr)}
                </Text>
                <ChevronRightIcon size={15} color={colors.accentPrimary} />
              </View>
            </Pressable>

            {/* Row 3: Combustível */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Combustível: ${
                fuelType ? FUEL_TYPE_LABELS[fuelType] : 'Selecionar'
              }`}
              disabled={isLockedForUncertainRetry}
              onPress={() => setFuelSheetOpen(true)}
              style={styles.groupedRow}
            >
              <View
                style={[
                  styles.rowIconBadge,
                  { backgroundColor: badgeSquareBg },
                ]}
              >
                <DropletIcon size={16} color={colors.textPrimary} />
              </View>
              <Text
                style={[styles.groupedRowLabel, { color: colors.textSecondary }]}
              >
                Combustível
              </Text>
              <View style={styles.groupedRowRight}>
                <Text
                  numberOfLines={1}
                  style={[styles.groupedRowValue, { color: colors.textPrimary }]}
                >
                  {fuelType ? FUEL_TYPE_LABELS[fuelType] : 'Selecionar'}
                </Text>
                <ChevronRightIcon size={15} color={colors.accentPrimary} />
              </View>
            </Pressable>
          </View>

          {fieldErrors.odometerKm ||
          fieldErrors.occurredAt ||
          fieldErrors.fuelType ? (
            <Text style={[styles.errorText, { color: colors.dangerText }]}>
              {fieldErrors.odometerKm ||
                fieldErrors.occurredAt ||
                fieldErrors.fuelType}
            </Text>
          ) : null}

          {/* Tank State Section */}
          <View style={styles.tankSection}>
            <Text style={[styles.tankHeading, { color: colors.textPrimary }]}>
              Como ficou o tanque?
            </Text>
            <TankSegmented
              value={tankState}
              onChange={(next) => {
                if (!isLockedForUncertainRetry) {
                  setTankState(next);
                }
              }}
              errorText={fieldErrors.tankState}
            />
          </View>

          {/* Compact History Gap Checkbox Row */}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: historyGapBefore }}
            aria-checked={historyGapBefore}
            accessibilityLabel="Houve abastecimento não registrado antes deste"
            disabled={isLockedForUncertainRetry}
            onPress={() => setHistoryGapBefore((prev) => !prev)}
            style={styles.gapRow}
          >
            <View
              style={[
                styles.gapCheckbox,
                {
                  backgroundColor: historyGapBefore
                    ? colors.accentPrimary
                    : surfaceBg,
                  borderColor: historyGapBefore
                    ? colors.accentPrimary
                    : colors.textPrimary,
                },
              ]}
            >
              {historyGapBefore ? <CheckIcon size={12} color="#FFFFFF" /> : null}
            </View>
            <Text style={[styles.gapLabel, { color: colors.textPrimary }]}>
              Houve abastecimento não registrado
            </Text>
          </Pressable>
          </View>

          <View style={styles.formBottomGroup}>
            {/* Expandable Optional Details Row: Posto e observação */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                showMoreDetails
                  ? 'Ocultar posto e observação'
                  : 'Posto e observação'
              }
              onPress={() => setShowMoreDetails((prev) => !prev)}
              style={[
                styles.moreDetailsCardRow,
                {
                  backgroundColor: surfaceBg,
                  borderColor: surfaceBorder,
                },
              ]}
            >
              <View
                style={[
                  styles.morePlusBadge,
                  { backgroundColor: badgeSquareBg },
                ]}
              >
                <PlusIcon size={14} color={colors.accentPrimary} />
              </View>
              <Text
                style={[styles.moreDetailsText, { color: colors.textPrimary }]}
              >
                Posto e observação
              </Text>
              <ChevronRightIcon size={15} color={colors.accentPrimary} />
            </Pressable>

            {showMoreDetails ? (
              <View
                style={[
                  styles.optionalCard,
                  {
                    backgroundColor: surfaceBg,
                    borderColor: surfaceBorder,
                  },
                ]}
              >
                <View style={styles.fieldGroup}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                    Nome do posto (opcional)
                  </Text>
                  <TextInput
                    accessibilityLabel="Nome do posto"
                    value={stationName}
                    onChangeText={setStationName}
                    editable={!isLockedForUncertainRetry}
                    placeholder="Ex: Posto Shell Avenida"
                    placeholderTextColor={colors.textMuted}
                    maxLength={120}
                    style={[
                      styles.optionalInput,
                      {
                        backgroundColor: colors.bgSecondary,
                        borderColor: surfaceBorder,
                        color: colors.textPrimary,
                      },
                    ]}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                    Observações (opcional)
                  </Text>
                  <TextInput
                    accessibilityLabel="Observações"
                    value={notes}
                    onChangeText={setNotes}
                    editable={!isLockedForUncertainRetry}
                    placeholder="Ex: Calibragem dos pneus, viagem em rodovia..."
                    placeholderTextColor={colors.textMuted}
                    maxLength={1000}
                    multiline
                    style={[
                      styles.optionalInput,
                      styles.notesInput,
                      {
                        backgroundColor: colors.bgSecondary,
                        borderColor: surfaceBorder,
                        color: colors.textPrimary,
                      },
                    ]}
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.brandFooterRow}>
              <DiagonalPixelSpark size={5} />
              <Text
                style={[styles.brandFooterText, { color: colors.textSecondary }]}
              >
                Cada abastecimento conta.
              </Text>
              <DiagonalPixelSpark size={5} />
            </View>

            <PrimaryButton
              label={
                isLockedForUncertainRetry
                  ? 'Reenviar abastecimento com mesmo ID'
                  : 'Salvar abastecimento'
              }
              onPress={handleSubmit}
              loading={submitting}
            />
          </View>
        </View>
      )}

      {/* Sheet: Seletor de veículo */}
      <AppSheet
        visible={vehicleSheetOpen}
        title="Veículo do abastecimento"
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
              accessibilityLabel={vehicle.nickname}
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
              <Text style={[styles.sheetRowTitle, { color: colors.textPrimary }]}>
                {vehicle.nickname}
              </Text>
              {isSelected ? (
                <CheckIcon size={18} color={colors.accentPrimary} />
              ) : null}
            </Pressable>
          );
        })}
      </AppSheet>

      {/* Sheet: Seletor de combustível permitido pelo veículo */}
      <AppSheet
        visible={fuelSheetOpen}
        title="Combustível utilizado"
        subtitle={
          activeVehicle
            ? `Opções aceitas por ${activeVehicle.nickname}`
            : undefined
        }
        onClose={() => setFuelSheetOpen(false)}
      >
        {(activeVehicle?.allowedFuels ?? []).map((allowed) => {
          const isSelected = fuelType === allowed;
          return (
            <Pressable
              key={allowed}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              aria-checked={isSelected}
              accessibilityLabel={FUEL_TYPE_LABELS[allowed]}
              onPress={() => {
                setFuelType(allowed);
                setFuelSheetOpen(false);
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
              <Text style={[styles.sheetRowTitle, { color: colors.textPrimary }]}>
                {FUEL_TYPE_LABELS[allowed]}
              </Text>
              {isSelected ? (
                <CheckIcon size={18} color={colors.accentPrimary} />
              ) : null}
            </Pressable>
          );
        })}
      </AppSheet>

      {/* Sheet: Edição de Data, Hora e Timezone */}
      <AppSheet
        visible={dateTimeSheetOpen}
        title="Data, hora e fuso horário"
        subtitle="Você pode registrar abastecimentos retroativos"
        onClose={() => setDateTimeSheetOpen(false)}
      >
        <View style={styles.twoColRow}>
          <View style={[styles.fieldGroup, styles.col]}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Data (AAAA-MM-DD)
            </Text>
            <TextInput
              accessibilityLabel="Data do abastecimento"
              value={dateStr}
              onChangeText={setDateStr}
              placeholder="2026-10-25"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.optionalInput,
                {
                  backgroundColor: colors.bgSecondary,
                  borderColor: colors.borderDefault,
                  color: colors.textPrimary,
                },
              ]}
            />
          </View>

          <View style={[styles.fieldGroup, styles.col]}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Hora (HH:MM)
            </Text>
            <TextInput
              accessibilityLabel="Hora do abastecimento"
              value={timeStr}
              onChangeText={setTimeStr}
              placeholder="14:30"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.optionalInput,
                {
                  backgroundColor: colors.bgSecondary,
                  borderColor: colors.borderDefault,
                  color: colors.textPrimary,
                },
              ]}
            />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
            Fuso horário IANA
          </Text>
          <TextInput
            accessibilityLabel="Fuso horário IANA"
            value={timezone}
            onChangeText={setTimezone}
            placeholder="America/Sao_Paulo"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.optionalInput,
              {
                backgroundColor: colors.bgSecondary,
                borderColor: colors.borderDefault,
                color: colors.textPrimary,
              },
            ]}
          />
        </View>

        <PrimaryButton
          label="Confirmar data e hora"
          onPress={() => setDateTimeSheetOpen(false)}
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
  scrollContent: {
    paddingVertical: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleCol: {
    flex: 1,
    gap: 1,
  },
  headerTitle: {
    ...typography.sectionTitle,
    fontSize: 21,
    lineHeight: 26,
  },
  headerSubtitle: {
    ...typography.caption,
    fontSize: 13,
  },
  noVehicleWrap: {
    marginTop: 20,
  },
  formStack: {
    flexGrow: 1,
    justifyContent: 'space-between',
    gap: 16,
    paddingBottom: 6,
  },
  formTopGroup: {
    gap: 12,
  },
  formBottomGroup: {
    gap: 10,
  },
  paidHeroCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 6,
  },
  paidHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  paidHeroLeft: {
    flex: 1,
    gap: 4,
  },
  paidLabel: {
    ...typography.body,
    fontSize: 14,
  },
  paidHeroDisplay: {
    ...typography.heroValue,
    fontSize: 34,
    lineHeight: 40,
  },
  manualPaidInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  currencyPrefix: {
    ...typography.heroValue,
    fontSize: 28,
  },
  manualPaidInput: {
    flex: 1,
    ...typography.heroValue,
    fontSize: 32,
    paddingVertical: 2,
  },
  referenceText: {
    ...typography.caption,
    fontSize: 13,
  },
  editPaidButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  twoColRow: {
    flexDirection: 'row',
    gap: 10,
  },
  col: {
    flex: 1,
    gap: 5,
  },
  inputLabel: {
    ...typography.caption,
    fontSize: 13,
  },
  decimalBox: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  decimalInput: {
    flex: 1,
    ...typography.numericInput,
    fontSize: 18,
    paddingVertical: 8,
  },
  affixDivider: {
    width: 1,
    height: 22,
  },
  affixText: {
    ...typography.bodyStrong,
    fontSize: 15,
  },
  adjustmentCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  adjustmentLabel: {
    ...typography.caption,
    fontSize: 12,
  },
  adjustmentInput: {
    minHeight: 42,
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    ...typography.body,
  },
  groupedCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  groupedRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  groupedRowBorder: {
    borderBottomWidth: 1,
  },
  rowIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupedRowLabel: {
    ...typography.body,
    fontSize: 14,
  },
  groupedRowRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  groupedRowValue: {
    ...typography.bodyStrong,
    fontSize: 15,
  },
  odometerInlineRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  odometerInlineInput: {
    minWidth: 76,
    textAlign: 'right',
    ...typography.bodyStrong,
    fontSize: 15,
    paddingVertical: 4,
  },
  odometerUnitText: {
    ...typography.bodyStrong,
    fontSize: 15,
  },
  tankSection: {
    gap: 6,
  },
  tankHeading: {
    ...typography.bodyStrong,
    fontSize: 15,
  },
  gapRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gapCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gapLabel: {
    ...typography.body,
    fontSize: 14,
  },
  moreDetailsCardRow: {
    minHeight: 46,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  morePlusBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreDetailsText: {
    flex: 1,
    ...typography.bodyStrong,
    fontSize: 14,
  },
  optionalCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  fieldGroup: {
    gap: 5,
  },
  optionalInput: {
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...typography.body,
  },
  notesInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  brandFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 2,
  },
  brandFooterText: {
    ...typography.caption,
    fontSize: 12,
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
  },
  sheetRow: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetRowTitle: {
    ...typography.bodyStrong,
  },
});
