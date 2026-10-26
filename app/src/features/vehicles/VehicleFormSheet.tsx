import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FUEL_TYPE_LABELS } from '@/api/endpoints';
import { ApiError, CreateVehicleRequest, FuelType, Vehicle } from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { CheckIcon, SaveIcon } from '@/components/icons/AppIcons';
import { AppSheet } from '@/components/overlays/AppSheet';
import { DecimalField } from '@/components/ui/DecimalField';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';
import { parsePositiveDecimalInput } from '@/utils/decimal';

export interface VehicleFormSheetProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: (vehicle: Vehicle) => void;
}

export function VehicleFormSheet({
  visible,
  onClose,
  onCreated,
}: VehicleFormSheetProps) {
  const { colors } = useAppTheme();
  const { availableFuelTypes, createNewVehicle, showToast } = useSession();

  const [model, setModel] = useState('');
  const [selectedFuels, setSelectedFuels] = useState<FuelType[]>([
    'GASOLINE_REGULAR',
    'ETHANOL',
  ]);
  const [currentOdometerKm, setCurrentOdometerKm] = useState('');
  const [tankCapacity, setTankCapacity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const toggleFuel = (fuel: FuelType) => {
    setSelectedFuels((prev) =>
      prev.includes(fuel) ? prev.filter((f) => f !== fuel) : [...prev, fuel],
    );
  };

  const resetForm = () => {
    setModel('');
    setSelectedFuels(['GASOLINE_REGULAR', 'ETHANOL']);
    setCurrentOdometerKm('');
    setTankCapacity('');
    setErrorMessage(null);
    setFieldErrors({});
  };

  const handleCreate = async () => {
    setErrorMessage(null);
    setFieldErrors({});

    const cleanModel = model.trim();
    const localErrors: Record<string, string> = {};

    if (!cleanModel) {
      localErrors.model = 'Informe o modelo do veículo.';
    } else if (cleanModel.length > 60) {
      localErrors.model = 'O modelo deve ter no máximo 60 caracteres.';
    }

    if (selectedFuels.length === 0) {
      localErrors.allowedFuels = 'Selecione ao menos um combustível compatível.';
    }

    let normalizedCapacity: string | null = null;
    if (tankCapacity.trim()) {
      const parsedCap = parsePositiveDecimalInput(tankCapacity, 3);
      if (!parsedCap.valid || !parsedCap.normalizedDot) {
        localErrors.tankCapacityLiters =
          parsedCap.errorReason === 'EXCESSIVE_SCALE'
            ? 'Use no máximo 3 casas decimais na capacidade.'
            : 'Informe uma capacidade positiva válida (ex: 50 ou 52,5).';
      } else {
        normalizedCapacity = parsedCap.normalizedDot;
      }
    }

    let parsedOdometer: number | undefined = undefined;
    const cleanOdometer = currentOdometerKm.trim();
    if (cleanOdometer) {
      if (!/^-?\d+$/.test(cleanOdometer)) {
        localErrors.currentOdometerKm = 'Informe uma quilometragem inteira em km.';
      } else if (cleanOdometer.startsWith('-')) {
        localErrors.currentOdometerKm = 'Informe uma quilometragem inteira não negativa.';
      } else {
        const normalizedDigits = cleanOdometer.replace(/^0+(?=\d)/, '');
        const n = Number(normalizedDigits);
        if (!Number.isSafeInteger(n) || String(n) !== normalizedDigits) {
          localErrors.currentOdometerKm = 'Valor de quilometragem excede o limite suportado.';
        } else {
          parsedOdometer = n;
        }
      }
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    setSubmitting(true);
    try {
      const payload: CreateVehicleRequest = {
        nickname: cleanModel,
        model: cleanModel,
        brand: null,
        modelYear: null,
        plate: null,
        tankCapacityLiters: normalizedCapacity,
        allowedFuels: selectedFuels,
      };
      if (parsedOdometer !== undefined) {
        payload.currentOdometerKm = parsedOdometer;
      }

      const created = await createNewVehicle(payload);

      resetForm();
      showToast({
        tone: 'success',
        title: 'Veículo cadastrado',
        subtitle: `${created.nickname} selecionado como veículo ativo.`,
      });
      onCreated?.(created);
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
        if (err.problem?.fieldErrors) {
          setFieldErrors(err.problem.fieldErrors);
        }
      } else {
        setErrorMessage('Não foi possível cadastrar o veículo.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const modelError = fieldErrors.model || fieldErrors.nickname;

  return (
    <AppSheet
      visible={visible}
      title="Novo veículo"
      subtitle="Cadastre o veículo e os combustíveis aceitos"
      onClose={onClose}
    >
      {errorMessage ? <InlineNotice tone="danger" message={errorMessage} /> : null}

      {/* 1. Modelo */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Modelo *
        </Text>
        <TextInput
          accessibilityLabel="Modelo"
          value={model}
          onChangeText={setModel}
          placeholder="Ex.: Captur"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            {
              backgroundColor: colors.bgSecondary,
              borderColor: modelError
                ? colors.dangerBorder
                : colors.borderDefault,
              color: colors.textPrimary,
            },
          ]}
        />
        {modelError ? (
          <Text style={[styles.errorText, { color: colors.dangerText }]}>
            {modelError}
          </Text>
        ) : null}
      </View>

      {/* 2. Combustíveis aceitos */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Combustíveis aceitos *
        </Text>
        <View style={styles.fuelGrid}>
          {availableFuelTypes.map((fuel) => {
            const isSelected = selectedFuels.includes(fuel);
            return (
              <Pressable
                key={fuel}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                aria-checked={isSelected}
                accessibilityLabel={FUEL_TYPE_LABELS[fuel]}
                onPress={() => toggleFuel(fuel)}
                style={[
                  styles.fuelChip,
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
                <View
                  style={[
                    styles.checkBox,
                    {
                      backgroundColor: isSelected
                        ? colors.accentPrimary
                        : 'transparent',
                      borderColor: isSelected
                        ? colors.accentPrimary
                        : colors.borderStrong,
                    },
                  ]}
                >
                  {isSelected ? <CheckIcon size={12} color="#FFFFFF" /> : null}
                </View>
                <Text
                  style={[
                    styles.fuelChipLabel,
                    {
                      color: isSelected
                        ? colors.accentPrimary
                        : colors.textPrimary,
                    },
                  ]}
                >
                  {FUEL_TYPE_LABELS[fuel]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {fieldErrors.allowedFuels ? (
          <Text style={[styles.errorText, { color: colors.dangerText }]}>
            {fieldErrors.allowedFuels}
          </Text>
        ) : null}
      </View>

      {/* 3. Quilometragem atual (opcional) */}
      <DecimalField
        label="Quilometragem atual (opcional)"
        value={currentOdometerKm}
        onChangeText={setCurrentOdometerKm}
        placeholder="Ex.: 45000"
        suffix="km"
        keyboardType="number-pad"
        helperText="Leitura informada no cadastro. Não é atualizada automaticamente por abastecimentos."
        errorText={fieldErrors.currentOdometerKm}
        testID="vehicle-current-odometer-input"
      />

      {/* 4. Capacidade do tanque (opcional) */}
      <DecimalField
        label="Capacidade do tanque (opcional)"
        value={tankCapacity}
        onChangeText={setTankCapacity}
        placeholder="50,0"
        suffix="L"
        errorText={fieldErrors.tankCapacityLiters}
      />

      {/* 5. Botão Salvar */}
      <PrimaryButton
        label="Salvar veículo"
        leftIcon={<SaveIcon size={18} color="#FFFFFF" />}
        onPress={handleCreate}
        loading={submitting}
        stepped
        style={styles.submitBtn}
      />
    </AppSheet>
  );
}

const styles = StyleSheet.create({
  fieldGroup: {
    gap: 6,
  },
  label: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  input: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    ...typography.body,
    fontSize: 15,
  },
  fuelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fuelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    borderWidth: 1,
    gap: 8,
  },
  checkBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fuelChipLabel: {
    ...typography.bodyStrong,
    fontSize: 13,
  },
  submitBtn: {
    marginTop: 12,
    marginBottom: 6,
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
  },
});
