import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ViKashCatalog, ViKashChoices } from '@/api/types';
import { AppSheet } from '@/components/overlays/AppSheet';
import { SelectionRow } from '@/components/ui/SelectionRow';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';
import { changePayment, emptyChoices, PAYMENT_LABELS } from './viKashChoices';

type Field = 'categoryId' | 'paymentMethod' | 'accountId' | 'cardId' | 'installments';
const LABELS: Record<Field, string> = { categoryId: 'Categoria', paymentMethod: 'Pagamento', accountId: 'Conta ou carteira', cardId: 'Cartão', installments: 'Parcelamento' };

export function ViKashFields({ catalog, value, onChange, disabled = false }: {
  catalog: ViKashCatalog; value: ViKashChoices | null; onChange: (choices: ViKashChoices) => void; disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const [field, setField] = useState<Field | null>(null);
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
  return <View style={styles.stack}>
    {fields.map(key => <SelectionRow key={key} label={LABELS[key]} disabled={disabled}
      valueText={options[key].find(o => o.id === String(choices[key]))?.label ?? (choices[key] && key !== 'installments' ? 'Opção indisponível · escolha outra' : 'Selecionar')}
      onPress={() => setField(key)} testID={`vikash-${key}`} />)}
    <AppSheet visible={field !== null && !disabled} modal title={field ? LABELS[field] : ''} onClose={() => setField(null)}>
      {field && options[field].length === 0 ? <Text style={{ color: colors.textSecondary }}>Nenhuma opção disponível no ViKash.</Text> : null}
      {field ? options[field].map(option => <Pressable key={option.id} accessibilityRole="radio"
        accessibilityLabel={option.label} accessibilityState={{ checked: String(choices[field]) === option.id }}
        onPress={() => {
          onChange(field === 'paymentMethod' ? changePayment(choices, option.id, catalog)
            : { ...choices, [field]: field === 'installments' ? Number(option.id) : option.id });
          setField(null);
        }} style={({ pressed }) => [styles.option, { borderColor: colors.borderDefault, backgroundColor: String(choices[field]) === option.id ? colors.accentSoft : colors.bgSecondary, opacity: pressed ? 0.8 : 1 }]}>
        <Text style={[styles.optionText, { color: colors.textPrimary }]}>{option.label}</Text>
      </Pressable>) : null}
    </AppSheet>
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
  option: { minHeight: 48, padding: 14, borderWidth: 1, borderRadius: radii.md },
  optionText: { ...typography.bodyStrong, flexShrink: 1 },
});
