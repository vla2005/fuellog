import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Switch, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { cancelViKashAuthorization, disconnectViKash, saveViKashPreferences, startViKashAuthorization } from '@/api/endpoints';
import { ApiError, ViKashPreferences } from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';
import { ViKashFields } from './ViKashFields';
import { choicesError } from './viKashChoices';
import { useViKash } from './useViKash';
import { ViKashDeletions } from './ViKashDeletions';

WebBrowser.maybeCompleteAuthSession();

export function ViKashSettings() {
  const { colors } = useAppTheme();
  const { status, catalog, loading, error, reload } = useViKash();
  const { showToast, getCurrentSessionEpoch } = useSession();
  const [preferences, setPreferences] = useState<ViKashPreferences>({ automaticSend: false, choices: null });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [authorization, setAuthorization] = useState<{ authorizationUrl: string; returnUrl: string } | null>(null);
  const initialized = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (status?.connectionId && initialized.current !== status.connectionId) {
      initialized.current = status.connectionId;
      setPreferences(status.preferences ?? { automaticSend: false, choices: null });
    }
  }, [status]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    const epoch = getCurrentSessionEpoch();
    busyRef.current = true; setBusy(true); setNotice(null);
    try { await action(); }
    catch (err) { if (mounted.current && epoch === getCurrentSessionEpoch()) setNotice(err instanceof ApiError ? err.message : 'Não foi possível concluir. Suas escolhas foram mantidas.'); }
    finally { busyRef.current = false; if (mounted.current && epoch === getCurrentSessionEpoch()) setBusy(false); }
  };
  const connect = () => void run(async () => {
    const epoch = getCurrentSessionEpoch();
    const next = await startViKashAuthorization(Platform.OS === 'web' ? 'web' : 'native');
    if (!mounted.current || epoch !== getCurrentSessionEpoch()) return;
    const url = new URL(next.authorizationUrl);
    if (url.pathname !== '/oauth2/authorize' || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
      throw new Error('Destino de autorização inválido.');
    }
    setAuthorization(next);
  });
  const continueAuthorization = () => void run(async () => {
    if (!authorization) return;
    const epoch = getCurrentSessionEpoch();
    try { await WebBrowser.openAuthSessionAsync(authorization.authorizationUrl, authorization.returnUrl); }
    finally {
      if (epoch === getCurrentSessionEpoch()) {
        await cancelViKashAuthorization();
        if (mounted.current) { setAuthorization(null); await reload(); }
      }
    }
  });
  const connected = status?.status === 'CONNECTED';
  const title = loading && !status ? 'Verificando conexão' : error && !status ? 'Indisponível'
    : status?.status === 'NOT_CONFIGURED' ? 'Ainda não disponível' : connected ? 'Conectado'
      : status?.status === 'EXPIRED' ? 'Conexão expirada' : status?.status === 'CONNECTING' ? 'Autorização em andamento' : 'Desconectado';
  return <View style={styles.stack} testID="vikash-settings">
    <Text style={[styles.title, { color: colors.textPrimary }]}>Integração ViKash</Text>
    <Text style={[styles.body, { color: colors.textSecondary }]}>Preferências para seus abastecimentos</Text>
    <View style={[styles.card, { backgroundColor: connected ? colors.successSoft : colors.bgElevated, borderColor: connected ? colors.successBorder : colors.borderDefault }]}>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>ViKash</Text>
      <Text accessibilityLiveRegion="polite" style={[styles.strong, { color: connected ? colors.successText : colors.textPrimary }]}>{title}</Text>
      {connected ? <Text style={[styles.body, { color: colors.textSecondary }]}>Conta autorizada no ViKash. Pode ser diferente da sua conta FuelLog.</Text>
        : <Text style={[styles.body, { color: colors.textSecondary }]}>{status?.status === 'NOT_CONFIGURED'
          ? 'A conexão será liberada quando estiver disponível. Continue registrando seus abastecimentos normalmente.'
          : 'Autorize o FuelLog na página do ViKash. Sua senha fica no ViKash.'}</Text>}
      {loading ? <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Verificando ViKash" /> : null}
    </View>
    {error || notice ? <InlineNotice tone="warning" message={notice ?? error!} /> : null}
    {error ? <PrimaryButton label="Verificar conexão" onPress={() => void reload()} variant="secondary" disabled={busy || loading} /> : null}
    {connected ? <>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Padrões de envio</Text>
      {catalog ? <ViKashFields catalog={catalog} value={preferences.choices} onChange={choices => setPreferences(p => ({ ...p, choices }))} disabled={busy} /> : null}
      <View style={[styles.card, styles.row, { borderColor: colors.borderDefault, backgroundColor: colors.bgElevated }]}>
        <View style={styles.textColumn}>
          <Text style={[styles.strong, { color: colors.textPrimary }]}>Envio automático</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>Ao salvar, envie o abastecimento ao ViKash. Você pode ajustar ou desativar antes de salvar.</Text>
        </View>
        <Switch accessibilityLabel="Envio automático ao ViKash" value={preferences.automaticSend} disabled={busy}
          onValueChange={automaticSend => setPreferences(p => ({ ...p, automaticSend }))} trackColor={{ false: colors.borderStrong, true: colors.brandPrimary }} thumbColor={colors.surface} />
      </View>
      <PrimaryButton label="Salvar preferências" loading={busy} disabled={!catalog || loading} onPress={() => {
        const validation = preferences.automaticSend || preferences.choices ? choicesError(preferences.choices, catalog) : null;
        if (validation) { setNotice(validation); return; }
        void run(async () => {
          const epoch = getCurrentSessionEpoch();
          await saveViKashPreferences(preferences);
          if (mounted.current && epoch === getCurrentSessionEpoch()) showToast({ tone: 'success', title: 'Preferências salvas', subtitle: 'Abastecimentos anteriores mantêm suas escolhas.' });
        });
      }} />
    </> : status?.configured ? authorization ? <>
      <Text style={[styles.body, { color: colors.textSecondary }]}>A autorização está pronta. Continue no navegador para escolher sua conta e confirmar as permissões.</Text>
      <PrimaryButton label="Continuar ao ViKash" onPress={continueAuthorization} loading={busy} />
      <PrimaryButton label="Cancelar conexão" variant="ghost" disabled={busy} onPress={() => void run(async () => { await cancelViKashAuthorization(); setAuthorization(null); await reload(); })} />
    </> : <PrimaryButton label={status.status === 'EXPIRED' ? 'Conectar novamente ao ViKash' : 'Conectar ao ViKash'} onPress={connect} loading={busy} disabled={loading} /> : null}
    {status?.connectionId ? <PrimaryButton label="Desconectar conta" variant="ghost" onPress={() => setDisconnectOpen(true)} disabled={busy} /> : null}
    <ViKashDeletions />
    <AppSheet visible={disconnectOpen} modal title="Desconectar ViKash?" onClose={() => !busy && setDisconnectOpen(false)}>
      <Text style={[styles.body, { color: colors.textSecondary }]}>Novos envios e tentativas pendentes serão interrompidos. Lançamentos já enviados permanecem no ViKash.</Text>
      <PrimaryButton label="Manter conexão" variant="secondary" disabled={busy} onPress={() => setDisconnectOpen(false)} />
      <PrimaryButton label="Desconectar conta" variant="danger" loading={busy} onPress={() => void run(async () => {
        const epoch = getCurrentSessionEpoch(); const result = await disconnectViKash();
        if (!mounted.current || epoch !== getCurrentSessionEpoch()) return;
        setDisconnectOpen(false); initialized.current = null;
        setPreferences({ automaticSend: false, choices: null }); await reload();
        if (!result.remoteRevoked) setNotice('Envios interrompidos no FuelLog. Não foi possível confirmar a revogação no ViKash. Confira a autorização diretamente no ViKash.');
        else showToast({ tone: 'info', title: 'ViKash desconectado', subtitle: 'Os lançamentos já enviados foram preservados.' });
      })} />
    </AppSheet>
  </View>;
}
const styles = StyleSheet.create({
  stack: { gap: 16 }, title: { ...typography.screenTitle }, sectionTitle: { ...typography.sectionTitle },
  strong: { ...typography.bodyStrong }, body: { ...typography.body },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: 16, gap: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' }, textColumn: { flex: 1, minWidth: 0, gap: 6 },
});
