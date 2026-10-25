import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { FUEL_TYPE_SHORT_LABELS } from '@/api/endpoints';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { CarIcon, CheckIcon, PlusIcon } from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { FloatingDock } from '@/components/navigation/FloatingDock';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, shadows, typography } from '@/theme/tokens';
import { formatLitersBR } from '@/utils/decimal';

import { VehicleFormSheet } from './VehicleFormSheet';

export function VehiclesScreen() {
  const { colors, isDark } = useAppTheme();
  const { vehicles, activeVehicle, selectVehicle, showToast } = useSession();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <ScreenShell
      withDockClearance
      footer={<FloatingDock activeTab="vehicles" />}
    >
      <View style={styles.headerRow}>
        <BrandLockup mode="header" />
        <PrimaryButton
          label="Novo veículo"
          leftIcon={<PlusIcon size={16} color="#FFFFFF" />}
          onPress={() => setCreateOpen(true)}
          style={styles.headerAction}
        />
      </View>

      <View style={styles.titleBlock}>
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>
          Meus veículos
        </Text>
        <Text style={[styles.screenSubtitle, { color: colors.textSecondary }]}>
          Selecione o veículo ativo para consultar resumo, ciclos e histórico.
        </Text>
      </View>

      {vehicles.length === 0 ? (
        <EmptyState
          title="Nenhum veículo cadastrado"
          description="Cadastre seu primeiro veículo e escolha os combustíveis compatíveis para começar a registrar abastecimentos."
          action={
            <PrimaryButton
              label="Cadastrar primeiro veículo"
              leftIcon={<PlusIcon size={18} color="#FFFFFF" />}
              onPress={() => setCreateOpen(true)}
            />
          }
        />
      ) : (
        <View style={styles.listColumn}>
          {vehicles.map((vehicle) => {
            const isSelected = activeVehicle?.id === vehicle.id;
            const subtitleParts = [
              vehicle.brand,
              vehicle.model,
              vehicle.modelYear ? String(vehicle.modelYear) : null,
            ].filter(Boolean);

            return (
              <Pressable
                key={vehicle.id}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                aria-selected={isSelected}
                accessibilityLabel={`Selecionar veículo ${vehicle.nickname}`}
                onPress={async () => {
                  await selectVehicle(vehicle.id);
                  showToast({
                    tone: 'info',
                    title: 'Veículo ativo alterado',
                    subtitle: `${vehicle.nickname} está selecionado.`,
                  });
                }}
                style={[
                  styles.vehicleCard,
                  {
                    backgroundColor: colors.bgElevated,
                    borderColor: isSelected
                      ? colors.accentPrimary
                      : colors.borderDefault,
                  },
                  isDark ? shadows.darkCard : shadows.lightCard,
                ]}
              >
                <View style={styles.cardTopRow}>
                  <View style={styles.leftRow}>
                    <View
                      style={[
                        styles.iconCircle,
                        {
                          backgroundColor: isSelected
                            ? colors.accentPrimary
                            : colors.accentSoft,
                        },
                      ]}
                    >
                      <CarIcon
                        size={20}
                        color={isSelected ? '#FFFFFF' : colors.accentPrimary}
                      />
                    </View>
                    <View style={styles.titleGroup}>
                      <View style={styles.nameBadgeRow}>
                        <Text
                          style={[styles.vehicleName, { color: colors.textPrimary }]}
                        >
                          {vehicle.nickname}
                        </Text>
                        {isSelected ? (
                          <View
                            style={[
                              styles.activePill,
                              { backgroundColor: colors.accentSoft },
                            ]}
                          >
                            <CheckIcon size={12} color={colors.accentPrimary} />
                            <Text
                              style={[
                                styles.activePillText,
                                { color: colors.accentPrimary },
                              ]}
                            >
                              Ativo
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text
                        style={[
                          styles.vehicleSubtitle,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {subtitleParts.length > 0
                          ? subtitleParts.join(' • ')
                          : 'Marca e modelo não informados'}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.metaRow}>
                  {vehicle.plate ? (
                    <View
                      style={[
                        styles.metaChip,
                        {
                          backgroundColor: colors.bgSecondary,
                          borderColor: colors.borderDefault,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.metaChipText, { color: colors.textSecondary }]}
                      >
                        Placa: {vehicle.plate}
                      </Text>
                    </View>
                  ) : null}
                  {vehicle.tankCapacityLiters ? (
                    <View
                      style={[
                        styles.metaChip,
                        {
                          backgroundColor: colors.bgSecondary,
                          borderColor: colors.borderDefault,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.metaChipText, { color: colors.textSecondary }]}
                      >
                        Tanque: {formatLitersBR(vehicle.tankCapacityLiters)}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.fuelsRow}>
                  {vehicle.allowedFuels.map((fuel) => (
                    <View
                      key={fuel}
                      style={[
                        styles.fuelPill,
                        {
                          backgroundColor: colors.accentSoft,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.fuelPillText,
                          { color: colors.accentPrimary },
                        ]}
                      >
                        {FUEL_TYPE_SHORT_LABELS[fuel]}
                      </Text>
                    </View>
                  ))}
                </View>
              </Pressable>
            );
          })}

          <InlineNotice
            tone="info"
            title="Gerenciamento de veículos"
            message="Cadastre novos veículos e alterne o veículo ativo a qualquer momento. A edição e o arquivamento estarão disponíveis em breve."
          />
        </View>
      )}

      <VehicleFormSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerAction: {
    minHeight: 42,
  },
  titleBlock: {
    gap: 4,
    marginBottom: 16,
  },
  screenTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
  },
  screenSubtitle: {
    ...typography.body,
    fontSize: 13,
  },
  listColumn: {
    gap: 12,
  },
  vehicleCard: {
    borderRadius: radii.lg,
    borderWidth: 1.5,
    padding: 16,
    gap: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleGroup: {
    flex: 1,
    gap: 2,
  },
  nameBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  vehicleName: {
    ...typography.cardTitle,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  activePillText: {
    ...typography.caption,
    fontSize: 11,
  },
  vehicleSubtitle: {
    ...typography.caption,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  metaChipText: {
    ...typography.caption,
    fontSize: 11,
  },
  fuelsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  fuelPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  fuelPillText: {
    ...typography.caption,
    fontSize: 11,
  },
});
