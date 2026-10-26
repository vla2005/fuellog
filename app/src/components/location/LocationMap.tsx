import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';
import {
  buildOsmEmbedUrl,
  formatCoordinatesBR,
  isAllowedMapUrl,
  isValidCoordinate,
  OSM_ATTRIBUTION,
  OSM_COPYRIGHT_URL,
  OSM_EMBED_ORIGIN,
} from '@/utils/location';

export interface LocationMapProps {
  latitude: number;
  longitude: number;
  onMapError?: (error: Error) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// Carrega WebView dinamicamente para plataformas nativas sem quebrar web
let NativeWebView: any = null;
if (Platform.OS !== 'web') {
  try {
    NativeWebView = require('react-native-webview').WebView;
  } catch {
    NativeWebView = null;
  }
}

export function LocationMap({
  latitude,
  longitude,
  onMapError,
  style,
  testID = 'location-map',
}: LocationMapProps) {
  const { colors, isDark } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const isValid = isValidCoordinate(latitude, longitude);
  const mapUrl = isValid ? buildOsmEmbedUrl(latitude, longitude) : null;

  // Timeout cancelável de carregamento do mapa (evita spinner infinito em rede offline no web iframe)
  useEffect(() => {
    if (!isValid || !mapUrl) {
      setLoading(false);
      return;
    }

    if (Platform.OS !== 'web' && !NativeWebView) {
      setLoading(false);
      setMapError(true);
      return;
    }

    setLoading(true);
    setMapError(false);

    const timer = setTimeout(() => {
      setLoading((current) => {
        if (current) {
          setMapError(true);
          onMapError?.(new Error('Tempo limite para carregamento dos blocos do mapa excedido.'));
          return false;
        }
        return false;
      });
    }, 10000);

    return () => {
      clearTimeout(timer);
    };
  }, [latitude, longitude, mapUrl, onMapError, reloadKey, isValid]);

  const handleRetry = () => {
    setMapError(false);
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  const handleOpenAttribution = () => {
    void Linking.openURL(OSM_COPYRIGHT_URL).catch(() => {});
  };

  if (!isValid || !mapUrl) {
    return (
      <View
        testID={testID}
        style={[
          styles.container,
          styles.squareBox,
          {
            backgroundColor: colors.bgElevated,
            borderColor: colors.borderDefault,
          },
          style,
        ]}
      >
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          Coordenadas indisponíveis ou fora do padrão WGS84 para exibição no mapa.
        </Text>
      </View>
    );
  }

  return (
    <View testID={testID} style={[styles.wrapper, style]}>
      {/* Moldura estritamente quadrada do mapa (maxWidth e maxHeight iguais com aspectRatio 1) */}
      <View
        style={[
          styles.squareBox,
          {
            backgroundColor: colors.bgElevated,
            borderColor: colors.borderDefault,
          },
        ]}
      >
        {Platform.OS === 'web' ? (
          <iframe
            key={`osm-iframe-${reloadKey}`}
            src={mapUrl}
            title="Mapa de localização OpenStreetMap"
            style={{
              width: '100%',
              height: '100%',
              border: 0,
              display: mapError ? 'none' : 'block',
            }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            sandbox="allow-scripts allow-same-origin"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setMapError(true);
              onMapError?.(new Error('Falha ao carregar iframe OpenStreetMap'));
            }}
          />
        ) : NativeWebView ? (
          <NativeWebView
            key={`osm-wv-${reloadKey}`}
            source={{ uri: mapUrl }}
            style={{ flex: 1, display: mapError ? 'none' : 'flex' }}
            onShouldStartLoadWithRequest={(request: { url: string }) => {
              return isAllowedMapUrl(request.url);
            }}
            originWhitelist={[OSM_EMBED_ORIGIN]}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={(syntheticEvent: any) => {
              setLoading(false);
              setMapError(true);
              onMapError?.(
                new Error(
                  syntheticEvent?.nativeEvent?.description ||
                    'Falha ao carregar WebView do mapa',
                ),
              );
            }}
          />
        ) : (
          <View style={styles.fallbackBox}>
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>
              Visualização de mapa não suportada nesta plataforma.
            </Text>
          </View>
        )}

        {/* Indicador de carregamento */}
        {loading && !mapError ? (
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

        {/* Estado de erro do mapa (sem invalidar o GPS capturado) */}
        {mapError ? (
          <View
            style={[
              styles.overlay,
              { backgroundColor: colors.bgElevated, padding: 16 },
            ]}
          >
            <Text style={[styles.errorTitle, { color: colors.statusDanger }]}>
              Não foi possível carregar o mapa
            </Text>
            <Text style={[styles.errorDescription, { color: colors.textSecondary }]}>
              A coordenada GPS foi capturada e está pronta para ser salva. Apenas a visualização visual do mapa requer conexão ativa.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tentar carregar o mapa novamente"
              onPress={handleRetry}
              style={[
                styles.retryBtn,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderDefault,
                },
              ]}
            >
              <Text style={[styles.retryBtnText, { color: colors.brandPrimary }]}>
                Tentar carregar mapa novamente
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Informações de coordenadas e atribuição oficial OSM */}
      <View style={styles.metaRow}>
        <View style={styles.coordsBadge}>
          <Text style={[styles.coordsText, { color: colors.textPrimary }]}>
            📍 {formatCoordinatesBR(latitude, longitude)}
          </Text>
        </View>

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
  fallbackBox: {
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
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
  attributionBtn: {
    paddingVertical: 2,
  },
  attributionText: {
    ...typography.caption,
    fontSize: 11,
    textDecorationLine: 'underline',
  },
});
