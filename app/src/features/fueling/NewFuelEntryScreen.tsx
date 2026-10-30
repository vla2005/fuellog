import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
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
} from '@/api/types';
import { DiagonalPixelSpark, PixelMascot } from '@/components/brand/PixelMascot';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  GaugeIcon,
  PencilIcon,
  PlusIcon,
} from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { LocationMap } from '@/components/location/LocationMap';
import { TabActiveContext } from '@/components/navigation/AuthenticatedTabShell';
import { FloatingDock } from '@/components/navigation/FloatingDock';
import { AppSheet } from '@/components/overlays/AppSheet';
import { FixedScaleInput } from '@/components/ui/FixedScaleInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { VehicleFormSheet } from '@/features/vehicles/VehicleFormSheet';
import { useMotionPolicy } from '@/motion/useMotionPolicy';
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
import {
  Coordinates,
  isValidCoordinate,
} from '@/utils/location';
import { generateUuidV4 } from '@/utils/uuid';
import { useForegroundLocation } from './useForegroundLocation';

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
  latitude?: number | null;
  longitude?: number | null;
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

export function NewFuelEntryScreen({
  embeddedInShell = false,
}: {
  embeddedInShell?: boolean;
} = {}) {
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

  const isTabActive = TabActiveContext ? React.useContext(TabActiveContext) : true;
  const { isAppActive } = useMotionPolicy();
  const isScreenActive = isTabActive && isAppActive;

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

  const {
    status: locationStatus,
    coordinates,
    errorMessage: locationError,
    canAskAgain,
    requestLocation,
    openSettings,
    resetLocation,
    setFixedCoordinates,
  } = useForegroundLocation({ autoRequest: false });

  const [vehicleSheetOpen, setVehicleSheetOpen] = useState(false);
  const [dateTimeSheetOpen, setDateTimeSheetOpen] = useState(false);
  const [createVehicleOpen, setCreateVehicleOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [uncertainPendingPayload, setUncertainPendingPayload] =
    useState<CreateFuelEntryRequest | null>(null);

  const [litersFocused, setLitersFocused] = useState(false);
  const [unitPriceFocused, setUnitPriceFocused] = useState(false);
  const [manualPaidFocused, setManualPaidFocused] = useState(false);
  const [odometerFocused, setOdometerFocused] = useState(false);
  const [adjustmentFocused, setAdjustmentFocused] = useState(false);

  const [restoredScopeKey, setRestoredScopeKey] = useState<string | null>(null);
  const restoredScopeKeyRef = useRef<string | null>(null);
  const restoreSeqRef = useRef(0);
  const isNavigatingHomeRef = useRef(false);

  // Garante que combustível incompatível nunca seja mantido ao trocar veículo
  useEffect(() => {
    if (activeVehicle && fuelType && !activeVehicle.allowedFuels.includes(fuelType)) {
      setFuelType(activeVehicle.allowedFuels[0] ?? null);
    }
  }, [activeVehicle, fuelType]);

  const expectedScopeKey =
    user && activeVehicle
      ? getDraftStorageKey(user.id, activeVehicle.id)
      : null;
  const isScopeRestored = Boolean(
    expectedScopeKey && restoredScopeKey === expectedScopeKey,
  );

  // Cancela/invalida captura em voo se a tela ficar inativa na TabShell ou app em segundo plano
  useEffect(() => {
    if (!isScreenActive) {
      resetLocation();
    }
  }, [isScreenActive, resetLocation]);

  // Habilita captura automática apenas após a restauração do escopo coincidir com user + vehicle
  // e impede reinício imediato após salvar e navegar para Home
  useEffect(() => {
    if (
      isScreenActive &&
      !isNavigatingHomeRef.current &&
      isScopeRestored &&
      locationStatus === 'idle' &&
      !coordinates &&
      !uncertainPendingPayload
    ) {
      void requestLocation();
    }
  }, [
    coordinates,
    isScopeRestored,
    isScreenActive,
    locationStatus,
    requestLocation,
    uncertainPendingPayload,
  ]);

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
    resetLocation();

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
            if (
              typeof parsed.latitude === 'number' &&
              typeof parsed.longitude === 'number'
            ) {
              setFixedCoordinates({
                latitude: parsed.latitude,
                longitude: parsed.longitude,
              });
            }
            if (parsed.uncertainPendingPayload) {
              setUncertainPendingPayload(parsed.uncertainPendingPayload);
              if (
                typeof parsed.uncertainPendingPayload.latitude === 'number' &&
                typeof parsed.uncertainPendingPayload.longitude === 'number'
              ) {
                setFixedCoordinates({
                  latitude: parsed.uncertainPendingPayload.latitude,
                  longitude: parsed.uncertainPendingPayload.longitude,
                });
              }
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
  }, [activeVehicle, defaultTimezone, resetLocation, setFixedCoordinates, user]);

  const resetFormState = useCallback(() => {
    const freshNow = new Date();
    const freshDefaultFuel = activeVehicle?.allowedFuels[0] ?? null;
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
    resetLocation();
    setUncertainPendingPayload(null);
    setErrorMessage(null);
    setFieldErrors({});
    setVehicleSheetOpen(false);
    setDateTimeSheetOpen(false);
    setCreateVehicleOpen(false);

    if (expectedScopeKey) {
      void AsyncStorage.removeItem(expectedScopeKey).catch(() => {});
    }
  }, [activeVehicle?.allowedFuels, defaultTimezone, expectedScopeKey, resetLocation]);

  // Descarta edição, fecha submodais e cancela restauração quando a tela for fechada por navegação
  const prevTabActiveRef = useRef(isTabActive);
  useEffect(() => {
    const wasActive = prevTabActiveRef.current;
    prevTabActiveRef.current = isTabActive;

    if (wasActive && !isTabActive) {
      isNavigatingHomeRef.current = false;
      restoreSeqRef.current += 1;
      resetFormState();
    }
  }, [isTabActive, resetFormState]);

  const handleClose = useCallback(() => {
    isNavigatingHomeRef.current = true;
    resetFormState();
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [resetFormState, router]);

  // Salva rascunho somente quando o escopo restaurado coincide exatamente com userId + vehicleId atuais
  useEffect(() => {
    if (!user || !activeVehicle) return;
    if (isNavigatingHomeRef.current || !isTabActive) return;
    const key = getDraftStorageKey(user.id, activeVehicle.id);
    if (restoredScopeKey !== key || restoredScopeKeyRef.current !== key) {
      return;
    }

    const hasContent =
      Boolean(liters) ||
      Boolean(unitPrice) ||
      Boolean(manualPaidTotal) ||
      Boolean(odometerKm) ||
      Boolean(adjustmentReason) ||
      Boolean(uncertainPendingPayload);

    if (!hasContent) {
      void AsyncStorage.removeItem(key).catch(() => {});
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
      latitude: coordinates ? coordinates.latitude : null,
      longitude: coordinates ? coordinates.longitude : null,
      uncertainPendingPayload,
    };
    void AsyncStorage.setItem(key, JSON.stringify(draft)).catch(() => {});
  }, [
    activeVehicle,
    adjustmentReason,
    coordinates,
    dateStr,
    entryId,
    fuelType,
    isManualPaidTotal,
    liters,
    manualPaidTotal,
    odometerKm,
    restoredScopeKey,
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
      if (referenceTotalDot) {
        setManualPaidTotal(referenceTotalDot.replace('.', ','));
      }
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
    setFieldErrors({});
  };

  const handleSubmit = async () => {
    if (!user || !activeVehicle) {
      setErrorMessage('Selecione ou cadastre um veículo antes de salvar.');
      return;
    }

    const expectedScopeKey = getDraftStorageKey(user.id, activeVehicle.id);
    if (
      restoredScopeKey !== expectedScopeKey ||
      restoredScopeKeyRef.current !== expectedScopeKey
    ) {
      setErrorMessage(
        'Sincronizando rascunho do veículo selecionado. Tente novamente em instantes.',
      );
      return;
    }

    setErrorMessage(null);
    setFieldErrors({});

    let payloadToSend: CreateFuelEntryRequest;

    if (uncertainPendingPayload) {
      payloadToSend = uncertainPendingPayload;
    } else {
      const nextErrors: Record<string, string> = {};

      const parsedLiters = parsePositiveDecimalInput(liters, 1);
      if (!parsedLiters.valid || !parsedLiters.normalizedDot) {
        nextErrors.liters =
          parsedLiters.errorReason === 'EXCESSIVE_SCALE'
            ? 'Máximo de 1 casa decimal para litros.'
            : parsedLiters.errorReason === 'NON_POSITIVE'
              ? 'Informe um volume maior que zero.'
              : 'Informe os litros.';
      }

      const parsedUnitPrice = parsePositiveDecimalInput(unitPrice, 2);
      if (!parsedUnitPrice.valid || !parsedUnitPrice.normalizedDot) {
        nextErrors.unitPrice =
          parsedUnitPrice.errorReason === 'EXCESSIVE_SCALE'
            ? 'Máximo de 2 casas decimais para o preço.'
            : parsedUnitPrice.errorReason === 'NON_POSITIVE'
              ? 'Informe um preço maior que zero.'
              : 'Informe o preço por litro.';
      }

      const parsedPaid = parsePositiveDecimalInput(effectivePaidTotalInput, 2);
      if (!parsedPaid.valid || !parsedPaid.normalizedDot) {
        nextErrors.paidTotal =
          parsedPaid.errorReason === 'EXCESSIVE_SCALE'
            ? 'Máximo de 2 casas decimais para o valor pago.'
            : parsedPaid.errorReason === 'NON_POSITIVE'
              ? 'Informe um valor maior que zero.'
              : 'Informe o valor pago.';
      }

      const cleanOdometer = odometerKm.trim();
      if (!/^\d+$/.test(cleanOdometer)) {
        nextErrors.odometerKm = 'Informe um hodômetro inteiro em km.';
      }

      if (!parsedOccurredAtIso) {
        nextErrors.occurredAt = 'Data ou hora inválida. Use AAAA-MM-DD e HH:MM.';
      }

      if (!fuelType) {
        nextErrors.fuelType = 'Selecione o combustível.';
      } else if (!activeVehicle.allowedFuels.includes(fuelType)) {
        nextErrors.fuelType =
          'Este combustível não é permitido para o veículo selecionado.';
      }

      const cleanReason = adjustmentReason.trim();
      if (adjustmentInfo.requiresReason && !cleanReason) {
        nextErrors.adjustmentReason =
          'Diferença acima de R$ 0,05 exige justificativa.';
      }

      if (Object.keys(nextErrors).length > 0) {
        setFieldErrors(nextErrors);
        setErrorMessage('Corrija os campos destacados antes de salvar.');
        return;
      }

      if (
        locationStatus !== 'ready' ||
        !coordinates ||
        !isValidCoordinate(coordinates.latitude, coordinates.longitude)
      ) {
        setErrorMessage(
          'Localização obrigatória: aguarde a obtenção do GPS antes de salvar.',
        );
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
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        tankState: 'UNKNOWN',
        historyGapBefore: false,
        adjustmentReason: cleanReason || null,
        stationName: null,
        notes: null,
      };
    }

    const targetVehicleId = activeVehicle.id;
    const targetVehicleNickname = activeVehicle.nickname;

    setSubmitting(true);
    try {
      const savedEntry = await createFuelEntry(targetVehicleId, payloadToSend);

      isNavigatingHomeRef.current = true;
      resetFormState();

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
  const focusBorderColor = isDark ? colors.borderFocus : colors.brandPrimary;

  const vehicleHeaderSubtitle = activeVehicle
    ? [
        activeVehicle.nickname,
        activeVehicle.modelYear ? `• ${activeVehicle.modelYear}` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : 'Selecionar veículo';

  return (
    <ScreenShell
      withDockClearance={false}
      omitTopSafeArea={false}
      contentContainerStyle={styles.scrollContent}
      footer={undefined}
    >
      {/* Compact Header: Close button (X) + Title + Vehicle dropdown */}
      <View style={styles.compactHeaderRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          onPress={handleClose}
          style={styles.compactBackBtn}
        >
          <CloseIcon size={20} color={colors.brandPrimary} />
        </Pressable>

        <View style={styles.compactTitleCol}>
          <Text style={[styles.compactTitleText, { color: colors.textPrimary }]}>
            Novo abastecimento
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Veículo: ${vehicleHeaderSubtitle}`}
            disabled={isLockedForUncertainRetry}
            onPress={() => setVehicleSheetOpen(true)}
            style={styles.compactVehicleRow}
          >
            <Text style={[styles.compactVehicleText, { color: colors.textSecondary }]}>
              {activeVehicle?.nickname ?? 'Selecionar veículo'}
            </Text>
            <ChevronDownIcon size={16} color={colors.brandPrimary} />
          </Pressable>
        </View>
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

          {/* Combustível em Radio no topo (apenas activeVehicle.allowedFuels) */}
          <View style={styles.fuelRadioSection}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Combustível
            </Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Combustível"
              style={styles.fuelRadioGroup}
            >
              {(activeVehicle?.allowedFuels ?? []).map((fuel) => {
                const isSelected = fuelType === fuel;
                return (
                  <Pressable
                    key={fuel}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                    aria-checked={isSelected}
                    accessibilityLabel={FUEL_TYPE_LABELS[fuel] ?? fuel}
                    disabled={isLockedForUncertainRetry}
                    onPress={() => setFuelType(fuel)}
                    style={[
                      styles.fuelRadioItem,
                      {
                        backgroundColor: isSelected
                          ? (isDark ? colors.accentSoft : colors.brandSoft)
                          : surfaceBg,
                        borderColor: isSelected
                          ? (isDark ? colors.borderFocus : colors.brandPrimary)
                          : surfaceBorder,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.radioCircle,
                        {
                          borderColor: isSelected
                            ? (isDark ? colors.borderFocus : colors.brandPrimary)
                            : colors.borderDefault,
                        },
                      ]}
                    >
                      {isSelected ? (
                        <View
                          style={[
                            styles.radioDot,
                            {
                              backgroundColor: isDark
                                ? colors.borderFocus
                                : colors.brandPrimary,
                            },
                          ]}
                        />
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.fuelRadioText,
                        {
                          color: isSelected
                            ? colors.textPrimary
                            : colors.textSecondary,
                        },
                      ]}
                    >
                      {FUEL_TYPE_LABELS[fuel] ?? fuel}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {fieldErrors.fuelType ? (
              <Text style={[styles.errorText, { color: colors.dangerText }]}>
                {fieldErrors.fuelType}
              </Text>
            ) : null}
          </View>

          {/* 2-Column Inputs: Litros & Preço por litro (campos principais) */}
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
                      : litersFocused
                        ? focusBorderColor
                        : surfaceBorder,
                  },
                ]}
              >
                <FixedScaleInput
                  accessibilityLabel="Litros abastecidos"
                  value={liters}
                  onChangeText={setLiters}
                  onFocus={() => setLitersFocused(true)}
                  onBlur={() => setLitersFocused(false)}
                  scale={1}
                  editable={!isLockedForUncertainRetry}
                  placeholder="0,0"
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
                      : unitPriceFocused
                        ? focusBorderColor
                        : surfaceBorder,
                  },
                ]}
              >
                <Text
                  style={[styles.affixText, { color: colors.textSecondary }]}
                >
                  R$
                </Text>
                <FixedScaleInput
                  accessibilityLabel="Preço por litro"
                  value={unitPrice}
                  onChangeText={setUnitPrice}
                  onFocus={() => setUnitPriceFocused(true)}
                  onBlur={() => setUnitPriceFocused(false)}
                  scale={2}
                  editable={!isLockedForUncertainRetry}
                  placeholder="0,00"
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

          {/* Valor pago logo abaixo menor e editável em caso de desconto */}
          <View
            style={[
              styles.paidCompactCard,
              {
                backgroundColor: surfaceBg,
                borderColor: fieldErrors.paidTotal
                  ? colors.dangerBorder
                  : manualPaidFocused
                    ? focusBorderColor
                    : surfaceBorder,
              },
              isDark ? shadows.darkCard : shadows.lightCard,
            ]}
          >
            <View style={styles.paidCompactRow}>
              <View style={styles.paidCompactLeft}>
                <Text style={[styles.paidCompactLabel, { color: colors.textSecondary }]}>
                  {isManualPaidTotal
                    ? 'Valor pago (desconto / ajuste manual)'
                    : 'Valor pago'}
                </Text>

                {isManualPaidTotal ? (
                  <View style={styles.manualPaidInputRow}>
                    <Text
                      style={[
                        styles.manualCurrencyPrefix,
                        { color: colors.textPrimary },
                      ]}
                    >
                      R$
                    </Text>
                    <FixedScaleInput
                      accessibilityLabel="Valor total pago"
                      value={manualPaidTotal}
                      onChangeText={setManualPaidTotal}
                      onFocus={() => setManualPaidFocused(true)}
                      onBlur={() => setManualPaidFocused(false)}
                      scale={2}
                      editable={!isLockedForUncertainRetry}
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
                      styles.paidCompactDisplay,
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
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={[
                  styles.editPaidCompactButton,
                  {
                    backgroundColor: colors.brandSoft,
                  },
                ]}
              >
                {isManualPaidTotal ? (
                  <CheckIcon
                    size={18}
                    color={isDark ? colors.borderFocus : colors.brandPrimary}
                  />
                ) : (
                  <PencilIcon
                    size={16}
                    color={isDark ? colors.borderFocus : colors.brandPrimary}
                  />
                )}
              </Pressable>
            </View>

            {fieldErrors.paidTotal ? (
              <Text style={[styles.errorText, { color: colors.dangerText }]}>
                {fieldErrors.paidTotal}
              </Text>
            ) : null}
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
                    : adjustmentFocused
                      ? focusBorderColor
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
                onFocus={() => setAdjustmentFocused(true)}
                onBlur={() => setAdjustmentFocused(false)}
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

          {/* Grouped Card: Quilometragem e Data */}
          <View
            style={[
              styles.groupedCard,
              {
                backgroundColor: surfaceBg,
                borderColor:
                  fieldErrors.odometerKm || fieldErrors.occurredAt
                    ? colors.dangerBorder
                    : odometerFocused
                      ? focusBorderColor
                      : surfaceBorder,
              },
              isDark ? shadows.darkCard : shadows.lightCard,
            ]}
          >
            {/* Row 1: Quilometragem (escala 0 inteira) */}
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
                <FixedScaleInput
                  accessibilityLabel="Hodômetro atual (km inteiro)"
                  value={odometerKm}
                  onChangeText={setOdometerKm}
                  onFocus={() => setOdometerFocused(true)}
                  onBlur={() => setOdometerFocused(false)}
                  scale={0}
                  editable={!isLockedForUncertainRetry}
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
              style={styles.groupedRow}
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
          </View>

          {fieldErrors.odometerKm || fieldErrors.occurredAt ? (
            <Text style={[styles.errorText, { color: colors.dangerText }]}>
              {fieldErrors.odometerKm || fieldErrors.occurredAt}
            </Text>
          ) : null}

          </View>

          <View style={styles.formBottomGroup}>
            {/* Location Section Card: GPS Foreground capture and Square Map */}
            <View
              style={[
                styles.locationSectionCard,
                {
                  backgroundColor: surfaceBg,
                  borderColor:
                    locationStatus === 'error' ||
                    locationStatus === 'permission_denied' ||
                    locationStatus === 'services_disabled'
                      ? colors.statusDangerBorder
                      : surfaceBorder,
                },
                isDark ? shadows.darkCard : shadows.lightCard,
              ]}
            >
              <View style={styles.locationHeaderRow}>
                <View style={styles.locationTitleCol}>
                  <Text style={[styles.locationHeading, { color: colors.textPrimary }]}>
                    Localização do abastecimento
                  </Text>
                  <Text style={[styles.locationSubheading, { color: colors.textSecondary }]}>
                    {locationStatus === 'ready' && coordinates
                      ? 'Coordenadas capturadas via GPS'
                      : 'Obrigatório para registrar o abastecimento'}
                  </Text>
                </View>

                {locationStatus === 'ready' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Recapturar localização atual"
                    disabled={isLockedForUncertainRetry}
                    onPress={() => requestLocation(true)}
                    style={[
                      styles.recaptureBtn,
                      {
                        backgroundColor: colors.brandSoft,
                      },
                    ]}
                  >
                    <Text style={[styles.recaptureBtnText, { color: colors.brandPrimary }]}>
                      Recapturar
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {locationStatus === 'requesting_permission' || locationStatus === 'locating' ? (
                <View style={styles.locatingBox}>
                  <ActivityIndicator size="small" color={colors.brandPrimary} />
                  <Text style={[styles.locatingText, { color: colors.textSecondary }]}>
                    Obtendo coordenadas do GPS...
                  </Text>
                </View>
              ) : locationStatus === 'permission_denied' ? (
                <View style={styles.locationNoticeWrap}>
                  <InlineNotice
                    tone="danger"
                    title="Permissão de localização negada"
                    message={
                      locationError ??
                      'O FuelLog precisa de acesso ao GPS em primeiro plano para registrar as coordenadas do abastecimento.'
                    }
                    action={
                      <View style={styles.locationActionRow}>
                        <PrimaryButton
                          label="Tentar novamente"
                          variant="secondary"
                          onPress={() => requestLocation(true)}
                        />
                        {Platform?.OS !== 'web' ? (
                          <PrimaryButton
                            label="Abrir configurações"
                            variant="secondary"
                            onPress={openSettings}
                          />
                        ) : null}
                      </View>
                    }
                  />
                </View>
              ) : locationStatus === 'services_disabled' ? (
                <View style={styles.locationNoticeWrap}>
                  <InlineNotice
                    tone="warning"
                    title="GPS desativado no dispositivo"
                    message={
                      locationError ??
                      'Ative a localização nas configurações do aparelho para continuar.'
                    }
                    action={
                      <View style={styles.locationActionRow}>
                        <PrimaryButton
                          label="Verificar novamente"
                          variant="secondary"
                          onPress={() => requestLocation(true)}
                        />
                        {Platform?.OS !== 'web' ? (
                          <PrimaryButton
                            label="Abrir configurações"
                            variant="secondary"
                            onPress={openSettings}
                          />
                        ) : null}
                      </View>
                    }
                  />
                </View>
              ) : locationStatus === 'error' ? (
                <View style={styles.locationNoticeWrap}>
                  <InlineNotice
                    tone="danger"
                    title="Falha ao obter localização"
                    message={
                      locationError ??
                      'Não foi possível obter o sinal de GPS. Verifique a recepção e tente novamente.'
                    }
                    action={
                      <PrimaryButton
                        label="Tentar novamente"
                        variant="secondary"
                        onPress={() => requestLocation(true)}
                      />
                    }
                  />
                </View>
              ) : locationStatus === 'ready' && coordinates ? (
                <LocationMap
                  latitude={coordinates.latitude}
                  longitude={coordinates.longitude}
                />
              ) : null}
            </View>

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
              disabled={
                submitting ||
                (!uncertainPendingPayload &&
                  (locationStatus !== 'ready' || !coordinates))
              }
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
  compactHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  compactBackBtn: {
    padding: 6,
    marginLeft: -6,
  },
  compactTitleCol: {
    flex: 1,
    gap: 2,
  },
  compactTitleText: {
    ...typography.screenTitle,
    fontSize: 22,
    fontWeight: '700',
  },
  compactVehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  compactVehicleText: {
    ...typography.body,
    fontSize: 14,
  },
  scrollContent: {
    paddingTop: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  headerSpacer: {
    width: 38,
    height: 38,
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
    width: '100%',
    minWidth: 0,
  },
  formTopGroup: {
    gap: 12,
    width: '100%',
    minWidth: 0,
  },
  fuelRadioSection: {
    gap: 6,
  },
  fuelRadioGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fuelRadioItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    borderWidth: 1.5,
    gap: 8,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  fuelRadioText: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  paidCompactCard: {
    borderRadius: radii.lg,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  paidCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  paidCompactLeft: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  paidCompactLabel: {
    ...typography.caption,
    fontSize: 13,
  },
  paidCompactDisplay: {
    ...typography.heroValue,
    fontSize: 22,
    lineHeight: 28,
  },
  manualCurrencyPrefix: {
    ...typography.bodyStrong,
    fontSize: 18,
    flexShrink: 0,
  },
  editPaidCompactButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  formBottomGroup: {
    gap: 10,
  },
  manualPaidInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    flex: 1,
  },
  manualPaidInput: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    ...typography.heroValue,
    fontSize: 22,
    paddingVertical: 2,
    textAlign: 'right',
    ...Platform.select({
      web: {
        outlineStyle: 'none',
        outlineWidth: 0,
      } as any,
    }),
  },
  referenceText: {
    ...typography.caption,
    fontSize: 13,
  },
  twoColRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    minWidth: 0,
  },
  col: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  inputLabel: {
    ...typography.caption,
    fontSize: 13,
  },
  decimalBox: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  decimalInput: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    ...typography.numericInput,
    fontSize: 18,
    paddingVertical: 8,
    textAlign: 'right',
    ...Platform.select({
      web: {
        outlineStyle: 'none',
        outlineWidth: 0,
      } as any,
    }),
  },
  affixDivider: {
    width: 1,
    height: 22,
    flexShrink: 0,
  },
  affixText: {
    ...typography.bodyStrong,
    fontSize: 15,
    flexShrink: 0,
  },
  adjustmentCard: {
    borderRadius: radii.md,
    borderWidth: 1.5,
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
    ...Platform.select({
      web: {
        outlineStyle: 'none',
        outlineWidth: 0,
      } as any,
    }),
  },
  groupedCard: {
    borderRadius: radii.lg,
    borderWidth: 1.5,
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
    flexShrink: 0,
  },
  groupedRowLabel: {
    ...typography.body,
    fontSize: 14,
    flexShrink: 0,
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
    minWidth: 0,
  },
  odometerInlineInput: {
    minWidth: 0,
    flexShrink: 1,
    textAlign: 'right',
    ...typography.bodyStrong,
    fontSize: 15,
    paddingVertical: 4,
    ...Platform.select({
      web: {
        outlineStyle: 'none',
        outlineWidth: 0,
      } as any,
    }),
  },
  odometerUnitText: {
    ...typography.bodyStrong,
    fontSize: 15,
    flexShrink: 0,
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
    ...Platform.select({
      web: {
        outlineStyle: 'none',
        outlineWidth: 0,
      } as any,
    }),
  },
  notesInput: {
    minHeight: 72,
    textAlignVertical: 'top',
    ...Platform.select({
      web: {
        outlineStyle: 'none',
        outlineWidth: 0,
      } as any,
    }),
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
  locationSectionCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  locationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  locationTitleCol: {
    flex: 1,
    gap: 2,
  },
  locationHeading: {
    ...typography.cardTitle,
    fontSize: 16,
    fontWeight: '700',
  },
  locationSubheading: {
    ...typography.caption,
    fontSize: 12,
  },
  recaptureBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
  },
  recaptureBtnText: {
    ...typography.bodyStrong,
    fontSize: 12,
  },
  locatingBox: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  locatingText: {
    ...typography.body,
    fontSize: 13,
  },
  locationNoticeWrap: {
    paddingVertical: 4,
  },
  locationActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
});
