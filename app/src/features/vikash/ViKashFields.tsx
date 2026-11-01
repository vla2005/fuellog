import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ViKashCatalog, ViKashChoices } from '@/api/types';
import { AppSheet } from '@/components/overlays/AppSheet';
import { ChevronDownIcon } from '@/components/icons/AppIcons';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';
import { changePayment, emptyChoices, PAYMENT_LABELS } from './viKashChoices';
import { viKashColors } from './viKashTheme';

type Field = 'categoryId' | 'paymentMethod' | 'accountId' | 'cardId' | 'installments';
const LABELS: Record<Field, string> = { categoryId: 'Categoria', paymentMethod: 'Pagamento', accountId: 'Conta ou carteira', cardId: 'Cartão', installments: 'Parcelamento' };

export function ViKashFields({ catalog, value, onChange, disabled = false, onBlack = false }: {
  catalog: ViKashCatalog; value: ViKashChoices | null; onChange: (choices: ViKashChoices) => void; disabled?: boolean; onBlack?: boolean;
}) {
  const { colors } = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [field, setField] = useState<Field | null>(null);
  const [focused, setFocused] = useState<Field | null>(null);
  const choices = value ?? emptyChoices(catalog);
  const credit = choices.paymentMethod === 'CREDIT_CARD';
  const options: Record<Field, { id: string; label: string }[]> = {
    categoryId: catalog.categories.map(c => ({ id: c.id, label: c.name })),
    paymentMethod: catalog.paymentMethods.map(p => ({ id: p, label: PAYMENT_LABELS[p] ?? p })),
    accountId: catalog.accounts.map(a => ({ id: a.uuid, label: a.description })),
    cardId: catalog.cards.map(c => ({ id: c.uuid, label: c.description })),
    installments: Array.from({ length: catalog.installments.max - catalog.installments.min + 1 }, (_, i) => {
      const count = catalog.installments.min + i;
      return { id: String(count), label: `${count}x` };
    }),
  };
  const fields: Field[] = ['categoryId', 'paymentMethod', ...(credit ? ['cardId', 'installments'] as Field[] : choices.paymentMethod ? ['accountId'] as Field[] : [])];
  const twoColumns = width >= 320 && fontScale <= 1.15;
  return <View testID="vikash-fields" onLayout={event => setWidth(event.nativeEvent.layout.width)} style={styles.grid}>
    {fields.map(key => {
      const valueText = options[key].find(o => o.id === String(choices[key]))?.label
        ?? (choices[key] && key !== 'installments' ? 'Opção indisponível · escolha outra' : 'Selecionar');
      return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${LABELS[key]}: ${valueText}`}
        accessibilityState={{ disabled, expanded: field === key }} disabled={disabled} testID={`vikash-${key}`}
        onPress={() => setField(key)} onFocus={() => setFocused(key)} onBlur={() => setFocused(null)}
        style={({ pressed }) => [styles.field, { width: twoColumns && key !== 'accountId' ? (width - 10) / 2 : width || '100%',
          backgroundColor: onBlack ? viKashColors.surface : colors.bgElevated,
          borderColor: focused === key ? viKashColors.amber : onBlack ? viKashColors.divider : colors.borderDefault,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}>
        <View style={styles.text}>
          <Text style={[typography.caption, { color: onBlack ? viKashColors.secondary : colors.textSecondary }]}>{LABELS[key]}</Text>
          <Text style={[typography.bodyStrong, { color: onBlack ? viKashColors.text : colors.textPrimary }]}>{valueText}</Text>
        </View>
        <ChevronDownIcon color={viKashColors.amber} size={18} />
      </Pressable>;
    })}
    <AppSheet visible={field !== null && !disabled} modal title={field ? LABELS[field] : ''} onClose={() => setField(null)}>
      {field && options[field].length === 0 ? <Text style={{ color: colors.textSecondary }}>Nenhuma opção disponível no ViKash.</Text> : null}
      {field ? options[field].map(option => <Pressable key={option.id} accessibilityRole="radio"
        accessibilityLabel={option.label} accessibilityState={{ checked: String(choices[field]) === option.id }}
        onPress={() => {
          onChange(field === 'paymentMethod' ? changePayment(choices, option.id, catalog)
            : { ...choices, [field]: field === 'installments' ? Number(option.id) : option.id });
          setField(null);
        }} style={({ pressed }) => [styles.option, { borderColor: String(choices[field]) === option.id ? viKashColors.amber : colors.borderDefault,
          backgroundColor: String(choices[field]) === option.id ? viKashColors.selected : viKashColors.background, opacity: pressed ? 0.8 : 1 }]}>
        <Text style={[styles.optionText, { color: viKashColors.text }]}>{option.label}</Text>
      </Pressable>) : null}
    </AppSheet>
  </View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { minHeight: 70, borderWidth: 1, borderRadius: radii.md, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { flex: 1, minWidth: 0, gap: 4 },
  option: { minHeight: 48, padding: 14, borderWidth: 1, borderRadius: radii.md },
  optionText: { ...typography.bodyStrong, flexShrink: 1 },
});
