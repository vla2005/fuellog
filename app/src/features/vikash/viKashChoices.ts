import { ViKashCatalog, ViKashChoices } from '@/api/types';

export const PAYMENT_LABELS: Record<string, string> = {
  PIX: 'Pix', DEBIT_CARD: 'Débito', CASH: 'Dinheiro', CREDIT_CARD: 'Crédito',
  BANK_TRANSFER: 'Transferência', BANK_SLIP: 'Boleto', OTHER: 'Outro',
};

export function changePayment(choices: ViKashChoices, paymentMethod: string, catalog: ViKashCatalog): ViKashChoices {
  return { ...choices, paymentMethod, accountId: null, cardId: null, installments: catalog.installments.min };
}

export function choicesError(choices: ViKashChoices | null | undefined, catalog: ViKashCatalog | null): string | null {
  if (!catalog) return 'Carregue as opções do ViKash antes de enviar ou desative o envio deste abastecimento.';
  if (!choices || !catalog.categories.some(c => c.id === choices.categoryId)) return 'Selecione uma categoria disponível.';
  if (!catalog.paymentMethods.includes(choices.paymentMethod)) return 'Selecione uma forma de pagamento disponível.';
  const credit = choices.paymentMethod === 'CREDIT_CARD';
  if (credit ? !catalog.cards.some(c => c.uuid === choices.cardId) || Boolean(choices.accountId)
    : !catalog.accounts.some(c => c.uuid === choices.accountId) || Boolean(choices.cardId)) {
    return credit ? 'Selecione um cartão disponível.' : 'Selecione uma conta ou carteira disponível.';
  }
  if (!Number.isInteger(choices.installments) || choices.installments < catalog.installments.min
    || choices.installments > catalog.installments.max || (!credit && choices.installments !== 1)) return 'Selecione um parcelamento válido.';
  return null;
}

export function emptyChoices(catalog: ViKashCatalog): ViKashChoices {
  return { categoryId: '', paymentMethod: '', accountId: null, cardId: null, installments: catalog.installments.min };
}

export function sameChoices(a: ViKashChoices | null | undefined, b: ViKashChoices | null | undefined): boolean {
  return Boolean(a && b && a.categoryId && a.paymentMethod &&
    a.categoryId === b.categoryId && a.paymentMethod === b.paymentMethod &&
    (a.accountId ?? null) === (b.accountId ?? null) && (a.cardId ?? null) === (b.cardId ?? null) && a.installments === b.installments);
}
