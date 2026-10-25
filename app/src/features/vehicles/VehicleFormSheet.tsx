import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FUEL_TYPE_LABELS } from '@/api/endpoints';
import { ApiError, FuelType, Vehicle } from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { CheckIcon } from '@/components/icons/AppIcons';
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

  const [nickname, setNickname] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [modelYear, setModelYear] = useState('');
  const [plate, setPlate] = useState('');
  const [tankCapacity, setTankCapacity] = useState('');
  const [selectedFuels, setSelectedFuels] = useState<FuelType[]>([
    'GASOLINE_REGULAR',
    'ETHANOL',
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const toggleFuel = (fuel: FuelType) => {
    setSelectedFuels((prev) =>
      prev.includes(fuel) ? prev.filter((f) => f !== fuel) : [...prev, fuel],
    );
  };

  const resetForm = () => {
    setNickname('');
    setBrand('');
    setModel('');
    setModelYear('');
    setPlate('');
    setTankCapacity('');
    setSelectedFuels(['GASOLINE_REGULAR', 'ETHANOL']);
    setErrorMessage(null);
    setFieldErrors({});
  };

  const handleCreate = async () => {
    setErrorMessage(null);
    setFieldErrors({});

    const cleanNickname = nickname.trim();
    const localErrors: Record<string, string> = {};

    if (!cleanNickname) {
      localErrors.nickname = 'Informe um apelido para identificar o veículo.';
    } else if (cleanNickname.length > 60) {
      localErrors.nickname = 'O apelido deve ter no máximo 60 caracteres.';
    }

    if (selectedFuels.length === 0) {
      localErrors.allowedFuels = 'Selecione ao menos um combustível compatível.';
    }

    let parsedYear: number | null = null;
    if (modelYear.trim()) {
      if (!/^\d{4}$/.test(modelYear.trim())) {
        localErrors.modelYear = 'Informe o ano com 4 dígitos (ex: 2023).';
      } else {
        const y = Number(modelYear.trim());
        if (y < 1886 || y > 2200) {
          localErrors.modelYear = 'Ano fora do intervalo permitido (1886–2200).';
        } else {
          parsedYear = y;
        }
      }
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

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    setSubmitting(true);
    try {
      const created = await createNewVehicle({
        nickname: cleanNickname,
        brand: brand.trim() || null,
        model: model.trim() || null,
        modelYear: parsedYear,
        plate: plate.trim().toUpperCase() || null,
        tankCapacityLiters: normalizedCapacity,
        allowedFuels: selectedFuels,
      });

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

  return (
    <AppSheet
      visible={visible}
      title="Novo veículo"
      subtitle="Cadastre o veículo e os combustíveis aceitos"
      onClose={onClose}
    >
      {errorMessage ? <InlineNotice tone="danger" message={errorMessage} /> : null}

      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Apelido do veículo *
        </Text>
        <TextInput
          accessibilityLabel="Apelido do veículo"
          value={nickname}
          onChangeText={setNickname}
          placeholder="Ex: Civic Touring, Onix, Hilux"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            {
              backgroundColor: colors.bgSecondary,
              borderColor: fieldErrors.nickname
                ? colors.dangerBorder
                : colors.borderDefault,
              color: colors.textPrimary,
            },
          ]}
        />
        {fieldErrors.nickname ? (
          <Text style={[styles.errorText, { color: colors.dangerText }]}>
            {fieldErrors.nickname}
          </Text>
        ) : null}
      </View>

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

      <View style={styles.row2Col}>
        <View style={[styles.fieldGroup, styles.col]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            Marca (opcional)
          </Text>
          <TextInput
            accessibilityLabel="Marca"
            value={brand}
            onChangeText={setBrand}
            placeholder="Honda"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              {
                backgroundColor: colors.bgSecondary,
                borderColor: colors.borderDefault,
                color: colors.textPrimary,
              },
            ]}
          />
        </View>

        <View style={[styles.fieldGroup, styles.col]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            Modelo (opcional)
          </Text>
          <TextInput
            accessibilityLabel="Modelo"
            value={model}
            onChangeText={setModel}
            placeholder="Civic"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              {
                backgroundColor: colors.bgSecondary,
                borderColor: colors.borderDefault,
                color: colors.textPrimary,
              },
            ]}
          />
        </View>
      </View>

      <View style={styles.row2Col}>
        <View style={[styles.fieldGroup, styles.col]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            Ano (opcional)
          </Text>
          <TextInput
            accessibilityLabel="Ano do modelo"
            value={modelYear}
            onChangeText={setModelYear}
            placeholder="2023"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            maxLength={4}
            style={[
              styles.input,
              {
                backgroundColor: colors.bgSecondary,
                borderColor: fieldErrors.modelYear
                  ? colors.dangerBorder
                  : colors.borderDefault,
                color: colors.textPrimary,
              },
            ]}
          />
          {fieldErrors.modelYear ? (
            <Text style={[styles.errorText, { color: colors.dangerText }]}>
              {fieldErrors.modelYear}
            </Text>
          ) : null}
        </View>

        <View style={[styles.fieldGroup, styles.col]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            Placa (opcional)
          </Text>
          <TextInput
            accessibilityLabel="Placa"
            value={plate}
            onChangeText={setPlate}
            placeholder="ABC1D23"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            maxLength={16}
            style={[
              styles.input,
              {
                backgroundColor: colors.bgSecondary,
                borderColor: colors.borderDefault,
                color: colors.textPrimary,
              },
            ]}
          />
        </View>
      </View>

      <DecimalField
        label="Capacidade do tanque (opcional)"
        value={tankCapacity}
        onChangeText={setTankCapacity}
        placeholder="50,0"
        suffix="L"
        errorText={fieldErrors.tankCapacityLiters}
      />

      <PrimaryButton
        label="Salvar veículo"
        onPress={handleCreate}
        loading={submitting}
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
    ...typography.caption,
  },
  input: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...typography.body,
  },
  fuelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fuelChip: {
    minHeight: 42,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkBox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fuelChipLabel: {
    ...typography.caption,
    fontSize: 13,
  },
  row2Col: {
    flexDirection: 'row',
    gap: 10,
  },
  col: {
    flex: 1,
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
  },
  submitBtn: {
    marginTop: 6,
  },
});
