import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function callback(name, scope) {
  const source = readFileSync(new URL('../src/features/settings/TwoFactorSheet.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('TwoFactorSheet.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let arrow;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) arrow = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(arrow);
  const result = ts.transpileModule(`exports.run = ${arrow.getText(file)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function('exports', ...Object.keys(scope), result.outputText)(module.exports, ...Object.values(scope));
  return module.exports.run;
}

for (const mode of ['enable', 'disable']) {
  test(`2FA ${mode} confirmado invalida B sem revogar novamente e preserva resultado`, async () => {
    const calls = [];
    let recovery;
    let screen;
    const run = callback(mode === 'enable' ? 'handleSubmitEnableCode' : 'handleSubmitDisable', {
      totpCode: '123456', currentPassword: 'password', disableWithRecovery: false,
      setErrorMessage: () => {}, setFieldErrors: () => {}, getCurrentSessionEpoch: () => 1,
      flowGenRef: { current: 0 }, isVisibleRef: { current: true }, setSubmitting: () => {},
      enableTwoFactor: async () => ({ recoveryCodes: ['SAVE-ME'] }), disableTwoFactor: async () => {},
      setTotpCode: () => {}, setRecoveryCodes: value => { recovery = value; }, setMode: value => { screen = value; },
      clearSecretsInMemory: () => {}, fetchStatus: async () => {}, showToast: () => {}, ApiError: Error,
      disableBiometricsOnCurrentSession: async alreadyRevoked => { calls.push(alreadyRevoked); throw new Error('local cleanup failed'); },
    });
    await run();
    assert.deepEqual(calls, [true]);
    assert.equal(screen, mode === 'enable' ? 'setup_recovery' : 'status');
    if (mode === 'enable') assert.deepEqual(recovery, ['SAVE-ME']);
  });

  test(`2FA ${mode} não consulta nem avisa outra conta se epoch mudar durante limpeza B`, async () => {
    let epoch = 1;
    let statusCalls = 0;
    let toastCalls = 0;
    const run = callback(mode === 'enable' ? 'handleSubmitEnableCode' : 'handleSubmitDisable', {
      totpCode: '123456', currentPassword: 'password', disableWithRecovery: false,
      setErrorMessage: () => {}, setFieldErrors: () => {}, getCurrentSessionEpoch: () => epoch,
      flowGenRef: { current: 0 }, isVisibleRef: { current: true }, setSubmitting: () => {},
      enableTwoFactor: async () => ({ recoveryCodes: ['SAVE-ME'] }), disableTwoFactor: async () => {},
      setTotpCode: () => {}, setRecoveryCodes: () => {}, setMode: () => {}, clearSecretsInMemory: () => {},
      fetchStatus: async () => { statusCalls++; },
      showToast: () => { toastCalls++; }, ApiError: Error,
      disableBiometricsOnCurrentSession: async () => { epoch++; throw new Error('stale cleanup'); },
    });
    await run();
    assert.equal(statusCalls, 0);
    assert.equal(toastCalls, 0);
  });
}
