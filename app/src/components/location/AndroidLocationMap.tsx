import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';

import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';
import {
  buildOsmFullMapUrl,
  DEFAULT_MAP_ZOOM,
  formatCoordinatesBR,
  getVisibleTiles,
  isValidCoordinate,
  isWithinMercatorBounds,
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  normalizeCoordinate,
  OSM_ATTRIBUTION,
  OSM_COPYRIGHT_URL,
  OSM_USER_AGENT,
} from '@/utils/location';

export interface AndroidLocationMapProps {
  latitude: number;
  longitude: number;
  onMapError?: (error: Error) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  initialZoom?: number;
}

export function AndroidLocationMap({
  latitude,
  longitude,
  onMapError,
  style,
  testID = 'android-location-map',
  initialZoom = DEFAULT_MAP_ZOOM,
}: AndroidLocationMapProps) {
  const { colors, isDark } = useAppTheme();
  const [zoom, setZoom] = useState(initialZoom);
  const [dimensions, setDimensions] = useState({ width: 300, height: 300 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  const isValid = isValidCoordinate(latitude, longitude);
  const inMercator = isValid && isWithinMercatorBounds(latitude);

  // Identidade síncrona do lote atual
  const batchKey = useMemo(() => {
    if (!isValid || !inMercator) return 'invalid';
    const normLat = normalizeCoordinate(latitude);
    const normLon = normalizeCoordinate(longitude);
    const w = Math.round(dimensions.width);
    const h = Math.round(dimensions.height);
    return `${normLat}:${normLon}:${zoom}:${w}x${h}:${retryAttempt}`;
  }, [latitude, longitude, zoom, dimensions.width, dimensions.height, retryAttempt, isValid, inMercator]);

  const activeBatchRef = useRef(batchKey);
  activeBatchRef.current = batchKey;

  const unmountedRef = useRef(false);
  const loadedTilesRef = useRef<Set<string>>(new Set());
  const errorNotifiedRef = useRef(false);

  const tiles = useMemo(() => {
    if (!isValid || !inMercator) return [];
    return getVisibleTiles(latitude, longitude, zoom, dimensions.width, dimensions.height);
  }, [latitude, longitude, zoom, dimensions.width, dimensions.height, isValid, inMercator]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    if (!isValid || !inMercator) {
      setLoading(false);
      return;
    }

    loadedTilesRef.current.clear();
    errorNotifiedRef.current = false;
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      if (
        !unmountedRef.current &&
        activeBatchRef.current === batchKey &&
        !loadedTilesRef.current.has('__all_loaded__')
      ) {
        setLoading(false);
        setError('tempo esgotado');
        if (!errorNotifiedRef.current) {
          errorNotifiedRef.current = true;
          onMapError?.(new Error('Tempo limite para carregamento dos blocos do mapa excedido.'));
        }
      }
    }, 10000);

    return () => {
      clearTimeout(timer);
    };
  }, [batchKey, isValid, inMercator, onMapError]);

  const handleTileLoad = (tileKey: string, currentBatch: string) => {
    if (unmountedRef.current || activeBatchRef.current !== currentBatch) return;
    if (loadedTilesRef.current.has(tileKey)) return;
    loadedTilesRef.current.add(tileKey);

    const allDone = tiles.length > 0 && tiles.every((t) => loadedTilesRef.current.has(t.key));
    if (allDone) {
      loadedTilesRef.current.add('__all_loaded__');
      setLoading(false);
      setError(null);
    }
  };

  const handleTileError = (currentBatch: string, syntheticEvent?: any) => {
    if (unmountedRef.current || activeBatchRef.current !== currentBatch) return;
    setLoading(false);
    const errString = String(syntheticEvent?.error || syntheticEvent?.nativeEvent?.error || '');
    const is403 = errString.includes('403') || errString.toLowerCase().includes('blocked');
    const label = is403 ? 'política de uso de mapa (HTTP 403)' : 'falha ao carregar blocos do mapa';
    setError(label);
    if (!errorNotifiedRef.current) {
      errorNotifiedRef.current = true;
      onMapError?.(new Error(`Falha ao carregar blocos do mapa OpenStreetMap: ${label}`));
    }
  };

  const handleRetry = () => {
    setRetryAttempt((a) => a + 1);
  };

  const handleZoomIn = () => {
    setZoom((z) => Math.min(MAX_MAP_ZOOM, z + 1));
  };

  const handleZoomOut = () => {
    setZoom((z) => Math.max(MIN_MAP_ZOOM, z - 1));
  };

  const handleOpenFullMap = () => {
    const url = buildOsmFullMapUrl(latitude, longitude, zoom);
    void Linking.openURL(url).catch(() => {});
  };

  const handleOpenAttribution = () => {
    void Linking.openURL(OSM_COPYRIGHT_URL).catch(() => {});
  };

  if (!isValid) {
    return (
      <View
        testID={testID}
        style={[
          styles.container,
          styles.squareBox,
          { backgroundColor: colors.bgElevated, borderColor: colors.borderDefault },
          style,
        ]}
      >
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          Coordenadas indisponíveis ou fora do padrão WGS84 para exibição no mapa.
        </Text>
      </View>
    );
  }

  if (!inMercator) {
    return (
      <View
        testID={testID}
        style={[
          styles.container,
          styles.squareBox,
          { backgroundColor: colors.bgElevated, borderColor: colors.borderDefault },
          style,
        ]}
      >
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          Coordenada polar fora da área de projeção do mapa. Localização GPS preservada.
        </Text>
      </View>
    );
  }

  return (
    <View testID={testID} style={[styles.wrapper, style]}>
      <View
        style={[
          styles.squareBox,
          { backgroundColor: colors.bgElevated, borderColor: colors.borderDefault },
        ]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0 && (width !== dimensions.width || height !== dimensions.height)) {
            setDimensions({ width, height });
          }
        }}
      >
        {/* Camada de blocos raster OpenStreetMap com remontagem por lote */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {tiles.map((tile) => (
            <Image
              key={`${batchKey}-${tile.key}`}
              source={{
                uri: tile.url,
                headers: { 'User-Agent': OSM_USER_AGENT },
              }}
              cachePolicy="memory-disk"
              contentFit="cover"
              style={{
                position: 'absolute',
                left: tile.left,
                top: tile.top,
                width: tile.size,
                height: tile.size,
              }}
              onLoad={() => handleTileLoad(tile.key, batchKey)}
              onError={(event: any) => handleTileError(batchKey, event)}
            />
          ))}
        </View>

        {/* Pino indicador posicionado exatamente no centro das coordenadas */}
        <View
          pointerEvents="none"
          style={[
            styles.pinWrapper,
            { left: dimensions.width / 2 - 12, top: dimensions.height / 2 - 28 },
          ]}
        >
          <View style={[styles.pinHead, { backgroundColor: colors.brandPrimary }]}>
            <View style={styles.pinCenterDot} />
          </View>
          <View style={[styles.pinNeedle, { borderTopColor: colors.brandPrimary }]} />
        </View>

        {/* Controles de Zoom acessíveis com área de toque mínima de 44dp */}
        <View style={styles.zoomControls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Aumentar zoom"
            disabled={zoom >= MAX_MAP_ZOOM}
            onPress={handleZoomIn}
            style={[
              styles.zoomBtn,
              { backgroundColor: colors.surface, borderColor: colors.borderDefault },
              zoom >= MAX_MAP_ZOOM && styles.btnDisabled,
            ]}
          >
            <Text style={[styles.zoomBtnText, { color: zoom >= MAX_MAP_ZOOM ? colors.textMuted : colors.textPrimary }]}>+</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Diminuir zoom"
            disabled={zoom <= MIN_MAP_ZOOM}
            onPress={handleZoomOut}
            style={[
              styles.zoomBtn,
              { backgroundColor: colors.surface, borderColor: colors.borderDefault },
              zoom <= MIN_MAP_ZOOM && styles.btnDisabled,
            ]}
          >
            <Text style={[styles.zoomBtnText, { color: zoom <= MIN_MAP_ZOOM ? colors.textMuted : colors.textPrimary }]}>−</Text>
          </Pressable>
        </View>

        {/* Overlay de carregamento */}
        {loading && !error ? (
          <View
            style={[
              styles.overlay,
              { backgroundColor: isDark ? 'rgba(10, 21, 38, 0.85)' : 'rgba(255, 255, 255, 0.85)' },
            ]}
          >
            <ActivityIndicator size="small" color={colors.brandPrimary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Carregando mapa...
            </Text>
          </View>
        ) : null}

        {/* Overlay de erro mantendo tiles montados sob ele */}
        {error ? (
          <View style={[styles.overlay, { backgroundColor: colors.bgElevated, padding: 16 }]}>
            <Text style={[styles.errorTitle, { color: colors.statusDanger }]}>
              Não foi possível carregar o mapa
            </Text>
            <Text style={[styles.errorDiagnostic, { color: colors.textSecondary }]}>
              Motivo: {error}
            </Text>
            <Text style={[styles.errorDescription, { color: colors.textSecondary }]}>
              A coordenada GPS foi capturada e está preservada. Apenas a visualização visual do mapa requer conexão ativa.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tentar carregar o mapa novamente"
              onPress={handleRetry}
              style={[styles.retryBtn, { backgroundColor: colors.surface, borderColor: colors.borderDefault }]}
            >
              <Text style={[styles.retryBtnText, { color: colors.brandPrimary }]}>
                Tentar carregar mapa novamente
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Metadados: coordenadas, botão para mapa completo e atribuição oficial */}
      <View style={styles.metaRow}>
        <View style={styles.coordsBadge}>
          <Text style={[styles.coordsText, { color: colors.textPrimary }]}>
            📍 {formatCoordinatesBR(latitude, longitude)}
          </Text>
        </View>

        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Abrir mapa completo no OpenStreetMap"
          onPress={handleOpenFullMap}
          style={styles.fullMapBtn}
        >
          <Text style={[styles.fullMapText, { color: colors.brandPrimary }]}>
            Mapa completo ↗
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Direitos autorais do OpenStreetMap"
          onPress={handleOpenAttribution}
          style={styles.attributionBtn}
        >
          <Text style={[styles.attributionText, { color: colors.textSecondary }]}>
            {OSM_ATTRIBUTION}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    gap: 8,
    alignItems: 'center',
  },
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  squareBox: {
    width: '100%',
    maxWidth: 300,
    aspectRatio: 1,
    maxHeight: 300,
    alignSelf: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinWrapper: {
    position: 'absolute',
    width: 24,
    height: 28,
    alignItems: 'center',
    zIndex: 5,
  },
  pinHead: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinCenterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  pinNeedle: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: 8,
    borderStyle: 'solid',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  zoomControls: {
    position: 'absolute',
    top: 8,
    right: 8,
    gap: 6,
    zIndex: 6,
  },
  zoomBtn: {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomBtnText: {
    ...typography.bodyStrong,
    fontSize: 20,
    lineHeight: 22,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  loadingText: {
    ...typography.caption,
    fontSize: 12,
  },
  errorTitle: {
    ...typography.cardTitle,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorDiagnostic: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorDescription: {
    ...typography.body,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
  errorText: {
    ...typography.body,
    fontSize: 13,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  retryBtnText: {
    ...typography.bodyStrong,
    fontSize: 13,
  },
  metaRow: {
    width: '100%',
    maxWidth: 300,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 2,
  },
  coordsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  coordsText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  fullMapBtn: {
    paddingVertical: 2,
  },
  fullMapText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
  },
  attributionBtn: {
    paddingVertical: 2,
  },
  attributionText: {
    ...typography.caption,
    fontSize: 11,
    textDecorationLine: 'underline',
  },
});
