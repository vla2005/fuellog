import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts } from 'expo-font';
import {
  Stack,
  usePathname,
  useRootNavigationState,
  useRouter,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrandLockup } from '@/components/brand/BrandLockup';
import { AppToast } from '@/components/feedback/AppToast';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { AuthenticatedTabShell } from '@/components/navigation/AuthenticatedTabShell';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SessionProvider, useSession } from '@/state/SessionContext';
import { AppThemeProvider, useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync().catch(() => {});

function NavigationGuardShell() {
  const router = useRouter();
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const isNavigationReady = Boolean(rootNavigationState?.key);
  const { colors, isDark } = useAppTheme();
  const {
    status,
    bootError,
    retryBootSession,
    signOut,
    toast,
    dismissToast,
  } = useSession();

  const isPublicAuthRoute =
    pathname === '/login' || pathname === '/register';

  useEffect(() => {
    if (!isNavigationReady) {
      return;
    }
    if (status === 'unauthenticated' && !isPublicAuthRoute) {
      router.replace('/login');
    } else if (status === 'authenticated' && isPublicAuthRoute) {
      router.replace('/');
    }
  }, [isNavigationReady, isPublicAuthRoute, router, status]);

  const showBootOverlay = status === 'booting';
  const showConnectionOverlay =
    status === 'connection_error' && !isPublicAuthRoute;
  const showRedirectMask =
    status === 'unauthenticated' && !isPublicAuthRoute;
  const showAuthenticatedShell =
    status === 'authenticated' && !isPublicAuthRoute;

  return (
    <View style={[styles.flex, { backgroundColor: colors.bgPrimary }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppToast toast={toast} onDismiss={dismissToast} />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgPrimary },
          animation: 'none',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="history" />
        <Stack.Screen name="vehicles" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="account" />
        <Stack.Screen name="fueling/new" />
        <Stack.Screen name="fueling/[entryId]" />
      </Stack>

      {showAuthenticatedShell ? <AuthenticatedTabShell /> : null}

      {showBootOverlay ? (
        <View
          style={[
            styles.overlayScreen,
            { backgroundColor: colors.bgPrimary },
          ]}
        >
          <BrandLockup
            mode="auth-login"
            subtitle="Validando sua sessão..."
          />
          <ActivityIndicator
            size="small"
            color={colors.accentPrimary}
            style={styles.spinner}
          />
        </View>
      ) : null}

      {showConnectionOverlay ? (
        <View
          style={[
            styles.overlayScreen,
            { backgroundColor: colors.bgPrimary },
          ]}
        >
          <View
            style={[
              styles.recoveryCard,
              {
                backgroundColor: colors.bgElevated,
                borderColor: colors.borderDefault,
              },
            ]}
          >
            <BrandLockup mode="header" />
            <Text style={[styles.recoveryTitle, { color: colors.textPrimary }]}>
              Servidor temporariamente indisponível
            </Text>
            <InlineNotice
              tone="warning"
              message={
                bootError ??
                'Não foi possível validar sua sessão agora. Sua conta permanece conectada neste dispositivo para você tentar novamente.'
              }
            />
            <PrimaryButton
              label="Tentar conectar novamente"
              onPress={retryBootSession}
            />
            <PrimaryButton
              label="Entrar com outra conta"
              variant="secondary"
              onPress={async () => {
                try {
                  await signOut();
                } catch {
                  // Ignora erro de armazenamento ao trocar conta
                }
                if (isNavigationReady) {
                  router.replace('/login');
                }
              }}
            />
          </View>
        </View>
      ) : null}

      {showRedirectMask ? (
        <View
          style={[
            styles.overlayScreen,
            { backgroundColor: colors.bgPrimary },
          ]}
        >
          <ActivityIndicator size="small" color={colors.accentPrimary} />
        </View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <SessionProvider>
          <NavigationGuardShell />
        </SessionProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  overlayScreen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  spinner: {
    marginTop: 18,
  },
  recoveryCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  recoveryTitle: {
    ...typography.sectionTitle,
    fontSize: 19,
  },
});
