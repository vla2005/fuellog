import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { getFuelEntry, updateFuelEntry } from '@/api/endpoints';
import { ApiError, FuelEntry, UpdateFuelEntryRequest } from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { formatCurrencyBRL } from '@/utils/decimal';
import { FuelEntryForm } from './FuelEntryForm';

export interface EditFuelEntryScreenProps {
  entryId: string;
  initialEntry?: FuelEntry | null;
  onSaved?: (updated: FuelEntry) => void;
  onCancel?: () => void;
  embeddedInShell?: boolean;
}

export function EditFuelEntryScreen({
  entryId, initialEntry, onSaved, onCancel, embeddedInShell = false,
}: EditFuelEntryScreenProps) {
  const { activeVehicle, user, invalidateFuelData, showToast } = useSession();
  const { colors } = useAppTheme();
  const scope = `${user?.id}.${activeVehicle?.id}.${entryId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const sequence = useRef(0);
  const [loaded, setLoaded] = useState<{ scope: string; entry: FuelEntry; revision: number } | null>(() =>
    user && initialEntry?.id === entryId && initialEntry.vehicleId === activeVehicle?.id
      ? { scope, entry: initialEntry, revision: 0 }
      : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!activeVehicle || !user) return;
    const seq = ++sequence.current;
    const entry = await getFuelEntry(activeVehicle.id, entryId);
    if (currentScope.current === scope && seq === sequence.current) {
      setLoaded({ scope, entry, revision: seq });
      setLoadError(null);
    }
  }, [activeVehicle?.id, user?.id, entryId, scope]);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    if (user && initialEntry?.id === entryId && initialEntry.vehicleId === activeVehicle?.id) {
      setLoaded({ scope, entry: initialEntry, revision: sequence.current });
    } else {
      setLoaded(null);
      void reload().catch((err: unknown) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar o abastecimento para edição.');
      });
    }
    return () => { active = false; sequence.current += 1; };
  }, [initialEntry, entryId, activeVehicle?.id, reload, scope]);

  const entry = loaded?.scope === scope ? loaded.entry : null;
  if (!entry) {
    return (
      <ScreenShell withDockClearance={false}>
        {loadError ? <InlineNotice tone="danger" message={loadError} action={
          <PrimaryButton label="Tentar novamente" onPress={() => {
            setLoadError(null);
            void reload().catch(() => setLoadError('Não foi possível carregar o abastecimento para edição.'));
          }} />
        } /> : <View><ActivityIndicator color={colors.brandPrimary} /><Text style={{ color: colors.textSecondary }}>Carregando abastecimento...</Text></View>}
        <PrimaryButton label="Cancelar" variant="ghost" onPress={onCancel ?? (() => {})} />
      </ScreenShell>
    );
  }

  const save = async (payload: UpdateFuelEntryRequest) => {
    const seq = sequence.current;
    const updated = await updateFuelEntry(entry.vehicleId, entry.id, entry.version, payload);
    invalidateFuelData();
    if (currentScope.current !== scope || seq !== sequence.current) return;
    showToast({ tone: 'success', title: 'Abastecimento atualizado', subtitle: `${formatCurrencyBRL(updated.paidTotal)} salvo com sucesso.` });
    onSaved?.(updated);
  };

  return <FuelEntryForm key={`${scope}.${entry.version}.${loaded?.revision}`} embeddedInShell={embeddedInShell}
    edit={{ entry, save, reload, cancel: onCancel }} />;
}
