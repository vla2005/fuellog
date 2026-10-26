import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadUtility(name) {
  const module = { exports: {} };
  const output = ts.transpileModule(
    readFileSync(new URL(`../src/utils/${name}.ts`, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  new Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

const location = loadUtility('location');

test('validação de coordenadas WGS84: limites, finitude e tipos', () => {
  // Coordenadas válidas
  assert.equal(location.isValidCoordinate(0, 0), true, 'Zero é válido');
  assert.equal(location.isValidCoordinate(-23.55052, -46.633308), true, 'São Paulo é válido');
  assert.equal(location.isValidCoordinate(90, 180), true, 'Limites superiores inclusivos');
  assert.equal(location.isValidCoordinate(-90, -180), true, 'Limites inferiores inclusivos');

  // Coordenadas inválidas
  assert.equal(location.isValidCoordinate(90.000001, 0), false, 'Latitude > 90');
  assert.equal(location.isValidCoordinate(-90.000001, 0), false, 'Latitude < -90');
  assert.equal(location.isValidCoordinate(0, 180.000001), false, 'Longitude > 180');
  assert.equal(location.isValidCoordinate(0, -180.000001), false, 'Longitude < -180');
  assert.equal(location.isValidCoordinate(NaN, 0), false, 'NaN é rejeitado');
  assert.equal(location.isValidCoordinate(0, Infinity), false, 'Infinidade é rejeitada');
  assert.equal(location.isValidCoordinate('0', 0), false, 'String numérica é rejeitada');
  assert.equal(location.isValidCoordinate(null, 0), false, 'Null é rejeitado');
  assert.equal(location.isValidCoordinate(undefined, 0), false, 'Undefined é rejeitado');
});

test('normalização de coordenadas: precisão máxima de 7 casas e zero negativo', () => {
  assert.equal(location.normalizeCoordinate(-23.55052001), -23.55052);
  assert.equal(location.normalizeCoordinate(0), 0);
  assert.equal(Object.is(location.normalizeCoordinate(-0), 0), true, 'Zero negativo normalizado para zero');
  assert.equal(location.normalizeCoordinate(45.12345678), 45.1234568);
});

test('construção de URL embed OpenStreetMap: allowlist HTTPS, apenas números e sem segredos', () => {
  const url = location.buildOsmEmbedUrl(-23.55052, -46.633308);
  assert.ok(url.startsWith('https://www.openstreetmap.org/export/embed.html'), 'Origem e caminho autorizados');
  assert.equal(location.isAllowedMapUrl(url), true, 'Validado por isAllowedMapUrl');
  assert.ok(url.includes('layer=mapnik'), 'Camada padrão mapnik');
  assert.ok(url.includes('marker=-23.55052%2C-46.633308'), 'Marcador presente nas coordenadas exatas');
  assert.ok(!url.includes('token') && !url.includes('bearer') && !url.includes('password'), 'Sem credenciais');

  // URL arbitrária ou com script deve ser rejeitada pelo allowlist
  assert.equal(location.isAllowedMapUrl('https://malicious.site/embed.html'), false);
  assert.equal(location.isAllowedMapUrl('javascript:alert(1)'), false);
  assert.equal(location.isAllowedMapUrl('http://www.openstreetmap.org/export/embed.html'), false, 'HTTP não seguro rejeitado');
});

test('atribuição obrigatória OSM e formato de exibição', () => {
  assert.equal(location.OSM_ATTRIBUTION, '© OpenStreetMap contributors');
  assert.equal(location.OSM_COPYRIGHT_URL, 'https://www.openstreetmap.org/copyright');
  const formatted = location.formatCoordinatesBR(-23.55052, -46.633308);
  assert.equal(formatted, '-23.5505200, -46.6333080');
});
