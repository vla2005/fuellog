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

export function describeDestination(choices: ViKashChoices | null | undefined, catalog: ViKashCatalog | null) {
  if (!choices) return { title: 'Escolha o destino', detail: 'Categoria, pagamento e conta ou cartão' };
  const credit = choices.paymentMethod === 'CREDIT_CARD';
  const targetId = credit ? choices.cardId : choices.accountId;
  const target = credit ? catalog?.cards.find(c => c.uuid === targetId) : catalog?.accounts.find(a => a.uuid === targetId);
  const kind = credit ? 'Cartão' : 'Conta ou carteira';
  const title = target?.description ?? (!targetId ? `Selecione ${credit ? 'um cartão' : 'uma conta ou carteira'}`
    : catalog ? `${kind} indisponível` : `${kind} ${credit ? 'salvo' : 'salva'} no ViKash`);
  const category = catalog?.categories.find(c => c.id === choices.categoryId)?.name
    ?? (!choices.categoryId ? 'Selecione a categoria' : catalog ? 'Categoria indisponível' : 'Categoria salva no ViKash');
  const payment = PAYMENT_LABELS[choices.paymentMethod] ?? choices.paymentMethod;
  return { title, detail: [payment, credit && choices.installments ? `${choices.installments}x` : null, category].filter(Boolean).join(' · ') };
}
