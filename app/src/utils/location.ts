export interface Coordinates {
  latitude: number;
  longitude: number;
}

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
export const OSM_EMBED_ORIGIN = 'https://www.openstreetmap.org';
export const OSM_EMBED_PATH = '/export/embed.html';

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
