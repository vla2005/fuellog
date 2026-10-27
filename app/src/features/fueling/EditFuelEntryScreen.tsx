import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  AppStateStatus,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  FUEL_TYPE_LABELS,
  getFuelEntry,
  updateFuelEntry,
} from '@/api/endpoints';
import {
  ApiError,
  FuelEntry,
  FuelType,
  UpdateFuelEntryRequest,
} from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import {
  CalendarIcon,
  ChevronLeftIcon,
  GaugeIcon,
  PencilIcon,
} from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { LocationMap } from '@/components/location/LocationMap';
import { AppSheet } from '@/components/overlays/AppSheet';
import { FixedScaleInput } from '@/components/ui/FixedScaleInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useMotionPolicy } from '@/motion/useMotionPolicy';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, shadows, typography } from '@/theme/tokens';
import {
  calculateAdjustment,
  calculateReferenceTotal,
  formatCurrencyBRL,
  parsePositiveDecimalInput,
} from '@/utils/decimal';
import {
  formatDigitsToDisplay,
  parseArbitraryInputToDigits,
} from '@/utils/numericMask';
import {
  countSignificantDecimals,
  formatEntryDateForInput,
  parseDateTimeInTimezone,
  stripInsignificantZeros,
} from './fuelEditDateHelper';

export interface EditFuelEntryScreenProps {
  entryId: string;
  initialEntry?: FuelEntry | null;
  onSaved?: (updated: FuelEntry) => void;
  onCancel?: () => void;
  embeddedInShell?: boolean;
}


export function EditFuelEntryScreen({
  entryId,
  initialEntry,
  onSaved,
  onCancel,
  embeddedInShell = false,
}: EditFuelEntryScreenProps) {
  const { colors, isDark } = useAppTheme();
  const { activeVehicle, invalidateFuelData, showToast } = useSession();
  const { reduceMotion, duration, easing } = useMotionPolicy();

  const [loading, setLoading] = useState(!initialEntry);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entry, setEntry] = useState<FuelEntry | null>(initialEntry ?? null);

  // Form field states
  const [liters, setLiters] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [manualPaidTotal, setManualPaidTotal] = useState('');
  const [isManualPaidTotal, setIsManualPaidTotal] = useState(false);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [odometerKm, setOdometerKm] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [fuelType, setFuelType] = useState<FuelType | null>(null);

  // Precision scales (determined upon loading to preserve legacy high-precision values)
  const [litersScale, setLitersScale] = useState(1);
  const [unitPriceScale, setUnitPriceScale] = useState(2);

  // Status & validation states
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [staleConflict, setStaleConflict] = useState(false);
  const [dateTimeSheetOpen, setDateTimeSheetOpen] = useState(false);

  // Focus states
  const [litersFocused, setLitersFocused] = useState(false);
  const [unitPriceFocused, setUnitPriceFocused] = useState(false);
  const [manualPaidFocused, setManualPaidFocused] = useState(false);
  const [odometerFocused, setOdometerFocused] = useState(false);
  const [adjustmentFocused, setAdjustmentFocused] = useState(false);

  // Celebratory bounce animation
  const celebrationPulse = useRef(new Animated.Value(0)).current;
  const celebrationAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const [initialDateStr, setInitialDateStr] = useState('');
  const [initialTimeStr, setInitialTimeStr] = useState('');

  useEffect(() => {
    const handleAppStateChange = (state: AppStateStatus) => {
      if (state !== 'active') {
        celebrationAnimRef.current?.stop();
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
      celebrationAnimRef.current?.stop();
    };
  }, []);

  // Populate form from entry
  const populateFromEntry = useCallback((loaded: FuelEntry) => {
    setEntry(loaded);
    const cleanLiters = stripInsignificantZeros(loaded.liters);
    const cleanUnitPrice = stripInsignificantZeros(loaded.unitPrice);

    const lScale = Math.min(3, Math.max(1, countSignificantDecimals(cleanLiters)));
    const pScale = Math.min(4, Math.max(2, countSignificantDecimals(cleanUnitPrice)));
    setLitersScale(lScale);
    setUnitPriceScale(pScale);

    setLiters(
      formatDigitsToDisplay(
        parseArbitraryInputToDigits(cleanLiters, lScale) ?? '',
        lScale,
      ),
    );
    setUnitPrice(
      formatDigitsToDisplay(
        parseArbitraryInputToDigits(cleanUnitPrice, pScale) ?? '',
        pScale,
      ),
    );

    const hasDifferentPaid = loaded.paidTotal !== loaded.referenceTotal;
    setIsManualPaidTotal(hasDifferentPaid);
    if (hasDifferentPaid) {
      setManualPaidTotal(
        formatDigitsToDisplay(
          parseArbitraryInputToDigits(loaded.paidTotal, 2) ?? '',
          2,
        ),
      );
    } else {
      setManualPaidTotal('');
    }

    setAdjustmentReason(loaded.adjustmentReason ?? '');
    setOdometerKm(
      formatDigitsToDisplay(
        parseArbitraryInputToDigits(String(loaded.odometerKm), 0) ?? '',
        0,
      ),
    );

    const dt = formatEntryDateForInput(loaded.occurredAt, loaded.timezone);
    setDateStr(dt.dateStr);
    setTimeStr(dt.timeStr);
    setInitialDateStr(dt.dateStr);
    setInitialTimeStr(dt.timeStr);
    setFuelType(loaded.fuelType);
  }, []);

  // Initial load
  const loadEntry = useCallback(async () => {
    if (!activeVehicle?.id || !entryId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getFuelEntry(activeVehicle.id, entryId);
      populateFromEntry(res);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setLoadError(err.message);
      } else {
        setLoadError('Não foi possível carregar o abastecimento para edição.');
      }
    } finally {
      setLoading(false);
    }
  }, [activeVehicle?.id, entryId, populateFromEntry]);

  useEffect(() => {
    if (initialEntry) {
      populateFromEntry(initialEntry);
      setLoading(false);
    } else {
      void loadEntry();
    }
  }, [initialEntry, loadEntry, populateFromEntry]);

  // Allowed fuels: vehicle allowed fuels + original entry fuel if not currently in allowedFuels
  const fuelOptions = useMemo(() => {
    const allowed = activeVehicle?.allowedFuels ?? [];
    if (!entry) return allowed;
    if (allowed.includes(entry.fuelType)) {
      return allowed;
    }
    // Mantém o combustível original do histórico como opção selecionável
    return [entry.fuelType, ...allowed];
  }, [activeVehicle?.allowedFuels, entry]);

  // Calculated Reference Total
  const calculatedReferenceTotal = useMemo(() => {
    return calculateReferenceTotal(liters, unitPrice);
  }, [liters, unitPrice]);

  // Effective Paid Total
  const effectivePaidTotal = useMemo(() => {
    if (isManualPaidTotal && manualPaidTotal) {
      return manualPaidTotal;
    }
    return calculatedReferenceTotal ?? '';
  }, [calculatedReferenceTotal, isManualPaidTotal, manualPaidTotal]);

  // Adjustment calculation
  const adjustment = useMemo(() => {
    return calculateAdjustment(effectivePaidTotal, calculatedReferenceTotal);
  }, [calculatedReferenceTotal, effectivePaidTotal]);

  const displayPaidValue = useMemo(() => {
    if (isManualPaidTotal && manualPaidTotal) {
      const parsed = parsePositiveDecimalInput(manualPaidTotal, 2);
      if (parsed.valid && parsed.normalizedDot) {
        return formatCurrencyBRL(parsed.normalizedDot);
      }
      return manualPaidTotal;
    }
    if (calculatedReferenceTotal) {
      return formatCurrencyBRL(calculatedReferenceTotal);
    }
    return 'R$ 0,00';
  }, [calculatedReferenceTotal, isManualPaidTotal, manualPaidTotal]);

  // Handle explicit refresh on 412 conflict: atualiza TODOS os campos visíveis,
  // precisão, metadados e versão a partir do GET mais recente
  const handleReloadLatest = async () => {
    if (!activeVehicle?.id || !entryId) return;
    try {
      setSubmitting(true);
      const latest = await getFuelEntry(activeVehicle.id, entryId);
      populateFromEntry(latest);
      setStaleConflict(false);
      setErrorMessage(null);
      setFieldErrors({});
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Submit Handler
  const handleSave = async () => {
    if (!activeVehicle?.id || !entry) return;

    setErrorMessage(null);
    setFieldErrors({});

    const nextErrors: Record<string, string> = {};

    const parsedLiters = parsePositiveDecimalInput(liters, litersScale);
    if (!parsedLiters.valid || !parsedLiters.normalizedDot) {
      nextErrors.liters =
        parsedLiters.errorReason === 'EXCESSIVE_SCALE'
          ? `Máximo de ${litersScale} casas decimais para litros.`
          : parsedLiters.errorReason === 'NON_POSITIVE'
            ? 'Informe um volume maior que zero.'
            : 'Informe os litros abastecidos.';
    }

    const parsedUnitPrice = parsePositiveDecimalInput(
      unitPrice,
      unitPriceScale,
    );
    if (!parsedUnitPrice.valid || !parsedUnitPrice.normalizedDot) {
      nextErrors.unitPrice =
        parsedUnitPrice.errorReason === 'EXCESSIVE_SCALE'
          ? `Máximo de ${unitPriceScale} casas decimais para o preço.`
          : parsedUnitPrice.errorReason === 'NON_POSITIVE'
            ? 'Informe um preço maior que zero.'
            : 'Informe o preço por litro.';
    }

    const parsedOdometerDigits = parseArbitraryInputToDigits(odometerKm, 0);
    if (!parsedOdometerDigits) {
      nextErrors.odometerKm = 'Informe o hodômetro em km.';
    }

    if (!fuelType) {
      nextErrors.fuelType = 'Selecione o tipo de combustível.';
    }

    let occurredAtIso: string;
    const dateOrTimeChanged =
      dateStr.trim() !== initialDateStr.trim() ||
      timeStr.trim() !== initialTimeStr.trim();

    if (!dateOrTimeChanged) {
      // Ao editar somente preço/outro campo, preserve EXATAMENTE entry.occurredAt original
      occurredAtIso = entry.occurredAt;
    } else {
      const parsed = parseDateTimeInTimezone(
        dateStr,
        timeStr,
        entry.timezone,
      );
      if (!parsed) {
        nextErrors.occurredAt = 'Data ou hora em formato inválido.';
        occurredAtIso = '';
      } else {
        occurredAtIso = parsed;
        const entryTime = new Date(occurredAtIso).getTime();
        const maxFuture = Date.now() + 5 * 60 * 1000;
        if (entryTime > maxFuture) {
          nextErrors.occurredAt =
            'A data e hora não podem exceder 5 minutos no futuro.';
        }
      }
    }

    const parsedPaid = parsePositiveDecimalInput(effectivePaidTotal, 2);
    if (!parsedPaid.valid || !parsedPaid.normalizedDot) {
      nextErrors.paidTotal = 'Informe o valor total pago.';
    }

    if (adjustment.requiresReason && !adjustmentReason.trim()) {
      nextErrors.adjustmentReason =
        'Justifique a diferença no total pago (superior a R$ 0,05).';
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setErrorMessage('Verifique os campos destacados antes de salvar.');
      return;
    }

    const payload: UpdateFuelEntryRequest = {
      occurredAt: occurredAtIso,
      timezone: entry.timezone,
      odometerKm: Number(parsedOdometerDigits),
      fuelType: fuelType!,
      liters: parsedLiters.normalizedDot!,
      unitPrice: parsedUnitPrice.normalizedDot!,
      paidTotal: parsedPaid.normalizedDot!,
      tankState: entry.tankState,
      historyGapBefore: entry.historyGapBefore,
      adjustmentReason: adjustment.requiresReason
        ? adjustmentReason.trim()
        : adjustmentReason.trim() || entry.adjustmentReason || null,
      stationName: entry.stationName,
      notes: entry.notes,
      latitude: entry.latitude,
      longitude: entry.longitude,
    };

    setSubmitting(true);
    try {
      const updated = await updateFuelEntry(
        activeVehicle.id,
        entry.id,
        entry.version,
        payload,
      );

      // Salto celebrativo após salvar confirmado (com limpeza na desmontagem e pausa em segundo plano)
      if (!reduceMotion) {
        celebrationAnimRef.current?.stop();
        celebrationAnimRef.current = Animated.sequence([
          Animated.timing(celebrationPulse, {
            toValue: -8,
            duration: duration('micro', 120),
            easing: easing.enter,
            useNativeDriver: true,
          }),
          Animated.spring(celebrationPulse, {
            toValue: 0,
            friction: 4,
            tension: 50,
            useNativeDriver: true,
          }),
        ]);
        celebrationAnimRef.current.start();
      }

      invalidateFuelData();
      showToast({
        tone: 'success',
        title: 'Abastecimento atualizado',
        subtitle: `${formatCurrencyBRL(updated.paidTotal)} salvo com sucesso.`,
      });

      if (onSaved) {
        onSaved(updated);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 412) {
          setStaleConflict(true);
          setErrorMessage(
            'Abastecimento alterado externamente. Recarregue os dados atuais para sincronizar a versão antes de editar.',
          );
        } else if (err.status === 422 && err.problem?.fieldErrors) {
          setFieldErrors(err.problem.fieldErrors);
          setErrorMessage(
            err.message || 'Verifique os campos destacados e tente novamente.',
          );
        } else {
          setErrorMessage(err.message);
        }
      } else {
        setErrorMessage(
          'Falha de comunicação ao salvar alterações. Seus dados foram mantidos.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const surfaceBg = isDark ? colors.bgSecondary : '#FFFFFF';
  const surfaceBorder = isDark ? colors.borderDefault : '#E2E8F0';
  const focusBorderColor = colors.accentPrimary;

  const headerContent = (
    <View style={styles.headerRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancelar edição"
        onPress={onCancel ?? (() => {})}
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
      <View style={styles.headerTitleCol}>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
          Editar abastecimento
        </Text>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
          {activeVehicle?.nickname ?? 'Veículo'}
        </Text>
      </View>
      <View style={styles.headerSpacer} />
    </View>
  );

  return (
    <ScreenShell
      withDockClearance={false}
      omitTopSafeArea={false}
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
            {headerContent}
          </View>
        ) : undefined
      }
    >
      {embeddedInShell ? headerContent : null}

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
            Carregando abastecimento para edição...
          </Text>
        </View>
      ) : loadError || !entry ? (
        <InlineNotice
          tone="danger"
          title="Erro ao carregar"
          message={
            loadError ?? 'Não foi possível encontrar o registro para edição.'
          }
          action={
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <PrimaryButton
                label="Tentar novamente"
                variant="secondary"
                onPress={loadEntry}
              />
              <PrimaryButton label="Voltar" variant="ghost" onPress={onCancel ?? (() => {})} />
            </View>
          }
        />
      ) : (
        <View style={styles.formStack}>
          {/* Top Form Group */}
          <View style={styles.formTopGroup}>
            {/* Stale 412 Conflict Notice */}
            {staleConflict ? (
              <InlineNotice
                tone="warning"
                title="Abastecimento alterado"
                message="Este registro foi modificado em outra sessão. Ao recarregar a versão mais recente, os dados deste formulário serão substituídos pelas informações gravadas no servidor."
                action={
                  <PrimaryButton
                    label="Recarregar versão mais recente"
                    variant="secondary"
                    loading={submitting}
                    onPress={handleReloadLatest}
                  />
                }
              />
            ) : null}

            {/* General Error Notice */}
            {errorMessage && !staleConflict ? (
              <InlineNotice
                tone="danger"
                title="Não foi possível salvar"
                message={errorMessage}
              />
            ) : null}

            {/* Fuel Type Selector */}
            <View style={styles.fuelRadioSection}>
              <Text
                style={[styles.inputLabel, { color: colors.textSecondary }]}
              >
                Combustível
              </Text>
              <View
                style={styles.fuelRadioGroup}
                accessibilityRole="radiogroup"
                accessibilityLabel="Tipo de combustível"
              >
                {fuelOptions.map((type) => {
                  const isSelected = fuelType === type;
                  const isOriginalHistorical =
                    entry &&
                    type === entry.fuelType &&
                    !activeVehicle?.allowedFuels.includes(type);

                  const label = isOriginalHistorical
                    ? `${FUEL_TYPE_LABELS[type]} (atual do registro)`
                    : FUEL_TYPE_LABELS[type];

                  return (
                    <Pressable
                      key={type}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected, checked: isSelected }}
                      aria-checked={isSelected}
                      accessibilityLabel={label}
                      onPress={() => {
                        setFuelType(type);
                        setFieldErrors((prev) => ({
                          ...prev,
                          fuelType: '',
                        }));
                      }}
                      style={[
                        styles.fuelRadioItem,
                        {
                          backgroundColor: isSelected
                            ? colors.brandSoft
                            : surfaceBg,
                          borderColor: isSelected
                            ? colors.brandPrimary
                            : surfaceBorder,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.radioCircle,
                          {
                            borderColor: isSelected
                              ? colors.brandPrimary
                              : colors.borderDefault,
                          },
                        ]}
                      >
                        {isSelected ? (
                          <View
                            style={[
                              styles.radioDot,
                              { backgroundColor: colors.brandPrimary },
                            ]}
                          />
                        ) : null}
                      </View>
                      <Text
                        style={[
                          styles.fuelRadioText,
                          {
                            color: isSelected
                              ? colors.brandPrimary
                              : colors.textPrimary,
                          },
                        ]}
                      >
                        {label}
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

            {/* Liters & Unit Price */}
            <View style={styles.row}>
              <View style={styles.col}>
                <Text
                  style={[styles.inputLabel, { color: colors.textSecondary }]}
                >
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
                    onChangeText={(val) => {
                      setLiters(val);
                      setFieldErrors((prev) => ({ ...prev, liters: '' }));
                    }}
                    onFocus={() => setLitersFocused(true)}
                    onBlur={() => setLitersFocused(false)}
                    scale={litersScale}
                    placeholder={
                      litersScale === 1
                        ? '0,0'
                        : litersScale === 2
                          ? '0,00'
                          : '0,000'
                    }
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
                  <Text
                    style={[styles.errorText, { color: colors.dangerText }]}
                  >
                    {fieldErrors.liters}
                  </Text>
                ) : null}
              </View>

              <View style={styles.col}>
                <Text
                  style={[styles.inputLabel, { color: colors.textSecondary }]}
                >
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
                    onChangeText={(val) => {
                      setUnitPrice(val);
                      setFieldErrors((prev) => ({ ...prev, unitPrice: '' }));
                    }}
                    onFocus={() => setUnitPriceFocused(true)}
                    onBlur={() => setUnitPriceFocused(false)}
                    scale={unitPriceScale}
                    placeholder={
                      unitPriceScale === 2
                        ? '0,00'
                        : unitPriceScale === 3
                          ? '0,000'
                          : '0,0000'
                    }
                    placeholderTextColor={colors.textMuted}
                    style={[styles.decimalInput, { color: colors.textPrimary }]}
                  />
                </View>
                {fieldErrors.unitPrice ? (
                  <Text
                    style={[styles.errorText, { color: colors.dangerText }]}
                  >
                    {fieldErrors.unitPrice}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Total Paid Value Box */}
            <View
              style={[
                styles.paidCompactCard,
                {
                  backgroundColor: surfaceBg,
                  borderColor: fieldErrors.paidTotal
                    ? colors.dangerBorder
                    : surfaceBorder,
                },
              ]}
            >
              <View style={styles.paidCompactRow}>
                <View style={styles.paidCompactLeft}>
                  <Text
                    style={[
                      styles.paidCompactLabel,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Valor total pago
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
                        accessibilityLabel="Valor total pago manual"
                        value={manualPaidTotal}
                        onChangeText={(val) => {
                          setManualPaidTotal(val);
                          setFieldErrors((prev) => ({
                            ...prev,
                            paidTotal: '',
                          }));
                        }}
                        onFocus={() => setManualPaidFocused(true)}
                        onBlur={() => setManualPaidFocused(false)}
                        scale={2}
                        placeholder="0,00"
                        placeholderTextColor={colors.textMuted}
                        style={[
                          styles.manualPaidInput,
                          {
                            color: colors.textPrimary,
                            borderBottomColor: manualPaidFocused
                              ? focusBorderColor
                              : 'transparent',
                          },
                        ]}
                      />
                    </View>
                  ) : (
                    <Text
                      style={[
                        styles.paidCompactDisplay,
                        { color: colors.textPrimary },
                      ]}
                    >
                      {displayPaidValue}
                    </Text>
                  )}
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    isManualPaidTotal
                      ? 'Restaurar cálculo automático do total'
                      : 'Editar valor total pago manualmente'
                  }
                  onPress={() => {
                    if (isManualPaidTotal) {
                      setIsManualPaidTotal(false);
                      setManualPaidTotal('');
                      setAdjustmentReason('');
                    } else {
                      setIsManualPaidTotal(true);
                      setManualPaidTotal(
                        formatDigitsToDisplay(
                          parseArbitraryInputToDigits(
                            calculatedReferenceTotal ?? '0',
                            2,
                          ) ?? '',
                          2,
                        ),
                      );
                    }
                  }}
                  style={[
                    styles.editPaidCompactButton,
                    {
                      backgroundColor: isManualPaidTotal
                        ? colors.brandSoft
                        : colors.bgSecondary,
                    },
                  ]}
                >
                  <PencilIcon
                    size={16}
                    color={
                      isManualPaidTotal
                        ? colors.brandPrimary
                        : colors.textSecondary
                    }
                  />
                </Pressable>
              </View>

              {isManualPaidTotal ? (
                <Text
                  style={[
                    styles.manualPaidHint,
                    { color: colors.textSecondary },
                  ]}
                >
                  {adjustment.diffCents !== 0n
                    ? `Diferença de ${formatCurrencyBRL(
                        adjustment.adjustmentDot ?? '0.00',
                      )} em relação ao cálculo (${formatCurrencyBRL(
                        calculatedReferenceTotal ?? '0.00',
                      )})`
                    : 'Modo de valor pago personalizado'}
                </Text>
              ) : null}

              {fieldErrors.paidTotal ? (
                <Text style={[styles.errorText, { color: colors.dangerText }]}>
                  {fieldErrors.paidTotal}
                </Text>
              ) : null}
            </View>

            {/* Adjustment Reason if abs(diff) > 0.05 */}
            {adjustment.requiresReason || isManualPaidTotal ? (
              <View style={styles.fieldGroup}>
                <Text
                  style={[styles.inputLabel, { color: colors.textSecondary }]}
                >
                  Motivo do ajuste{' '}
                  {adjustment.requiresReason ? '(obrigatório)' : '(opcional)'}
                </Text>
                <TextInput
                  accessibilityLabel="Justificativa da diferença no valor pago"
                  value={adjustmentReason}
                  onChangeText={(val) => {
                    setAdjustmentReason(val);
                    setFieldErrors((prev) => ({
                      ...prev,
                      adjustmentReason: '',
                    }));
                  }}
                  onFocus={() => setAdjustmentFocused(true)}
                  onBlur={() => setAdjustmentFocused(false)}
                  placeholder="Ex: desconto no posto, arredondamento"
                  placeholderTextColor={colors.textMuted}
                  maxLength={300}
                  style={[
                    styles.textInputFull,
                    {
                      backgroundColor: surfaceBg,
                      borderColor: fieldErrors.adjustmentReason
                        ? colors.dangerBorder
                        : adjustmentFocused
                          ? focusBorderColor
                          : surfaceBorder,
                      color: colors.textPrimary,
                    },
                  ]}
                />
                {fieldErrors.adjustmentReason ? (
                  <Text
                    style={[styles.errorText, { color: colors.dangerText }]}
                  >
                    {fieldErrors.adjustmentReason}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* Odometer */}
            <View style={styles.fieldGroup}>
              <Text
                style={[styles.inputLabel, { color: colors.textSecondary }]}
              >
                Quilometragem (km)
              </Text>
              <View
                style={[
                  styles.odometerBox,
                  {
                    backgroundColor: surfaceBg,
                    borderColor: fieldErrors.odometerKm
                      ? colors.dangerBorder
                      : odometerFocused
                        ? focusBorderColor
                        : surfaceBorder,
                  },
                ]}
              >
                <GaugeIcon size={20} color={colors.textSecondary} />
                <FixedScaleInput
                  accessibilityLabel="Hodômetro atual (km inteiro)"
                  value={odometerKm}
                  onChangeText={(val) => {
                    setOdometerKm(val);
                    setFieldErrors((prev) => ({ ...prev, odometerKm: '' }));
                  }}
                  onFocus={() => setOdometerFocused(true)}
                  onBlur={() => setOdometerFocused(false)}
                  scale={0}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.odometerInput, { color: colors.textPrimary }]}
                />
                <Text
                  style={[styles.affixText, { color: colors.textSecondary }]}
                >
                  km
                </Text>
              </View>
              {fieldErrors.odometerKm ? (
                <Text style={[styles.errorText, { color: colors.dangerText }]}>
                  {fieldErrors.odometerKm}
                </Text>
              ) : null}
            </View>

            {/* Date & Time Picker Row */}
            <View style={styles.fieldGroup}>
              <Text
                style={[styles.inputLabel, { color: colors.textSecondary }]}
              >
                Data e hora
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Alterar data e hora"
                onPress={() => setDateTimeSheetOpen(true)}
                style={[
                  styles.dateTimeRowButton,
                  {
                    backgroundColor: surfaceBg,
                    borderColor: fieldErrors.occurredAt
                      ? colors.dangerBorder
                      : surfaceBorder,
                  },
                ]}
              >
                <View style={styles.dateTimeRowLeft}>
                  <CalendarIcon size={18} color={colors.textSecondary} />
                  <View style={styles.dateTimeTextCol}>
                    <Text
                      style={[
                        styles.dateTimeDisplay,
                        { color: colors.textPrimary },
                      ]}
                    >
                      {dateStr ? dateStr.split('-').reverse().join('/') : '--/--/----'}{' '}
                      às {timeStr || '--:--'}
                    </Text>
                    {entry.timezone ? (
                      <Text
                        style={[
                          styles.dateTimeTimezoneHint,
                          { color: colors.textSecondary },
                        ]}
                        numberOfLines={1}
                      >
                        Fuso do registro: {entry.timezone}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <PencilIcon size={16} color={colors.brandPrimary} />
              </Pressable>
              {fieldErrors.occurredAt ? (
                <Text style={[styles.errorText, { color: colors.dangerText }]}>
                  {fieldErrors.occurredAt}
                </Text>
              ) : null}
            </View>

            {/* Location Section: Preserved coordinates or unavailable note */}
            <View
              style={[
                styles.locationCard,
                {
                  backgroundColor: colors.bgElevated,
                  borderColor: colors.borderDefault,
                },
              ]}
            >
              <Text
                style={[styles.locationCardTitle, { color: colors.textPrimary }]}
              >
                Localização original
              </Text>
              {entry.latitude != null && entry.longitude != null ? (
                <LocationMap
                  latitude={entry.latitude}
                  longitude={entry.longitude}
                />
              ) : (
                <Text
                  style={[
                    styles.unavailableLocationText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Localização indisponível para este registro (salvo antes da
                  integração com GPS). Coordenadas não são requeridas na edição.
                </Text>
              )}
            </View>
          </View>

          {/* Bottom Actions */}
          <View style={styles.formBottomGroup}>
            <Animated.View
              style={{
                transform: [{ translateY: celebrationPulse }],
              }}
            >
              <PrimaryButton
                label="Salvar alterações"
              loading={submitting}
              onPress={handleSave}
              stepped
              />
            </Animated.View>

            <PrimaryButton
              label="Cancelar"
              variant="ghost"
              disabled={submitting}
              onPress={onCancel ?? (() => {})}
            />
          </View>
        </View>
      )}

      {/* Date & Time Bottom Sheet */}
      <AppSheet
        visible={dateTimeSheetOpen}
        title="Editar data e hora"
        onClose={() => setDateTimeSheetOpen(false)}
      >
        {entry?.timezone ? (
          <Text
            style={[styles.sheetTimezoneInfo, { color: colors.textSecondary }]}
          >
            Fuso horário do registro: {entry.timezone}
          </Text>
        ) : null}
        <View style={styles.row}>
          <View style={[styles.fieldGroup, styles.col]}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Data (AAAA-MM-DD)
            </Text>
            <TextInput
              accessibilityLabel="Data do abastecimento"
              value={dateStr}
              onChangeText={setDateStr}
              placeholder="AAAA-MM-DD"
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

        <PrimaryButton
          label="Confirmar data e hora"
          onPress={() => setDateTimeSheetOpen(false)}
        />
      </AppSheet>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  topBar: {
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  headerSpacer: {
    width: 42,
    height: 42,
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
    gap: 2,
  },
  headerTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    fontWeight: '800',
  },
  headerSubtitle: {
    ...typography.caption,
    fontSize: 13,
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
  formStack: {
    flexGrow: 1,
    justifyContent: 'space-between',
    gap: 16,
    paddingBottom: 24,
    width: '100%',
    minWidth: 0,
  },
  formTopGroup: {
    gap: 14,
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
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  col: {
    flex: 1,
    minWidth: 0,
  },
  fieldGroup: {
    gap: 6,
  },
  inputLabel: {
    ...typography.caption,
    fontSize: 13,
    fontWeight: '600',
  },
  decimalBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    height: 48,
  },
  decimalInput: {
    flex: 1,
    ...typography.bodyStrong,
    fontSize: 16,
  },
  affixDivider: {
    width: 1,
    height: 20,
    marginHorizontal: 8,
  },
  affixText: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '600',
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
  manualPaidInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  manualCurrencyPrefix: {
    ...typography.bodyStrong,
    fontSize: 18,
  },
  manualPaidInput: {
    flex: 1,
    ...typography.heroValue,
    fontSize: 22,
    borderBottomWidth: 1.5,
    paddingVertical: 2,
  },
  editPaidCompactButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  manualPaidHint: {
    ...typography.caption,
    fontSize: 12,
    marginTop: 2,
  },
  textInputFull: {
    borderRadius: radii.md,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...typography.body,
    fontSize: 14,
  },
  odometerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    height: 48,
    gap: 8,
  },
  odometerInput: {
    flex: 1,
    ...typography.bodyStrong,
    fontSize: 16,
  },
  dateTimeRowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.md,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minHeight: 48,
  },
  dateTimeRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  dateTimeTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  dateTimeTimezoneHint: {
    ...typography.caption,
    fontSize: 11,
  },
  sheetTimezoneInfo: {
    ...typography.caption,
    fontSize: 12,
    marginBottom: 10,
  },
  dateTimeDisplay: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  locationCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 14,
    gap: 8,
    marginTop: 4,
  },
  locationCardTitle: {
    ...typography.cardTitle,
    fontSize: 15,
  },
  unavailableLocationText: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 18,
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
    marginTop: 2,
  },
  formBottomGroup: {
    gap: 10,
    marginTop: 12,
  },
  optionalInput: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...typography.body,
    fontSize: 14,
  },
});
