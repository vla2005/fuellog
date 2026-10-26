import React, { useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { FUEL_TYPE_SHORT_LABELS } from '@/api/endpoints';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { CarIcon, ChevronDownIcon, PlusIcon, SettingsIcon } from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { FloatingDock } from '@/components/navigation/FloatingDock';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

import { VehicleFormSheet } from './VehicleFormSheet';

export function VehiclesScreen({
  embeddedInShell = false,
}: {
  embeddedInShell?: boolean;
} = {}) {
  const { colors } = useAppTheme();
  const { vehicles, activeVehicle, selectVehicle, showToast } = useSession();
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editNotice, setEditNotice] = useState<string | null>(null);

  const activeFuelsLabel = activeVehicle?.allowedFuels
    ? activeVehicle.allowedFuels.map((f) => FUEL_TYPE_SHORT_LABELS[f] ?? f).join(' e ')
    : 'Nenhum';

  return (
    <ScreenShell
      withDockClearance
      omitTopSafeArea={embeddedInShell}
      footer={embeddedInShell ? undefined : <FloatingDock activeTab="vehicles" />}
    >
      {!embeddedInShell ? (
        <View style={styles.standaloneHeader}>
          <BrandLockup mode="wordmark-only" wordmarkWidth={146} />
        </View>
      ) : null}

      <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>
        Meus veículos
      </Text>

      {/* Garage scene with car and mascot (Print 2) */}
      <View style={[styles.sceneContainer, { backgroundColor: colors.bgSecondary }]}>
        <Image
          source={require('@/assets/brand/scene_garage.png')}
          style={styles.sceneImage}
          resizeMode="cover"
          accessibilityLabel="Garagem com carro azul e mascote"
        />
      </View>

      {vehicles.length === 0 ? (
        <EmptyState
          title="Nenhum veículo cadastrado"
          description="Cadastre seu primeiro veículo para começar a registrar abastecimentos."
          action={
            <PrimaryButton
              label="Cadastrar veículo"
              leftIcon={<PlusIcon size={18} color="#FFFFFF" />}
              onPress={() => setCreateOpen(true)}
            />
          }
        />
      ) : activeVehicle ? (
        <View style={styles.activeVehicleCard}>
          {/* Active Vehicle Title with Dropdown (Print 2) */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Trocar veículo ativo. Atual: ${activeVehicle.nickname}`}
            onPress={() => setPickerOpen(true)}
            style={styles.vehicleDropdownRow}
          >
            <Text style={[styles.vehicleNicknameText, { color: colors.textPrimary }]}>
              {activeVehicle.nickname}
            </Text>
            <ChevronDownIcon size={24} color={colors.brandPrimary} />
          </Pressable>

          <Text style={[styles.activeBadgeText, { color: colors.brandPrimary }]}>
            Veículo ativo
          </Text>

          <Text style={[styles.vehicleSubDetails, { color: colors.textSecondary }]}>
            {activeVehicle.brand} {activeVehicle.model} • {activeVehicle.modelYear || 'Ano não inf.'}
          </Text>

          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

          <View style={styles.fuelSection}>
            <Text style={[styles.fuelLabel, { color: colors.textSecondary }]}>
              Combustíveis
            </Text>
            <Text style={[styles.fuelValue, { color: colors.textPrimary }]}>
              {activeFuelsLabel}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Editar veículo"
            onPress={() => setEditNotice('A versão atual da API do FuelLog suporta apenas criação de veículos. Edição estará disponível em versão futura.')}
            style={styles.editLinkBtn}
          >
            <Text style={[styles.editLinkText, { color: colors.brandPrimary }]}>
              Editar veículo &gt;
            </Text>
          </Pressable>

          {editNotice ? (
            <InlineNotice
              tone="warning"
              title="Recurso indisponível na API"
              message={editNotice}
            />
          ) : null}

          {/* Big Stepped CTA: + Novo veículo */}
          <PrimaryButton
            label="Novo veículo"
            leftIcon={<PlusIcon size={20} color="#FFFFFF" />}
            onPress={() => setCreateOpen(true)}
            stepped
            style={{ marginTop: 12 }}
          />
        </View>
      ) : null}

      {/* Vehicle Switcher Sheet */}
      <AppSheet
        visible={pickerOpen}
        title="Selecionar veículo"
        subtitle="Escolha o veículo ativo"
        onClose={() => setPickerOpen(false)}
      >
        <View style={styles.pickerList}>
          {vehicles.map((v) => {
            const isSelected = v.id === activeVehicle?.id;
            return (
              <Pressable
                key={v.id}
                onPress={async () => {
                  await selectVehicle(v.id);
                  setPickerOpen(false);
                }}
                style={[
                  styles.pickerOption,
                  {
                    backgroundColor: isSelected ? colors.brandSoft : colors.bgElevated,
                    borderColor: isSelected ? colors.borderFocus : colors.borderSubtle,
                  },
                ]}
              >
                <CarIcon size={20} color={isSelected ? colors.brandPrimary : colors.textPrimary} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.pickerOptionTitle, { color: colors.textPrimary }]}>
                    {v.nickname}
                  </Text>
                  <Text style={[styles.pickerOptionSub, { color: colors.textSecondary }]}>
                    {v.brand} {v.model} • {v.modelYear || 'Ano não inf.'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </AppSheet>

      {/* Vehicle Creation Sheet */}
      <VehicleFormSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (saved) => {
          await selectVehicle(saved.id);
          setCreateOpen(false);
          showToast({
            tone: 'success',
            title: 'Veículo cadastrado',
            subtitle: `${saved.nickname} foi adicionado com sucesso.`,
          });
        }}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  standaloneHeader: {
    paddingVertical: 8,
  },
  screenTitle: {
    ...typography.screenTitle,
    fontSize: 26,
    fontWeight: '800',
    paddingVertical: 4,
    marginBottom: 6,
  },
  sceneContainer: {
    width: '100%',
    height: 190,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: '#080E18',
    marginBottom: 16,
  },
  sceneImage: {
    width: '100%',
    height: '100%',
  },
  activeVehicleCard: {
    gap: 8,
  },
  vehicleDropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  vehicleNicknameText: {
    ...typography.screenTitle,
    fontSize: 32,
    fontWeight: '800',
  },
  activeBadgeText: {
    ...typography.bodyStrong,
    fontSize: 15,
  },
  vehicleSubDetails: {
    ...typography.body,
    fontSize: 15,
  },
  divider: {
    height: 1,
    marginVertical: 4,
  },
  fuelSection: {
    paddingVertical: 4,
    gap: 4,
  },
  fuelLabel: {
    ...typography.body,
    fontSize: 14,
  },
  fuelValue: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
  editLinkBtn: {
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  editLinkText: {
    ...typography.bodyStrong,
    fontSize: 15,
  },
  pickerList: {
    gap: 10,
    paddingVertical: 8,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1.5,
  },
  pickerOptionTitle: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
  pickerOptionSub: {
    ...typography.caption,
    fontSize: 13,
  },
});
