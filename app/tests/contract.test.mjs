import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const schemas = JSON.parse(readFileSync(new URL('../../contracts/openapi.json', import.meta.url), 'utf8')).components.schemas;
const source = ts.createSourceFile('types.ts', readFileSync(new URL('../src/api/types.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const declarations = new Map(source.statements.filter(statement => statement.name).map(statement => [statement.name.text, statement]));

const interfaces = {
  RegisterRequest: 'Register', LoginRequest: 'Login', RefreshRequest: 'Refresh',
  RegisteredUser: 'RegisteredUser', MeResponse: 'Me', TokenResponse: 'TokenResponse',
  CreateVehicleRequest: 'CreateVehicle', Vehicle: 'Vehicle',
  CreateFuelEntryRequest: 'CreateFuelEntry', FuelEntry: 'FuelEntry', FuelEntryPage: 'FuelEntryPage',
  SummaryResponse: 'Summary',
  DashboardResponse: 'Dashboard', DashboardMonth: 'DashboardMonth', DashboardFuel: 'DashboardFuel', DashboardPrice: 'DashboardPrice',
  PasswordChangeRequest: 'PasswordChange',
  TwoFactorStatus: 'TwoFactorStatus',
  TwoFactorSetupRequest: 'TwoFactorSetup',
  TwoFactorSetupResponse: 'TwoFactorSetupResponse',
  TwoFactorEnableRequest: 'TwoFactorEnable',
  TwoFactorRecoveryCodes: 'TwoFactorRecoveryCodes',
  TwoFactorDisableRequest: 'TwoFactorDisable',
  TwoFactorChallenge: 'TwoFactorChallenge',
  TwoFactorVerifyRequest: 'TwoFactorVerify',
  ViKashChoices: 'ViKashChoices', ViKashSelection: 'ViKashSelection', ViKashPreferences: 'ViKashPreferences',
  ViKashStatus: 'ViKashStatus', ViKashCatalog: 'ViKashCatalog', ViKashEntryStatus: 'ViKashEntryStatus',
  ViKashRemoteStatus: 'ViKashRemoteStatus', ViKashDeletions: 'ViKashDeletions',
};

for (const [interfaceName, schemaName] of Object.entries(interfaces)) {
  test(`${interfaceName}: chaves HTTP iguais a ${schemaName} no OpenAPI`, () => {
    const declaration = declarations.get(interfaceName);
    assert.ok(declaration && ts.isInterfaceDeclaration(declaration), `Interface ausente: ${interfaceName}`);
    assert.equal(declaration.heritageClauses?.length ?? 0, 0, 'Comparação exige propriedades HTTP explícitas');
    const keys = declaration.members.map(member => {
      assert.ok(ts.isPropertySignature(member) && member.name, 'Esperada propriedade HTTP');
      return member.name.text;
    });
    assert.deepEqual(keys.sort(), Object.keys(schemas[schemaName].properties).sort());
  });
}

for (const enumName of ['FuelType']) {
  test(`${enumName}: valores iguais ao enum OpenAPI`, () => {
    const declaration = declarations.get(enumName);
    assert.ok(declaration && ts.isTypeAliasDeclaration(declaration), `Tipo ausente: ${enumName}`);
    assert.ok(ts.isUnionTypeNode(declaration.type), 'Esperada união de literais');
    const literals = declaration.type.types.map(type => {
      assert.ok(ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal), 'Esperado literal string');
      return type.literal.text;
    });
    assert.deepEqual(literals.sort(), [...schemas[enumName].enum].sort());
  });
}
