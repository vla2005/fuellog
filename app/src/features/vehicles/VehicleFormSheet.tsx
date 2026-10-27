import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FUEL_TYPE_LABELS, getVehicle } from '@/api/endpoints';
import {
  ApiError,
  CreateVehicleRequest,
  FuelType,
  UpdateVehicleRequest,
  Vehicle,
} from '@/api/types';
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
  mode?: 'create' | 'edit';
  vehicle?: Vehicle | null;
  onCreated?: (vehicle: Vehicle) => void;
  onUpdated?: (vehicle: Vehicle) => void;
}

export function VehicleFormSheet({
  visible,
  onClose,
  mode = 'create',
  vehicle = null,
  onCreated,
  onUpdated,
}: VehicleFormSheetProps) {
  const isEdit = mode === 'edit';
  const { colors } = useAppTheme();
  const {
    availableFuelTypes,
    createNewVehicle,
    updateExistingVehicle,
    refreshVehicles,
    showToast,
  } = useSession();

  const [model, setModel] = useState('');
  const [selectedFuels, setSelectedFuels] = useState<FuelType[]>([
    'GASOLINE_REGULAR',
    'ETHANOL',
  ]);
  const [currentOdometerKm, setCurrentOdometerKm] = useState('');
  const [tankCapacity, setTankCapacity] = useState('');
  const [formVersion, setFormVersion] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [reloadingConflict, setReloadingConflict] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflictDetected, setConflictDetected] = useState(false);

  const prevVisibleRef = useRef(false);

  const resetForm = () => {
    setModel('');
    setSelectedFuels(['GASOLINE_REGULAR', 'ETHANOL']);
    setCurrentOdometerKm('');
    setTankCapacity('');
    setFormVersion(0);
    setErrorMessage(null);
    setFieldErrors({});
    setConflictDetected(false);
  };

  useEffect(() => {
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = visible;

    if (!wasVisible && visible) {
      if (isEdit && vehicle) {
        setModel(vehicle.model ?? vehicle.nickname ?? '');
        setSelectedFuels(
          vehicle.allowedFuels && vehicle.allowedFuels.length > 0
            ? [...vehicle.allowedFuels]
            : ['GASOLINE_REGULAR', 'ETHANOL'],
        );
        setCurrentOdometerKm(
          vehicle.currentOdometerKm != null ? String(vehicle.currentOdometerKm) : '',
        );
        setTankCapacity(
          vehicle.tankCapacityLiters != null ? vehicle.tankCapacityLiters.replace('.', ',') : '',
        );
        setFormVersion(vehicle.version);
        setErrorMessage(null);
        setFieldErrors({});
        setConflictDetected(false);
      } else if (!isEdit) {
        resetForm();
      }
    }
  }, [visible, isEdit, vehicle]);

  const toggleFuel = (fuel: FuelType) => {
    setSelectedFuels((prev) =>
      prev.includes(fuel) ? prev.filter((f) => f !== fuel) : [...prev, fuel],
    );
  };

  const handleReloadLatest = async () => {
    if (!vehicle?.id) return;
    setReloadingConflict(true);
    try {
      const fresh = await getVehicle(vehicle.id);
      setFormVersion(fresh.version);
      setModel(fresh.model ?? fresh.nickname ?? '');
      setSelectedFuels(
        fresh.allowedFuels && fresh.allowedFuels.length > 0
          ? [...fresh.allowedFuels]
          : ['GASOLINE_REGULAR', 'ETHANOL'],
      );
      setCurrentOdometerKm(
        fresh.currentOdometerKm != null ? String(fresh.currentOdometerKm) : '',
      );
      setTankCapacity(
        fresh.tankCapacityLiters != null ? fresh.tankCapacityLiters.replace('.', ',') : '',
      );
      setConflictDetected(false);
      setErrorMessage(null);
      setFieldErrors({});
      await refreshVehicles();
      showToast({
        tone: 'info',
        title: 'Versão atualizada',
        subtitle: 'Dados mais recentes carregados.',
      });
    } catch {
      showToast({
        tone: 'danger',
        title: 'Falha ao recarregar',
        subtitle: 'Não foi possível obter a versão mais recente do veículo.',
      });
    } finally {
      setReloadingConflict(false);
    }
  };

  const handleSubmit = async () => {
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

    let parsedOdometer: number | null = null;
    const cleanOdometer = currentOdometerKm.trim();
    if (cleanOdometer) {
      if (!/^-?\d+$/.test(cleanOdometer)) {
        localErrors.currentOdometerKm = 'Informe uma quilometragem inteira em km.';
      } else if (cleanOdometer.startsWith('-')) {
        localErrors.currentOdometerKm = 'Informe uma quilometragem inteira não negativa.';
      } else {
        const normalizedDigits = cleanOdometer.replace(/^0+(?=\d)/, '');
        const n = Number(normalizedDigits);
        if (!Number.isSafeInteger(n) || String(n) !== normalizedDigits || n > 9007199254740991) {
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
      if (isEdit) {
        if (!vehicle?.id) {
          setErrorMessage('Veículo não encontrado para edição.');
          return;
        }

        const updatePayload: UpdateVehicleRequest = {
          model: cleanModel,
          allowedFuels: selectedFuels,
          currentOdometerKm: parsedOdometer,
          tankCapacityLiters: normalizedCapacity,
        };

        const updated = await updateExistingVehicle(
          vehicle.id,
          formVersion,
          updatePayload,
        );

        showToast({
          tone: 'success',
          title: 'Veículo atualizado',
          subtitle: `${updated.nickname} atualizado com sucesso.`,
        });
        onUpdated?.(updated);
        onClose();
      } else {
        const createPayload: CreateVehicleRequest = {
          nickname: cleanModel,
          model: cleanModel,
          brand: null,
          modelYear: null,
          plate: null,
          tankCapacityLiters: normalizedCapacity,
          allowedFuels: selectedFuels,
        };
        if (parsedOdometer !== null) {
          createPayload.currentOdometerKm = parsedOdometer;
        }

        const created = await createNewVehicle(createPayload);

        resetForm();
        showToast({
          tone: 'success',
          title: 'Veículo cadastrado',
          subtitle: `${created.nickname} selecionado como veículo ativo.`,
        });
        onCreated?.(created);
        onClose();
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 412 || err.problem?.code === 'PRECONDITION_FAILED') {
          setConflictDetected(true);
          setErrorMessage(
            'Este veículo foi alterado no servidor. Seus dados digitados foram mantidos. Carregue a versão mais recente para atualizar.',
          );
        } else {
          setErrorMessage(err.message);
          if (err.problem?.fieldErrors) {
            setFieldErrors(err.problem.fieldErrors);
          }
        }
      } else {
        setErrorMessage(
          isEdit
            ? 'Não foi possível atualizar o veículo.'
            : 'Não foi possível cadastrar o veículo.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = handleSubmit;
  const modelError = fieldErrors.model || fieldErrors.nickname;

  return (
    <AppSheet
      visible={visible}
      title={isEdit ? 'Editar veículo' : 'Novo veículo'}
      subtitle={
        isEdit
          ? 'Atualize os dados e combustíveis aceitos'
          : 'Cadastre o veículo e os combustíveis aceitos'
      }
      onClose={onClose}
    >
      {conflictDetected ? (
        <View style={styles.conflictWrap} testID="vehicle-conflict-container">
          <InlineNotice
            tone="warning"
            title="Veículo alterado em outra sessão"
            message="Este veículo foi modificado em outra sessão. Seus dados digitados foram preservados. Clique abaixo para carregar a versão mais recente do servidor."
            action={
              <PrimaryButton
                label="Carregar versão atual"
                variant="secondary"
                onPress={handleReloadLatest}
                loading={reloadingConflict}
                testID="vehicle-conflict-reload-button"
                style={styles.conflictReloadBtn}
              />
            }
          />
        </View>
      ) : errorMessage ? (
        <InlineNotice tone="danger" message={errorMessage} />
      ) : null}

      {/* 1. Modelo */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Modelo *
        </Text>
        <TextInput
          accessibilityLabel="Modelo"
          testID="vehicle-model-input"
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
        helperText="Leitura informada no cadastro ou edição. Não é recalculada pelo histórico."
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
        testID="vehicle-tank-capacity-input"
      />

      {/* 5. Botão Salvar */}
      <PrimaryButton
        label={isEdit ? 'Salvar alterações' : 'Salvar veículo'}
        leftIcon={<SaveIcon size={18} color="#FFFFFF" />}
        onPress={handleSubmit}
        loading={submitting}
        stepped
        testID="vehicle-form-submit-button"
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
  conflictWrap: {
    gap: 8,
  },
  conflictReloadBtn: {
    marginTop: 8,
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
  },
});
