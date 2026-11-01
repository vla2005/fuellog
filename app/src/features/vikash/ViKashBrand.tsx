import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { ViKashStatus } from '@/api/types';
import { typography } from '@/theme/tokens';
import { viKashColors, viKashStyles } from './viKashTheme';

export function ViKashBrand() {
  return <View style={styles.brand}>
    <Image source={require('../../../assets/brand/vikash-app-icon.webp')} style={styles.mark} accessible={false} />
    <Text style={styles.name}>ViKash</Text>
  </View>;
}

export function viKashConnectionLabel(status: ViKashStatus | null, loading: boolean, error: string | null) {
  if (loading && !status) return 'Verificando conexão';
  if (error && !status) return 'Indisponível';
  return ({ CONNECTED: 'Conectado', EXPIRED: 'Conexão expirada', CONNECTING: 'Autorização em andamento',
    NOT_CONFIGURED: 'Ainda não disponível', DISCONNECTED: 'Desconectado' })[status?.status ?? 'DISCONNECTED'];
}

export function ViKashState({ label, connected = false }: { label: string; connected?: boolean }) {
  return <View style={styles.state}>
    {connected ? <View style={styles.dot} accessibilityElementsHidden importantForAccessibility="no" /> : null}
    <Text accessibilityLiveRegion="polite" style={[viKashStyles.caption, { color: connected ? viKashColors.success : viKashColors.amber, flexShrink: 1 }]}>{label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  mark: { width: 44, height: 44, resizeMode: 'contain' },
  name: { ...typography.sectionTitle, fontSize: 24, lineHeight: 32, color: viKashColors.text, flexShrink: 1 },
  state: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: viKashColors.success },
});
