import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const entry = { id: 'entry', vehicleId: 'vehicle', version: 1, paidTotal: '50.00' };

function renderEdit({ initialEntry = entry, user = { id: 'user' }, activeVehicle = { id: 'vehicle' } } = {}) {
  const source = readFileSync(new URL('../src/features/fueling/EditFuelEntryScreen.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const container = ({ children }) => React.createElement('div', null, children);
  const modules = {
    react: React,
    'react-native': { ActivityIndicator: () => React.createElement('span', null, 'spinner'), Text: container, View: container },
    '@/api/endpoints': {}, '@/api/types': {},
    '@/components/feedback/InlineNotice': { InlineNotice: container },
    '@/components/layout/ScreenShell': { ScreenShell: container },
    '@/components/ui/PrimaryButton': { PrimaryButton: ({ label }) => React.createElement('button', null, label) },
    '@/state/SessionContext': { useSession: () => ({ user, activeVehicle }) },
    '@/theme/ThemeProvider': { useAppTheme: () => ({ colors: {} }) },
    '@/utils/decimal': {},
    './FuelEntryForm': { FuelEntryForm: ({ edit }) => React.createElement('input', { 'aria-label': 'Valor pago', defaultValue: edit.entry.paidTotal }) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
    return modules[name];
  }, module, module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.EditFuelEntryScreen, { entryId: entry.id, initialEntry }));
}

test('cached edit entry renders the populated form on its first render, before effects', () => {
  const html = renderEdit();
  assert.match(html, /value="50.00"/);
  assert.doesNotMatch(html, /Carregando|spinner/);
});

test('missing or mismatched entries still render real loading, never another vehicle record', () => {
  for (const options of [
    { initialEntry: null },
    { initialEntry: { ...entry, id: 'other' } },
    { initialEntry: { ...entry, vehicleId: 'other' } },
    { user: null },
    { activeVehicle: null },
  ]) {
    const html = renderEdit(options);
    assert.match(html, /Carregando/);
    assert.doesNotMatch(html, /value="50.00"/);
  }
});
