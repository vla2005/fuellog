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
import { AndroidLocationMap } from './AndroidLocationMap';

export { AndroidLocationMap } from './AndroidLocationMap';
export type { AndroidLocationMapProps } from './AndroidLocationMap';

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
    const webViewModule = require('react-native-webview');
    NativeWebView = webViewModule?.WebView || webViewModule?.default || webViewModule;
  } catch {
    NativeWebView = null;
  }
}

export function LocationMap(props: LocationMapProps) {
  if (Platform.OS === 'android') {
    return <AndroidLocationMap {...props} />;
  }
  return <EmbeddedLocationMap {...props} />;
}

export function EmbeddedLocationMap({
  latitude,
  longitude,
  onMapError,
  style,
  testID = 'location-map',
}: LocationMapProps) {
  const { colors, isDark } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const isLoadingRef = useRef(true);
  const fatalErrorRef = useRef(false);
  const errorNotifiedRef = useRef(false);

  const isValid = isValidCoordinate(latitude, longitude);
  const mapUrl = isValid ? buildOsmEmbedUrl(latitude, longitude) : null;

  const notifyMapError = (error: Error) => {
    if (!errorNotifiedRef.current) {
      errorNotifiedRef.current = true;
      onMapError?.(error);
    }
  };

  // Timeout cancelável de carregamento do mapa (evita spinner infinito em rede offline no web iframe)
  useEffect(() => {
    errorNotifiedRef.current = false;
    fatalErrorRef.current = false;

    if (!isValid || !mapUrl) {
      isLoadingRef.current = false;
      setLoading(false);
      return;
    }

    if (Platform.OS !== 'web' && !NativeWebView) {
      fatalErrorRef.current = true;
      isLoadingRef.current = false;
      setLoading(false);
      setMapError('módulo nativo indisponível');
      notifyMapError(new Error('Visualização nativa de mapa não suportada.'));
      return;
    }

    isLoadingRef.current = true;
    setLoading(true);
    setMapError(null);

    const timer = setTimeout(() => {
      if (isLoadingRef.current && !fatalErrorRef.current) {
        setLoading(false);
        setMapError('tempo esgotado');
        notifyMapError(new Error('Tempo limite para carregamento dos blocos do mapa excedido.'));
      }
    }, 10000);

    return () => {
      clearTimeout(timer);
    };
  }, [latitude, longitude, mapUrl, onMapError, reloadKey, isValid]);

  const handleRetry = () => {
    errorNotifiedRef.current = false;
    fatalErrorRef.current = false;
    isLoadingRef.current = true;
    setMapError(null);
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
            }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            sandbox="allow-scripts allow-same-origin"
            onLoad={() => {
              if (!fatalErrorRef.current) {
                isLoadingRef.current = false;
                setLoading(false);
                setMapError(null);
              }
            }}
            onError={() => {
              fatalErrorRef.current = true;
              isLoadingRef.current = false;
              setLoading(false);
              setMapError('falha de conexão web');
              notifyMapError(new Error('Falha ao carregar iframe OpenStreetMap'));
            }}
          />
        ) : NativeWebView ? (
          <NativeWebView
            key={`osm-wv-${reloadKey}`}
            source={{ uri: mapUrl }}
            containerStyle={styles.webViewContainer}
            style={styles.webView}
            onShouldStartLoadWithRequest={(request: { url: string }) => {
              if (request.url === 'about:blank') {
                return true;
              }
              return isAllowedMapUrl(request.url);
            }}
            originWhitelist={[OSM_EMBED_ORIGIN]}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            onLoadStart={() => {
              isLoadingRef.current = true;
              setLoading(true);
            }}
            onLoad={() => {
              if (!fatalErrorRef.current) {
                isLoadingRef.current = false;
                setLoading(false);
                setMapError(null);
              }
            }}
            onLoadEnd={() => {
              isLoadingRef.current = false;
              setLoading(false);
            }}
            onHttpError={(syntheticEvent: any) => {
              const statusCode = syntheticEvent?.nativeEvent?.statusCode;
              fatalErrorRef.current = true;
              isLoadingRef.current = false;
              setLoading(false);
              const label = statusCode ? `HTTP ${statusCode}` : 'erro HTTP';
              setMapError(label);
              notifyMapError(
                new Error(`Falha HTTP ao carregar o mapa (${statusCode || 'desconhecido'})`),
              );
            }}
            onError={(syntheticEvent: any) => {
              const code =
                syntheticEvent?.nativeEvent?.code ??
                syntheticEvent?.nativeEvent?.errorCode;
              fatalErrorRef.current = true;
              isLoadingRef.current = false;
              setLoading(false);
              const label = code !== undefined ? `código ${code}` : 'erro de rede nativo';
              setMapError(label);
              notifyMapError(
                new Error(`Falha ao carregar WebView do mapa: ${label}`),
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
            <Text style={[styles.errorDiagnostic, { color: colors.textSecondary }]}>
              Motivo: {mapError}
            </Text>
            <Text style={[styles.errorDescription, { color: colors.textSecondary }]}>
              A coordenada GPS foi capturada e está preservada. Apenas a visualização visual do mapa requer conexão ativa.
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
  webViewContainer: {
    width: '100%',
    height: '100%',
    flex: 1,
    alignSelf: 'stretch',
  },
  webView: {
    width: '100%',
    height: '100%',
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
  },
  hidden: {
    display: 'none',
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
  attributionBtn: {
    paddingVertical: 2,
  },
  attributionText: {
    ...typography.caption,
    fontSize: 11,
    textDecorationLine: 'underline',
  },
});
