export interface Coordinates {
  latitude: number;
  longitude: number;
}

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
export const OSM_EMBED_ORIGIN = 'https://www.openstreetmap.org';
export const OSM_EMBED_PATH = '/export/embed.html';
export const OSM_TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_USER_AGENT = 'FuelLog/1.0 (+https://github.com/vla2005/fuellog)';

export const MAX_MERCATOR_LAT = 85.0511287798066;
export const MIN_MERCATOR_LAT = -85.0511287798066;
export const DEFAULT_MAP_ZOOM = 16;
export const MIN_MAP_ZOOM = 12;
export const MAX_MAP_ZOOM = 18;
export const TILE_SIZE = 256;

export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return false;
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }
  if (latitude < -90 || latitude > 90) {
    return false;
  }
  if (longitude < -180 || longitude > 180) {
    return false;
  }
  return true;
}

export function isWithinMercatorBounds(latitude: number): boolean {
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) {
    return false;
  }
  return latitude >= MIN_MERCATOR_LAT && latitude <= MAX_MERCATOR_LAT;
}

export function normalizeCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Coordenada deve ser um número finito');
  }
  const fixed = Number(value.toFixed(7));
  return Object.is(fixed, -0) ? 0 : fixed;
}

export function buildOsmEmbedUrl(latitude: number, longitude: number): string {
  if (!isValidCoordinate(latitude, longitude)) {
    throw new Error('Coordenadas inválidas para mapa WGS84');
  }

  const lat = normalizeCoordinate(latitude);
  const lon = normalizeCoordinate(longitude);

  const delta = 0.005;
  const minLon = Math.max(-180, Number((lon - delta).toFixed(7)));
  const minLat = Math.max(-90, Number((lat - delta).toFixed(7)));
  const maxLon = Math.min(180, Number((lon + delta).toFixed(7)));
  const maxLat = Math.min(90, Number((lat + delta).toFixed(7)));

  return `${OSM_EMBED_ORIGIN}${OSM_EMBED_PATH}?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${lat}%2C${lon}`;
}

export function isAllowedMapUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.origin === OSM_EMBED_ORIGIN &&
      parsed.pathname === OSM_EMBED_PATH
    );
  } catch {
    return false;
  }
}

export function formatCoordinatesBR(latitude: number, longitude: number): string {
  if (!isValidCoordinate(latitude, longitude)) {
    return 'Coordenadas indisponíveis';
  }
  const normLat = normalizeCoordinate(latitude);
  const normLon = normalizeCoordinate(longitude);
  return `${normLat.toFixed(7)}, ${normLon.toFixed(7)}`;
}

export function latLonToWorldPixels(
  latitude: number,
  longitude: number,
  zoom: number,
  tileSize = TILE_SIZE,
): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = ((longitude + 180) / 360) * n * tileSize;
  const clampedLat = Math.max(MIN_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, latitude));
  const latRad = (clampedLat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / Math.PI) / 2) * n * tileSize;
  return { x, y };
}

export function wrapTileX(tileX: number, zoom: number): number {
  const n = Math.pow(2, zoom);
  return ((tileX % n) + n) % n;
}

export function getOsmTileUrl(zoom: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

export function buildOsmFullMapUrl(latitude: number, longitude: number, zoom = DEFAULT_MAP_ZOOM): string {
  if (!isValidCoordinate(latitude, longitude)) {
    return 'https://www.openstreetmap.org';
  }
  const lat = normalizeCoordinate(latitude);
  const lon = normalizeCoordinate(longitude);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

export interface VisibleTile {
  key: string;
  url: string;
  left: number;
  top: number;
  size: number;
  tileX: number;
  tileY: number;
  wrappedX: number;
}

export function getVisibleTiles(
  centerLat: number,
  centerLon: number,
  zoom: number,
  viewWidth: number,
  viewHeight: number,
  tileSize = TILE_SIZE,
): VisibleTile[] {
  if (
    tileSize !== TILE_SIZE ||
    !isValidCoordinate(centerLat, centerLon) ||
    !isWithinMercatorBounds(centerLat) ||
    !Number.isInteger(zoom) ||
    zoom < 0 ||
    zoom > 19 ||
    !Number.isFinite(viewWidth) ||
    !Number.isFinite(viewHeight) ||
    viewWidth <= 0 ||
    viewWidth > 300 ||
    viewHeight <= 0 ||
    viewHeight > 300
  ) {
    return [];
  }

  const { x: centerX, y: centerY } = latLonToWorldPixels(centerLat, centerLon, zoom, tileSize);
  const minPxX = centerX - viewWidth / 2;
  const maxPxX = centerX + viewWidth / 2;
  const minPxY = centerY - viewHeight / 2;
  const maxPxY = centerY + viewHeight / 2;

  const minTileX = Math.floor(minPxX / tileSize);
  const maxTileX = Math.ceil(maxPxX / tileSize) - 1;
  const minTileY = Math.floor(minPxY / tileSize);
  const maxTileY = Math.ceil(maxPxY / tileSize) - 1;

  if (maxTileX < minTileX || maxTileY < minTileY) {
    return [];
  }

  const n = Math.pow(2, zoom);
  const tiles: VisibleTile[] = [];

  for (let ty = minTileY; ty <= maxTileY; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      const wrappedX = wrapTileX(tx, zoom);
      const left = tx * tileSize - minPxX;
      const top = ty * tileSize - minPxY;
      tiles.push({
        key: `${zoom}-${wrappedX}-${ty}-${tx}`,
        url: getOsmTileUrl(zoom, wrappedX, ty),
        left,
        top,
        size: tileSize,
        tileX: tx,
        tileY: ty,
        wrappedX,
      });
    }
  }
  return tiles;
}
