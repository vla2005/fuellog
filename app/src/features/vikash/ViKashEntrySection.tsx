import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { ViKashCatalog, ViKashSelection, ViKashStatus } from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';
import { ViKashFields } from './ViKashFields';

export function ViKashEntrySection({ status, catalog, error, value, onChange, disabled, reload }: {
  status: ViKashStatus | null; catalog: ViKashCatalog | null; error: string | null;
  value: ViKashSelection | null; onChange: (value: ViKashSelection) => void; disabled: boolean; reload: () => void;
}) {
  const { colors } = useAppTheme();
  if (status?.status !== 'CONNECTED' && !value?.connectionId) return null;
  const sameConnection = status?.status === 'CONNECTED' && (!value?.connectionId || value.connectionId === status.connectionId);
  return <View style={styles.stack} testID="vikash-entry-section">
    <View style={[styles.card, { backgroundColor: sameConnection ? colors.successSoft : colors.warningSoft, borderColor: sameConnection ? colors.successBorder : colors.warningBorder }]}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>ViKash</Text>
          <Text style={[styles.body, { color: sameConnection ? colors.successText : colors.warningText }]}>{sameConnection ? 'Conectado' : 'Vínculo encerrado ou indisponível'}</Text>
        </View>
        <Switch accessibilityLabel="Enviar ao ViKash" value={Boolean(value?.send)}
          disabled={disabled || !sameConnection && !value?.send} onValueChange={send => onChange({ ...value, send, connectionId: value?.connectionId ?? status?.connectionId })}
          trackColor={{ false: colors.borderStrong, true: colors.brandPrimary }} thumbColor={colors.surface} />
      </View>
      <Text style={[styles.body, { color: colors.textSecondary }]}>Usa o valor pago deste abastecimento. GPS não é enviado.</Text>
      {!sameConnection ? <Text style={[styles.body, { color: colors.textSecondary }]}>O abastecimento pode ser salvo no FuelLog. Não será reenviado por outro vínculo.</Text> :
        !value?.send ? <Text style={[styles.body, { color: colors.textSecondary }]}>Envio desativado. Se já enviado, o cancelamento será solicitado ao ViKash.</Text> : null}
    </View>
    {sameConnection && value?.send && catalog ? <ViKashFields catalog={catalog} value={value.choices ?? null} disabled={disabled}
      onChange={choices => onChange({ ...value, choices })} /> : null}
    {sameConnection && error ? <InlineNotice tone="warning" message={error} action={<PrimaryButton label="Carregar opções ViKash" variant="secondary" onPress={reload} disabled={disabled} />} /> : null}
    {sameConnection && value?.send && !catalog && value.choices ? <Text style={[styles.body, { color: colors.textSecondary }]}>As escolhas já salvas serão mantidas. Você pode salvar o abastecimento com envio pendente.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  stack: { gap: 10 }, card: { padding: 16, gap: 10, borderWidth: 1, borderRadius: radii.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, text: { flex: 1, minWidth: 0, gap: 4 },
  title: { ...typography.sectionTitle }, body: { ...typography.caption },
});
