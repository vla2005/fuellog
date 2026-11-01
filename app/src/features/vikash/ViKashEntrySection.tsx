import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ViKashCatalog, ViKashSelection, ViKashStatus } from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { ViKashFields } from './ViKashFields';
import { ChevronDownIcon } from '@/components/icons/AppIcons';
import { ViKashBrand, ViKashState } from './ViKashBrand';
import { ViKashDestination } from './ViKashDestination';
import { choicesError } from './viKashChoices';
import { viKashColors, viKashStyles } from './viKashTheme';
import { ViKashSwitch } from './ViKashSwitch';

export function ViKashEntrySection({ status, catalog, error, value, onChange, disabled, reload }: {
  status: ViKashStatus | null; catalog: ViKashCatalog | null; error: string | null;
  value: ViKashSelection | null; onChange: (value: ViKashSelection) => void; disabled: boolean; reload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  if (status?.status !== 'CONNECTED' && !value?.connectionId) return null;
  const sameConnection = status?.status === 'CONNECTED' && (!value?.connectionId || value.connectionId === status.connectionId);
  const needsChoices = Boolean(catalog && choicesError(value?.choices, catalog));
  const showFields = expanded || needsChoices;
  return <View style={viKashStyles.panel} testID="vikash-entry-section">
    <View style={[viKashStyles.row, styles.between]}>
      <ViKashBrand />
      <ViKashState label={sameConnection ? 'Conectado' : !status && !error ? 'Verificando conexão' : 'Vínculo encerrado ou indisponível'} connected={sameConnection} />
    </View>
    <View style={styles.row}>
      <View style={viKashStyles.column}>
        <Text style={viKashStyles.title}>Enviar ao ViKash</Text>
        <Text style={viKashStyles.caption}>{value?.send ? 'Será enviado ao salvar este abastecimento.' : 'Envio desativado para este abastecimento.'}</Text>
      </View>
      <ViKashSwitch accessibilityLabel="Enviar ao ViKash" value={Boolean(value?.send)}
        disabled={disabled || !sameConnection && !value?.send} onValueChange={send => onChange({ ...value, send, connectionId: value?.connectionId ?? status?.connectionId })} />
    </View>
    {!sameConnection ? <Text style={viKashStyles.body}>O abastecimento pode ser salvo no FuelLog. Não será reenviado por outro vínculo.</Text> :
      !value?.send ? <Text style={viKashStyles.caption}>Envio desativado. Se já enviado, o cancelamento será solicitado ao ViKash.</Text> : null}
    {value?.send ? <View style={[viKashStyles.divider, { gap: 12 }]}>
      <View style={[viKashStyles.row, styles.between, width < 360 || fontScale > 1.15 ? styles.stackedDestination : null]}>
        <ViKashDestination catalog={catalog} choices={value.choices} onBlack />
        {sameConnection && catalog && !needsChoices ? <Pressable accessibilityRole="button"
          accessibilityLabel={expanded ? 'Recolher escolhas ViKash' : 'Ajustar destino ViKash'} accessibilityState={{ expanded, disabled }}
          disabled={disabled} onPress={() => setExpanded(open => !open)} testID="vikash-adjust"
          style={({ pressed }) => [styles.adjust, { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}>
          <Text style={[viKashStyles.strong, { color: viKashColors.amber }]}>{expanded ? 'Recolher' : 'Ajustar'}</Text>
          <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}><ChevronDownIcon color={viKashColors.amber} /></View>
        </Pressable> : null}
      </View>
      {sameConnection && needsChoices ? <Text style={[viKashStyles.caption, { color: viKashColors.amber }]}>Complete ou corrija as escolhas abaixo para enviar.</Text> : null}
      {sameConnection && showFields && catalog ? <ViKashFields catalog={catalog} value={value.choices ?? null} disabled={disabled} onBlack
        onChange={choices => { setExpanded(true); onChange({ ...value, choices }); }} /> : null}
    </View> : null}
    {sameConnection && error ? <InlineNotice tone="warning" message={error} action={<PrimaryButton label="Carregar opções ViKash" variant="secondary" onPress={reload} disabled={disabled} />} /> : null}
    {sameConnection && value?.send && !catalog && value.choices ? <Text style={viKashStyles.caption}>As escolhas já salvas serão mantidas. Você pode salvar o abastecimento com envio pendente.</Text> : null}
    <Text style={[viKashStyles.caption, viKashStyles.divider]}>Somente o valor pago. GPS não é enviado.</Text>
  </View>;
}
const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stackedDestination: { flexDirection: 'column', alignItems: 'stretch' },
  adjust: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, alignSelf: 'flex-end' },
});
