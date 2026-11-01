import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { getViKashRemoteStatus, retryViKashEntry } from '@/api/endpoints';
import { ApiError, FuelEntry, ViKashRemoteStatus } from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { viKashStatusLabel } from './viKashStatusText';
import { ViKashBrand } from './ViKashBrand';
import { viKashColors, viKashStyles } from './viKashTheme';

const REASONS: Record<string, string> = {
  PRECONDITION_FAILED: 'O lançamento mudou no ViKash. Revise antes de substituir.',
  FINANCIAL_RESTRICTION: 'O ViKash não permite esta alteração porque há parcelas ou faturas pagas. Confira no ViKash.',
  INVALID_REFERENCE: 'Categoria, conta ou cartão indisponível. Ajuste as escolhas na edição do abastecimento.',
  MANUALLY_DELETED: 'O lançamento foi excluído no ViKash e não será recriado.',
  CANCELLED: 'O lançamento foi cancelado no ViKash e não pode ser reativado.',
  LINK_EXPIRED: 'A autorização expirou. Este abastecimento não será enviado por outro vínculo.',
  LINK_REVOKED: 'A conta foi desconectada. Os lançamentos já enviados permanecem no ViKash.',
};

export function ViKashSyncStatus({ entry, reload }: { entry: FuelEntry; reload: () => Promise<void> }) {
  const { getCurrentSessionEpoch } = useSession();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false), mounted = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<ViKashRemoteStatus | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const state = entry.vikash;
  if (!state) return null;
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    const epoch = getCurrentSessionEpoch(); busyRef.current = true; setBusy(true); setError(null);
    try { await action(); }
    catch (err) { if (mounted.current && epoch === getCurrentSessionEpoch()) setError(err instanceof ApiError ? err.message : 'Não foi possível verificar o envio. Tente novamente.'); }
    finally { busyRef.current = false; if (mounted.current && epoch === getCurrentSessionEpoch()) setBusy(false); }
  };
  const conflict = state.status === 'ACTION_REQUIRED' && ['PRECONDITION_FAILED', 'VERSION_CONFLICT', 'STALE_VERSION', 'ACTIVE'].includes(state.code ?? '');
  return <View style={viKashStyles.panel} testID="vikash-sync-status">
    <ViKashBrand />
    <Text accessibilityLiveRegion="polite" style={[viKashStyles.strong, { color: state.status === 'SENT' ? viKashColors.success : viKashColors.amber }]}>{viKashStatusLabel(state.status, state.code)}</Text>
    <Text style={viKashStyles.body}>{REASONS[state.code ?? ''] ?? (state.status === 'PENDING' || state.status === 'ERROR'
      ? 'O abastecimento está salvo no FuelLog. O envio usa o valor pago e mantém o mesmo identificador em cada tentativa.'
      : 'Estado do envio financeiro deste abastecimento.')}</Text>
    {error ? <InlineNotice tone="warning" message={error} /> : null}
    {state.status === 'PENDING' || state.status === 'ERROR' ? <PrimaryButton label="Atualizar estado do envio" variant="secondary" loading={busy} onPress={() => void run(reload)} /> : null}
    {state.status === 'ERROR' || state.status === 'ACTION_REQUIRED' && ['UNAVAILABLE', 'INVALID_RESPONSE', 'INVALID_REFERENCE'].includes(state.code ?? '') ?
      <PrimaryButton label="Tentar envio novamente" variant="secondary" disabled={busy} onPress={() => void run(async () => { await retryViKashEntry(entry.id, 'RETRY'); await reload(); })} /> : null}
    {conflict ? <PrimaryButton label="Revisar conflito ViKash" variant="secondary" loading={busy} onPress={() => void run(async () => {
      const epoch = getCurrentSessionEpoch(), result = await getViKashRemoteStatus(entry.id);
      if (mounted.current && epoch === getCurrentSessionEpoch()) { setRemote(result); setReviewOpen(true); }
    })} /> : null}
    <AppSheet visible={reviewOpen} modal title="Conflito no ViKash" onClose={() => !busy && setReviewOpen(false)}>
      <View style={viKashStyles.panel}>
      <ViKashBrand />
      <Text style={viKashStyles.body}>{remote?.status === 'ACTIVE'
        ? 'O lançamento mudou no ViKash. Manter preserva esse lançamento. Enviar a versão FuelLog solicita a substituição pelos dados deste abastecimento, respeitando faturas pagas.'
        : 'O lançamento está ausente, excluído ou cancelado no ViKash. Ele não será recriado automaticamente.'}</Text>
      <PrimaryButton label="Manter lançamento no ViKash" variant="secondary" onPress={() => setReviewOpen(false)} disabled={busy} />
      {remote?.status === 'ACTIVE' ? <PrimaryButton label="Enviar versão FuelLog" loading={busy} onPress={() => void run(async () => {
        await retryViKashEntry(entry.id, 'OVERWRITE', remote.etag); setReviewOpen(false); await reload();
      })} /> : null}
      </View>
    </AppSheet>
  </View>;
}
