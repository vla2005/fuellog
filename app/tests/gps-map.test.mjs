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

test('tiles nativos centralizam o exemplo Hachiko publicado pelo OpenStreetMap', () => {
  // Referência independente: wiki.openstreetmap.org/wiki/Slippy_map_tilenames, exemplo zoom 18.
  const tiles = location.getVisibleTiles(35.6590699, 139.7006793, 18, 300, 300);
  const center = tiles.find(tile => tile.left <= 150 && tile.left + tile.size > 150
    && tile.top <= 150 && tile.top + tile.size > 150);
  assert.ok(center);
  assert.equal(center.url, 'https://tile.openstreetmap.org/18/232798/103246.png');
});

test('tiles nativos cobrem apenas a moldura visível, sem lacunas ou tiles adicionais na borda', () => {
  for (const [lat, lon, zoom, width, height] of [[0, 0, 12, 300, 300], [-23.55052, -46.633308, 16, 280, 280],
    [35.6590699, 139.7006793, 18, 300, 300], [0, 179.9999, 12, 256, 256], [0, 180 / (2 ** 12), 12, 256, 256]]) {
    const tiles = location.getVisibleTiles(lat, lon, zoom, width, height);
    assert.ok(tiles.length > 0 && tiles.length <= 9);
    assert.equal(new Set(tiles.map(tile => tile.key)).size, tiles.length);
    let coveredArea = 0;
    for (const tile of tiles) {
      const clippedWidth = Math.min(width, tile.left + tile.size) - Math.max(0, tile.left);
      const clippedHeight = Math.min(height, tile.top + tile.size) - Math.max(0, tile.top);
      assert.ok(clippedWidth > 0 && clippedHeight > 0, `Sem prefetch fora da moldura: ${tile.url}`);
      assert.equal(tile.size, 256);
      coveredArea += clippedWidth * clippedHeight;
    }
    assert.ok(Math.abs(coveredArea - width * height) < 0.0001, 'Mapa não tem lacunas nem sobreposição');
  }
});

test('antimeridiano mantém os mesmos tiles nas longitudes equivalentes e respeita limites Y', () => {
  const snapshot = lon => location.getVisibleTiles(0, lon, 12, 300, 300)
    .map(tile => [tile.url, tile.left, tile.top]).sort();
  assert.deepEqual(snapshot(180), snapshot(-180));
  for (const lat of [location.MAX_MERCATOR_LAT, location.MIN_MERCATOR_LAT, 0]) {
    for (const tile of location.getVisibleTiles(lat, -180, 12, 300, 300)) {
      const match = /^https:\/\/tile\.openstreetmap\.org\/12\/(\d+)\/(\d+)\.png$/.exec(tile.url);
      assert.ok(match);
      assert.ok(Number(match[1]) >= 0 && Number(match[1]) < 2 ** 12);
      assert.ok(Number(match[2]) >= 0 && Number(match[2]) < 2 ** 12);
    }
  }
});

test('preview nativo rejeita polos fora da projeção e dimensões ou zoom inválidos', () => {
  for (const args of [[90, 0, 16, 300, 300], [-90, 0, 16, 300, 300], [NaN, 0, 16, 300, 300],
    [0, 181, 16, 300, 300], [0, 0, 12.5, 300, 300], [0, 0, 16, 0, 300],
    [0, 0, 16, 300, 0], [0, 0, 16, Infinity, 300], [0, 0, Infinity, 300, 300]]) {
    assert.deepEqual(location.getVisibleTiles(...args), []);
  }
  assert.equal(location.isValidCoordinate(90, 0), true, 'Limite da projeção não invalida o GPS WGS84');
  assert.deepEqual(location.getVisibleTiles(0, 0, 16, 1e20, 1e20), [],
    'Dimensões excessivas não provocam downloads em massa');
  for (const tileSize of [0, Infinity, 128]) {
    assert.deepEqual(location.getVisibleTiles(0, 0, 16, 300, 300, tileSize), []);
  }
});

test('mapa completo aponta para coordenadas originais e cliente dos tiles é identificado', () => {
  const url = new URL(location.buildOsmFullMapUrl(-23.55052, -46.633308, 16));
  assert.equal(url.origin, 'https://www.openstreetmap.org');
  assert.equal(url.searchParams.get('mlat'), '-23.55052');
  assert.equal(url.searchParams.get('mlon'), '-46.633308');
  assert.match(location.OSM_USER_AGENT, /^FuelLog\//);
  assert.doesNotMatch(url.toString(), /token|password|bearer/i);
});
