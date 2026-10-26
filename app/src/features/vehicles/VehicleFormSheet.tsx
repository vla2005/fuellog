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
import { CheckIcon, ChevronDownIcon, SaveIcon } from '@/components/icons/AppIcons';
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
  const [currentOdometerKm, setCurrentOdometerKm] = useState('');
  const [selectedFuels, setSelectedFuels] = useState<FuelType[]>([
    'GASOLINE_REGULAR',
    'ETHANOL',
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showMoreDetails, setShowMoreDetails] = useState(false);

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
    setCurrentOdometerKm('');
    setSelectedFuels(['GASOLINE_REGULAR', 'ETHANOL']);
    setErrorMessage(null);
    setFieldErrors({});
    setShowMoreDetails(false);
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
        nickname: cleanNickname,
        brand: brand.trim() || null,
        model: model.trim() || null,
        modelYear: parsedYear,
        plate: plate.trim().toUpperCase() || null,
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

  return (
    <AppSheet
      visible={visible}
      title="Novo veículo"
      subtitle="Cadastre o veículo e os combustíveis aceitos"
      onClose={onClose}
    >
      {errorMessage ? <InlineNotice tone="danger" message={errorMessage} /> : null}

      {/* 1. Apelido */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Apelido do veículo *
        </Text>
        <TextInput
          accessibilityLabel="Apelido do veículo"
          value={nickname}
          onChangeText={setNickname}
          placeholder="Ex.: Meu carro"
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

      {/* 2. Marca (linha simples) */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Marca (opcional)
        </Text>
        <TextInput
          accessibilityLabel="Marca"
          value={brand}
          onChangeText={setBrand}
          placeholder="Ex.: Renault"
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

      {/* 3. Modelo (linha simples) */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Modelo (opcional)
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
              borderColor: colors.borderDefault,
              color: colors.textPrimary,
            },
          ]}
        />
      </View>

      {/* 4. Combustíveis aceitos */}
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

      {/* 5. Quilometragem atual (opcional) */}
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

      {/* 6. Seção Opcional Recolhida */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ano, placa e capacidade do tanque"
        onPress={() => setShowMoreDetails((prev) => !prev)}
        style={[styles.collapsibleHeaderRow, { borderTopColor: colors.borderSubtle }]}
      >
        <Text style={[styles.collapsibleTitle, { color: colors.textSecondary }]}>
          Ano, placa e capacidade do tanque
        </Text>
        <View style={showMoreDetails ? { transform: [{ rotate: '180deg' }] } : undefined}>
          <ChevronDownIcon size={18} color={colors.textSecondary} />
        </View>
      </Pressable>

      {showMoreDetails ? (
        <View style={styles.collapsibleBody}>
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Ano (opcional)
            </Text>
            <TextInput
              accessibilityLabel="Ano do modelo"
              value={modelYear}
              onChangeText={setModelYear}
              placeholder="Ex.: 2023"
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

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Placa (opcional)
            </Text>
            <TextInput
              accessibilityLabel="Placa"
              value={plate}
              onChangeText={setPlate}
              placeholder="Ex.: ABC1D23"
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

          <DecimalField
            label="Capacidade do tanque (opcional)"
            value={tankCapacity}
            onChangeText={setTankCapacity}
            placeholder="50,0"
            suffix="L"
            errorText={fieldErrors.tankCapacityLiters}
          />
        </View>
      ) : null}

      {/* 7. Botão Salvar Escalonado */}
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
  collapsibleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: 1,
    marginTop: 4,
  },
  collapsibleTitle: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  collapsibleBody: {
    gap: 12,
    paddingBottom: 6,
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
