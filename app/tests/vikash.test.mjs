import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/vikash/viKashChoices.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
new Function('module', 'exports', output)(module, module.exports);
const { changePayment, choicesError, describeDestination } = module.exports;
const catalog = { categories: [{ id: 'default:1' }], accounts: [{ uuid: 'account' }], cards: [{ uuid: 'card' }], paymentMethods: ['PIX', 'CREDIT_CARD'], installments: { min: 1, max: 120, creditOnly: true } };

test('switching payment clears financial targets and resets installments', () => {
  const credit = { categoryId: 'default:1', paymentMethod: 'CREDIT_CARD', cardId: 'card', installments: 5 };
  assert.equal(choicesError(credit, catalog), null);
  const pix = changePayment(credit, 'PIX', catalog);
  assert.deepEqual(pix, { categoryId: 'default:1', paymentMethod: 'PIX', cardId: null, accountId: null, installments: 1 });
  assert.match(choicesError(pix, catalog), /conta/);
  assert.equal(choicesError({ ...pix, accountId: 'account' }, catalog), null);
});

test('archived choices, mixed account/card, missing catalog and invalid installments require correction', () => {
  const pix = { categoryId: 'default:1', paymentMethod: 'PIX', accountId: 'account', installments: 1 };
  assert.match(choicesError(pix, null), /Carregue/);
  assert.match(choicesError({ ...pix, accountId: 'archived' }, catalog), /conta/);
  assert.match(choicesError({ ...pix, cardId: 'card' }, catalog), /conta/);
  assert.match(choicesError({ ...pix, installments: 2 }, catalog), /parcelamento/);
  assert.match(choicesError({ ...pix, categoryId: 'old' }, catalog), /categoria/);
});

test('destination uses catalog names and distinguishes unavailable options from saved choices during an outage', () => {
  const namedCatalog = { ...catalog, categories: [{ id: 'default:1', name: 'Categoria da API' }],
    cards: [{ uuid: 'card', description: 'Cartão da API' }], accounts: [{ uuid: 'account', description: 'Conta da API' }] };
  const credit = { categoryId: 'default:1', paymentMethod: 'CREDIT_CARD', cardId: 'card', installments: 5 };
  assert.deepEqual(describeDestination(credit, namedCatalog), { title: 'Cartão da API', detail: 'Crédito · 5x · Categoria da API' });
  assert.deepEqual(describeDestination({ ...credit, cardId: 'archived' }, namedCatalog), { title: 'Cartão indisponível', detail: 'Crédito · 5x · Categoria da API' });
  assert.deepEqual(describeDestination(credit, null), { title: 'Cartão salvo no ViKash', detail: 'Crédito · 5x · Categoria salva no ViKash' });
  const pix = { ...credit, paymentMethod: 'PIX', cardId: null, accountId: 'account', installments: 1 };
  assert.deepEqual(describeDestination(pix, namedCatalog), { title: 'Conta da API', detail: 'Pix · Categoria da API' });
  assert.equal(describeDestination(null, namedCatalog).title, 'Escolha o destino');
});
