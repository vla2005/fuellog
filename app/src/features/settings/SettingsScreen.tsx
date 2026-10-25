import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getApiBaseUrl } from '@/api/client';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { CheckIcon, UserIcon } from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { FloatingDock } from '@/components/navigation/FloatingDock';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { ThemePreference, useAppTheme } from '@/theme/ThemeProvider';
import { radii, shadows, typography } from '@/theme/tokens';

const THEME_OPTIONS: { value: ThemePreference; label: string; subtitle: string }[] = [
  {
    value: 'system',
    label: 'Automático (Sistema)',
    subtitle: 'Segue a aparência clara ou escura do dispositivo',
  },
  {
    value: 'light',
    label: 'Modo Claro',
    subtitle: 'Fundo claro quente com destaque em azul royal',
  },
  {
    value: 'dark',
    label: 'Modo Escuro',
    subtitle: 'Fundo azul-marinho profundo para menor brilho',
  },
];

export function SettingsScreen() {
  const router = useRouter();
  const { colors, isDark, preference, setPreference } = useAppTheme();
  const { user, signOut, showToast } = useSession();

  const [signingOut, setSigningOut] = useState(false);
  const [legalDocModal, setLegalDocModal] = useState<'terms' | 'privacy' | null>(
    null,
  );

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      showToast({
        tone: 'info',
        title: 'Sessão encerrada',
        subtitle: 'Você saiu da sua conta com segurança.',
      });
    } catch {
      // SessionProvider já limpa o estado em memória em finally e exibe o aviso de falha de remoção;
      // tratamos a rejeição aqui para evitar unhandledrejection e preservar o aviso de erro na tela.
    } finally {
      setSigningOut(false);
      router.replace('/login');
    }
  };

  const openLegal = async (type: 'terms' | 'privacy') => {
    const url =
      type === 'terms'
        ? process.env.EXPO_PUBLIC_TERMS_URL?.trim()
        : process.env.EXPO_PUBLIC_PRIVACY_URL?.trim();

    if (url) {
      await Linking.openURL(url).catch(() => setLegalDocModal(type));
      return;
    }
    setLegalDocModal(type);
  };

  return (
    <ScreenShell
      withDockClearance
      footer={<FloatingDock activeTab="settings" />}
    >
      <View style={styles.headerRow}>
        <BrandLockup mode="header" />
      </View>

      <View style={styles.titleBlock}>
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>
          Ajustes e conta
        </Text>
        <Text style={[styles.screenSubtitle, { color: colors.textSecondary }]}>
          Gerencie sua sessão, tema visual e informações do aplicativo.
        </Text>
      </View>

      <View style={styles.stack}>
        {/* Account Card */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.bgElevated,
              borderColor: colors.borderDefault,
            },
            isDark ? shadows.darkCard : shadows.lightCard,
          ]}
        >
          <View style={styles.accountRow}>
            <View
              style={[
                styles.avatarCircle,
                { backgroundColor: colors.accentSoft },
              ]}
            >
              <UserIcon size={22} color={colors.accentPrimary} />
            </View>
            <View style={styles.accountText}>
              <Text style={[styles.accountName, { color: colors.textPrimary }]}>
                {user?.name ?? 'Motorista FuelLog'}
              </Text>
              <Text
                style={[styles.accountEmail, { color: colors.textSecondary }]}
              >
                {user?.email ?? 'Sessão ativa'}
              </Text>
              {user?.preferredTimezone ? (
                <Text
                  style={[styles.accountMeta, { color: colors.textMuted }]}
                >
                  Fuso horário: {user.preferredTimezone}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* Theme Selector */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.bgElevated,
              borderColor: colors.borderDefault,
            },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
            Aparência do aplicativo
          </Text>

          {THEME_OPTIONS.map((option) => {
            const isSelected = preference === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                aria-checked={isSelected}
                accessibilityLabel={option.label}
                onPress={() => setPreference(option.value)}
                style={[
                  styles.themeRow,
                  {
                    backgroundColor: isSelected
                      ? colors.accentSoft
                      : colors.bgSecondary,
                    borderColor: isSelected
                      ? colors.accentPrimary
                      : colors.borderDefault,
                  },
                ]}
              >
                <View style={styles.themeTextCol}>
                  <Text
                    style={[styles.themeTitle, { color: colors.textPrimary }]}
                  >
                    {option.label}
                  </Text>
                  <Text
                    style={[
                      styles.themeSubtitle,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {option.subtitle}
                  </Text>
                </View>
                {isSelected ? (
                  <CheckIcon size={18} color={colors.accentPrimary} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {/* API & Legal Info */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.bgElevated,
              borderColor: colors.borderDefault,
            },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
            Ambiente e documentos
          </Text>
          <Text style={[styles.envText, { color: colors.textSecondary }]}>
            Servidor API: {getApiBaseUrl()}
          </Text>

          <View style={styles.legalLinksRow}>
            <PrimaryButton
              label="Termos de Uso"
              variant="secondary"
              onPress={() => openLegal('terms')}
              style={styles.halfBtn}
            />
            <PrimaryButton
              label="Privacidade"
              variant="secondary"
              onPress={() => openLegal('privacy')}
              style={styles.halfBtn}
            />
          </View>
        </View>

        <InlineNotice
          tone="info"
          title="Novos recursos em breve"
          message="Exportação de relatórios, recuperação automática de senha e edição de registros estarão disponíveis nas próximas atualizações."
        />

        <PrimaryButton
          label="Sair da conta"
          variant="danger"
          loading={signingOut}
          onPress={handleSignOut}
        />
      </View>

      <AppSheet
        visible={legalDocModal !== null}
        title={
          legalDocModal === 'terms' ? 'Termos de Uso' : 'Política de Privacidade'
        }
        onClose={() => setLegalDocModal(null)}
      >
        <InlineNotice
          tone="info"
          title="Documento público em preparação"
          message="A página institucional com os Termos de Uso e a Política de Privacidade ainda não foi vinculada neste ambiente."
        />
        <PrimaryButton
          label="Fechar"
          variant="secondary"
          onPress={() => setLegalDocModal(null)}
        />
      </AppSheet>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    marginBottom: 14,
  },
  titleBlock: {
    gap: 4,
    marginBottom: 16,
  },
  screenTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
  },
  screenSubtitle: {
    ...typography.body,
    fontSize: 13,
  },
  stack: {
    gap: 14,
  },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountText: {
    flex: 1,
    gap: 2,
  },
  accountName: {
    ...typography.cardTitle,
  },
  accountEmail: {
    ...typography.caption,
  },
  accountMeta: {
    ...typography.caption,
    fontSize: 11,
  },
  cardTitle: {
    ...typography.cardTitle,
    fontSize: 16,
  },
  themeRow: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  themeTextCol: {
    flex: 1,
    gap: 2,
  },
  themeTitle: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  themeSubtitle: {
    ...typography.caption,
    fontSize: 12,
  },
  envText: {
    ...typography.caption,
    fontSize: 12,
  },
  legalLinksRow: {
    flexDirection: 'row',
    gap: 10,
  },
  halfBtn: {
    flex: 1,
  },
});
