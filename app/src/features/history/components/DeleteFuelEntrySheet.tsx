import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';

import { deleteFuelEntry, getFuelEntry } from '@/api/endpoints';
import { ApiError, FuelEntry } from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { typography } from '@/theme/tokens';
import { formatDateTimeFullBR } from '@/utils/date';
import { formatCurrencyBRL, formatLitersBR, formatOdometerBR } from '@/utils/decimal';

export function DeleteFuelEntrySheet({ entry, vehicleName, onClose, onDeleted }: {
  entry: FuelEntry;
  vehicleName: string;
  onClose: () => void;
  onDeleted: (entry: FuelEntry) => void;
}) {
  const { colors } = useAppTheme();
  const { invalidateFuelData, showToast } = useSession();
  const [snapshot, setSnapshot] = useState(entry);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const remove = async () => {
    if (busy.current || conflict) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await deleteFuelEntry(snapshot.vehicleId, snapshot.id, snapshot.version);
      invalidateFuelData();
      showToast({ tone: 'success', title: 'Abastecimento excluído.' });
      if (mounted.current) onDeleted(snapshot);
    } catch (err) {
      if (mounted.current) {
        setConflict(err instanceof ApiError && err.status === 412);
        setError(err instanceof ApiError ? err.message : 'Não foi possível excluir. Tente novamente.');
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const refresh = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const updated = await getFuelEntry(snapshot.vehicleId, snapshot.id);
      if (mounted.current) {
        setSnapshot(updated);
        setConflict(false);
        setError('Dados atualizados. Confira o abastecimento antes de confirmar a exclusão.');
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof ApiError ? err.message : 'Não foi possível atualizar o registro.');
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };

  return (
    <AppSheet visible modal title="Excluir abastecimento?" onClose={() => { if (!busy.current) onClose(); }}>
      <Text style={[typography.body, { color: colors.textPrimary }]}>
        {vehicleName}{'\n'}{formatDateTimeFullBR(snapshot.occurredAt, snapshot.timezone)}{'\n'}
        {formatCurrencyBRL(snapshot.paidTotal)} · {formatLitersBR(snapshot.liters)} · {formatOdometerBR(snapshot.odometerKm)}
      </Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>
        O registro será removido do histórico e dos totais. O consumo pode ficar indisponível nos ciclos afetados. Esta ação não pode ser desfeita.
      </Text>
      {error ? <InlineNotice tone={conflict ? 'warning' : 'danger'} message={error} /> : null}
      <PrimaryButton label="Cancelar" testID="fuel-delete-cancel" variant="secondary" disabled={pending} onPress={onClose} />
      {conflict ? <PrimaryButton label="Atualizar dados" variant="secondary" loading={pending} onPress={() => void refresh()} /> : null}
      <PrimaryButton label="Excluir abastecimento" variant="danger" loading={pending} disabled={conflict} onPress={() => void remove()} />
      {pending ? <Text accessibilityRole="status" accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>Aguarde a confirmação do servidor...</Text> : null}
    </AppSheet>
  );
}
