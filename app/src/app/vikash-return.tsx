import React from 'react';
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useAppTheme } from '@/theme/ThemeProvider';

WebBrowser.maybeCompleteAuthSession();

export default function ViKashReturn() {
  const router = useRouter();
  const { colors } = useAppTheme();
  return <ScreenShell><Text style={{ color: colors.textPrimary }}>Autorização encerrada. Confira sua conexão nos ajustes do FuelLog.</Text>
    <PrimaryButton label="Voltar aos ajustes" onPress={() => router.replace('/settings')} /></ScreenShell>;
}
