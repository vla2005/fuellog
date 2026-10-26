import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BrandLockup } from '@/components/brand/BrandLockup';
import { PixelMascot } from '@/components/brand/PixelMascot';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import {
  ChevronRightIcon,
  LockIcon,
  LogOutIcon,
  ReceiptLogIcon,
  SettingsIcon,
  SunIcon,
  UserIcon,
} from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { FloatingDock } from '@/components/navigation/FloatingDock';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { ThemePreference, useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export function SettingsScreen({
  embeddedInShell = false,
}: {
  embeddedInShell?: boolean;
} = {}) {
  const router = useRouter();
  const { colors, isDark, preference, setPreference } = useAppTheme();
  const { user, signOut, showToast } = useSession();

  const [signingOut, setSigningOut] = useState(false);
  const [themeSheetOpen, setThemeSheetOpen] = useState(false);
  const [limitationNotice, setLimitationNotice] = useState<string | null>(null);
  const [legalModal, setLegalModal] = useState<'terms' | 'privacy' | null>(null);

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
      // Ignore
    } finally {
      setSigningOut(false);
      router.replace('/login');
    }
  };

  const themeLabel =
    preference === 'system'
      ? 'Automático'
      : preference === 'light'
        ? 'Claro'
        : 'Escuro';

  return (
    <ScreenShell
      withDockClearance
      omitTopSafeArea={embeddedInShell}
      footer={embeddedInShell ? undefined : <FloatingDock activeTab="settings" />}
    >
      {!embeddedInShell ? (
        <View style={styles.standaloneHeader}>
          <BrandLockup mode="wordmark-only" wordmarkWidth={146} />
        </View>
      ) : null}

      <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>
        Ajustes
      </Text>

      {limitationNotice ? (
        <InlineNotice
          tone="info"
          title="Aviso do sistema"
          message={limitationNotice}
        />
      ) : null}

      {/* Account Profile Row (Print 4) */}
      <View style={styles.profileRow}>
        <PixelMascot variant="avatar" size={44} withFrame />
        <View style={styles.profileTextCol}>
          <Text style={[styles.profileName, { color: colors.textPrimary }]}>
            {user?.name ?? 'Motorista FuelLog'}
          </Text>
          <Pressable
            onPress={() => setLimitationNotice(`Conta vinculada ao e-mail ${user?.email ?? 'do usuário'}. Alteração de dados cadastrais disponível em atualização futura.`)}
            style={styles.minhaContaBtn}
          >
            <Text style={[styles.minhaContaText, { color: colors.brandPrimary }]}>
              Minha conta &gt;
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

      {/* Menu Options List with Dividers (Print 4) */}
      <View style={styles.menuList}>
        {/* Aparência */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Aparência e tema"
          onPress={() => setThemeSheetOpen(true)}
          style={styles.menuItem}
        >
          <View style={styles.menuLeftCol}>
            <SunIcon size={20} color={colors.textPrimary} />
            <View style={styles.menuTextGroup}>
              <Text style={[styles.menuItemTitle, { color: colors.textPrimary }]}>
                Aparência
              </Text>
              <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>
                {themeLabel}
              </Text>
            </View>
          </View>
          <ChevronRightIcon size={18} color={colors.brandPrimary} />
        </Pressable>

        <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

        {/* Segurança */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Segurança, senha e sessões"
          onPress={() => setLimitationNotice('Gerenciamento de senhas e sessões ativas estará disponível em atualização futura da API.')}
          style={styles.menuItem}
        >
          <View style={styles.menuLeftCol}>
            <LockIcon size={20} color={colors.textPrimary} />
            <View style={styles.menuTextGroup}>
              <Text style={[styles.menuItemTitle, { color: colors.textPrimary }]}>
                Segurança
              </Text>
              <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>
                Senha e sessões
              </Text>
            </View>
          </View>
          <ChevronRightIcon size={18} color={colors.brandPrimary} />
        </Pressable>

        <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

        {/* Privacidade e termos */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Privacidade e termos"
          onPress={() => setLegalModal('privacy')}
          style={styles.menuItem}
        >
          <View style={styles.menuLeftCol}>
            <ReceiptLogIcon size={20} color={colors.textPrimary} />
            <View style={styles.menuTextGroup}>
              <Text style={[styles.menuItemTitle, { color: colors.textPrimary }]}>
                Privacidade e termos
              </Text>
            </View>
          </View>
          <ChevronRightIcon size={18} color={colors.brandPrimary} />
        </Pressable>

        <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

        {/* Sobre o FuelLog */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sobre o FuelLog"
          onPress={() => setLimitationNotice('FuelLog v1.0.0 — Gestão eficiente e inteligente de abastecimentos e frotas.')}
          style={styles.menuItem}
        >
          <View style={styles.menuLeftCol}>
            <SettingsIcon size={20} color={colors.textPrimary} />
            <View style={styles.menuTextGroup}>
              <Text style={[styles.menuItemTitle, { color: colors.textPrimary }]}>
                Sobre o FuelLog
              </Text>
            </View>
          </View>
          <ChevronRightIcon size={18} color={colors.brandPrimary} />
        </Pressable>

        <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

        {/* Sair da conta (Red text & icon) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sair da conta"
          onPress={handleSignOut}
          disabled={signingOut}
          style={styles.menuItem}
        >
          <View style={styles.menuLeftCol}>
            <LogOutIcon size={20} color={colors.statusDanger} />
            <Text style={[styles.signOutText, { color: colors.statusDanger }]}>
              {signingOut ? 'Saindo...' : 'Sair da conta'}
            </Text>
          </View>
          <ChevronRightIcon size={18} color={colors.statusDanger} />
        </Pressable>
      </View>

      {/* Theme Picker Sheet */}
      <AppSheet
        visible={themeSheetOpen}
        title="Aparência"
        subtitle="Selecione o tema do FuelLog"
        onClose={() => setThemeSheetOpen(false)}
      >
        <View style={styles.themeOptionsList}>
          {(['dark', 'light', 'system'] as const).map((t) => {
            const isSelected = preference === t;
            const tLabel = t === 'dark' ? 'Modo Escuro' : t === 'light' ? 'Modo Claro' : 'Automático (Sistema)';
            return (
              <Pressable
                key={t}
                accessibilityRole="radio"
                accessibilityLabel={tLabel}
                accessibilityState={{ checked: isSelected }}
                aria-checked={isSelected}
                onPress={() => {
                  setPreference(t);
                  setThemeSheetOpen(false);
                }}
                style={[
                  styles.themeOptionRow,
                  {
                    backgroundColor: isSelected ? colors.brandSoft : colors.bgElevated,
                    borderColor: isSelected ? colors.borderFocus : colors.borderSubtle,
                  },
                ]}
              >
                <Text style={[styles.themeOptionTitle, { color: colors.textPrimary }]}>
                  {tLabel}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </AppSheet>

      {/* Legal Modal */}
      <AppSheet
        visible={legalModal !== null}
        title={legalModal === 'terms' ? 'Termos de Uso' : 'Política de Privacidade'}
        onClose={() => setLegalModal(null)}
      >
        <View style={{ paddingVertical: 12, gap: 8 }}>
          <Text style={[styles.legalText, { color: colors.textSecondary }]}>
            O FuelLog respeita integralmente a privacidade dos seus dados de abastecimento e frotas, mantendo segredos fora de logs e assegurando controle total ao usuário.
          </Text>
        </View>
      </AppSheet>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  standaloneHeader: {
    paddingVertical: 8,
  },
  screenTitle: {
    ...typography.screenTitle,
    fontSize: 28,
    fontWeight: '800',
    paddingVertical: 8,
    marginBottom: 8,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  profileTextCol: {
    gap: 2,
  },
  profileName: {
    ...typography.sectionTitle,
    fontSize: 20,
    fontWeight: '700',
  },
  minhaContaBtn: {
    paddingVertical: 2,
  },
  minhaContaText: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  divider: {
    height: 1,
    marginVertical: 4,
  },
  menuList: {
    paddingVertical: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  menuLeftCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  menuTextGroup: {
    gap: 2,
  },
  menuItemTitle: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
  menuItemSub: {
    ...typography.caption,
    fontSize: 13,
  },
  signOutText: {
    ...typography.bodyStrong,
    fontSize: 16,
    fontWeight: '700',
  },
  themeOptionsList: {
    gap: 10,
    paddingVertical: 8,
  },
  themeOptionRow: {
    padding: 16,
    borderRadius: radii.md,
    borderWidth: 1.5,
  },
  themeOptionTitle: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
  legalText: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
  },
});
