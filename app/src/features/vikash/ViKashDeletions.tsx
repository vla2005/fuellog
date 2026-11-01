import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { getViKashDeletions, retryViKashEntry } from '@/api/endpoints';
import { ApiError, ViKashDeletions as Deletions } from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { formatCurrencyBRL } from '@/utils/decimal';
import { formatDateTimeFullBR } from '@/utils/date';
import { viKashStatusLabel } from './viKashStatusText';
import { ViKashBrand } from './ViKashBrand';
import { viKashColors, viKashStyles } from './viKashTheme';

export function ViKashDeletions() {
  const { user, getCurrentSessionEpoch } = useSession();
  const [data, setData] = useState<Deletions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async (page = 0) => {
    const seq = ++sequence.current, epoch = getCurrentSessionEpoch();
    setBusy(true); setError(null);
    try {
      const result = await getViKashDeletions(page);
      if (seq === sequence.current && epoch === getCurrentSessionEpoch()) setData(result);
    } catch (err) {
      if (seq === sequence.current && epoch === getCurrentSessionEpoch()) setError(err instanceof ApiError ? err.message : 'Não foi possível consultar os cancelamentos.');
    } finally { if (seq === sequence.current && epoch === getCurrentSessionEpoch()) setBusy(false); }
  }, [user?.id, getCurrentSessionEpoch]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  if (!error && !data?.totalElements) return null;
  return <View style={viKashStyles.panel} testID="vikash-deletions">
    <ViKashBrand />
    <Text style={viKashStyles.strong}>Abastecimentos excluídos</Text>
    <Text style={viKashStyles.body}>Confira o cancelamento no ViKash. A exclusão no FuelLog é preservada.</Text>
    {error ? <InlineNotice tone="warning" message={error} action={<PrimaryButton label="Consultar cancelamentos" variant="secondary" onPress={() => void load(data?.page ?? 0)} disabled={busy} />} /> : null}
    {data?.items.map(item => <View key={item.entryId} style={[viKashStyles.divider, { gap: 6 }]}>
      <Text style={viKashStyles.strong}>{formatCurrencyBRL(item.paidTotal)}</Text>
      <Text style={viKashStyles.caption}>{formatDateTimeFullBR(item.occurredAt, 'America/Sao_Paulo')}</Text>
      <Text style={[viKashStyles.body, { color: viKashColors.amber }]}>{viKashStatusLabel(item.status, item.code)}</Text>
      {item.code === 'FINANCIAL_RESTRICTION' ? <Text style={viKashStyles.body}>O lançamento continua no ViKash porque há parcelas ou faturas pagas. Confira diretamente no ViKash; pagamentos não serão desfeitos.</Text> : null}
      {item.code === 'LINK_REVOKED' ? <Text style={viKashStyles.body}>A desconexão interrompeu o pedido. O cancelamento financeiro não foi confirmado.</Text> : null}
      {item.status === 'ERROR' ? <PrimaryButton label="Tentar cancelamento novamente" variant="secondary" disabled={busy} onPress={() => {
        const epoch = getCurrentSessionEpoch(); setBusy(true);
        void retryViKashEntry(item.entryId, 'RETRY').then(() => { if (epoch === getCurrentSessionEpoch()) return load(data.page); })
          .catch(() => { if (epoch === getCurrentSessionEpoch()) { setError('Não foi possível solicitar nova tentativa.'); setBusy(false); } });
      }} /> : null}
    </View>)}
    {data ? <>
      <Text style={viKashStyles.caption}>Página {data.page + 1} · {data.totalElements} registros</Text>
      {data.page > 0 ? <PrimaryButton label="Cancelamentos anteriores" variant="secondary" disabled={busy} onPress={() => void load(data.page - 1)} /> : null}
      {(data.page + 1) * 10 < data.totalElements ? <PrimaryButton label="Próximos cancelamentos" variant="secondary" disabled={busy} onPress={() => void load(data.page + 1)} /> : null}
    </> : null}
  </View>;
}
