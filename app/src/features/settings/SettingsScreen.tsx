import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getTwoFactorStatus } from '@/api/endpoints';
import { TwoFactorStatus } from '@/api/types';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { PixelMascot } from '@/components/brand/PixelMascot';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LockIcon,
  LogOutIcon,
  SunIcon,
} from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { FloatingDock } from '@/components/navigation/FloatingDock';
import { AppSheet } from '@/components/overlays/AppSheet';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

import { ChangePasswordSheet } from './ChangePasswordSheet';
import { TwoFactorSheet } from './TwoFactorSheet';

export function SettingsScreen({
  embeddedInShell = false,
}: {
  embeddedInShell?: boolean;
} = {}) {
  const router = useRouter();
  const { colors, preference, setPreference } = useAppTheme();
  const { user, signOut, showToast, getCurrentSessionEpoch, isBiometricActive, biometricDeviceInfo, disableBiometricsOnCurrentSession } = useSession();
  const [disablingBiometrics, setDisablingBiometrics] = useState(false);

  const [activeSection, setActiveSection] = useState<'main' | 'security'>('main');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);

  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [twoFactorStatus, setTwoFactorStatus] = useState<TwoFactorStatus | null>(null);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const statusGenRef = useRef(0);

  const [signingOut, setSigningOut] = useState(false);
  const [themeSheetOpen, setThemeSheetOpen] = useState(false);

  const handleTwoFactorStatusChanged = useCallback((enabled: boolean) => {
    setTwoFactorStatus((curr) =>
      curr
        ? { ...curr, enabled }
        : { enabled, recoveryCodesRemaining: enabled ? 10 : 0 },
    );
  }, []);

  const check2FaStatus = useCallback(async (): Promise<TwoFactorStatus | null> => {
    const epoch = getCurrentSessionEpoch();
    const reqGen = ++statusGenRef.current;
    setTwoFactorLoading(true);
    setTwoFactorError(null);
    try {
      const res = await getTwoFactorStatus();
      if (getCurrentSessionEpoch() === epoch && reqGen === statusGenRef.current) {
        setTwoFactorStatus(res);
        setTwoFactorLoading(false);
      }
      return res;
    } catch {
      if (getCurrentSessionEpoch() === epoch && reqGen === statusGenRef.current) {
        setTwoFactorError('Não foi possível verificar o status de segurança.');
        setTwoFactorLoading(false);
      }
      return null;
    }
  }, [getCurrentSessionEpoch]);

  useEffect(() => {
    void check2FaStatus();
  }, [check2FaStatus]);

  const handleOpenChangePassword = async () => {
    if (twoFactorStatus !== null) {
      setChangePasswordOpen(true);
      return;
    }
    setTwoFactorLoading(true);
    const res = await check2FaStatus();
    if (res !== null) {
      setChangePasswordOpen(true);
    } else {
      showToast({
        tone: 'danger',
        title: 'Verificação necessária',
        subtitle:
          'Não foi possível verificar status de segurança. Tente novamente antes de trocar a senha.',
      });
    }
  };

  const handleDisableBiometrics = async () => {
    setDisablingBiometrics(true);
    try {
      await disableBiometricsOnCurrentSession();
      showToast({
        tone: 'info',
        title: 'Biometria desativada',
        subtitle: 'Você pode reativá-la ao fazer login com e-mail e senha.',
      });
    } catch {
      showToast({
        tone: 'danger',
        title: 'Erro ao desativar',
        subtitle: 'Não foi possível desativar a biometria. Tente novamente.',
      });
    } finally {
      setDisablingBiometrics(false);
    }
  };

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

      {activeSection === 'security' ? (
        /* Seção Real de Segurança */
        <View style={styles.subSectionWrap}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar para Ajustes"
            onPress={() => setActiveSection('main')}
            style={styles.backButtonRow}
          >
            <ChevronLeftIcon size={18} color={colors.brandPrimary} />
            <Text style={[styles.backButtonText, { color: colors.brandPrimary }]}>
              Ajustes
            </Text>
          </Pressable>

          <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>
            Segurança
          </Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
            Gerenciamento da sua senha e proteção da conta em duas etapas.
          </Text>

          <View style={styles.menuList}>
            {/* Trocar Senha */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Trocar senha"
              onPress={() => void handleOpenChangePassword()}
              style={styles.menuItem}
            >
              <View style={styles.menuLeftCol}>
                <LockIcon size={20} color={colors.textPrimary} />
                <View style={styles.menuTextGroup}>
                  <Text style={[styles.menuItemTitle, { color: colors.textPrimary }]}>
                    Trocar senha
                  </Text>
                  <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>
                    {twoFactorLoading
                      ? 'Verificando requisitos de segurança...'
                      : twoFactorError
                        ? 'Toque para verificar status e trocar senha'
                        : 'Atualize sua senha de acesso periodicamente'}
                  </Text>
                </View>
              </View>
              <ChevronRightIcon size={18} color={colors.brandPrimary} />
            </Pressable>

            <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

            {/* 2FA */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Autenticação em duas etapas"
              onPress={() => {
                if (twoFactorError) {
                  void check2FaStatus();
                } else {
                  setTwoFactorOpen(true);
                }
              }}
              style={styles.menuItem}
            >
              <View style={styles.menuLeftCol}>
                <LockIcon size={20} color={colors.textPrimary} />
                <View style={styles.menuTextGroup}>
                  <Text style={[styles.menuItemTitle, { color: colors.textPrimary }]}>
                    Autenticação em duas etapas
                  </Text>
                  <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>
                    {twoFactorLoading
                      ? 'Verificando status de segurança...'
                      : twoFactorError
                        ? 'Não foi possível verificar status • Toque para tentar novamente'
                        : twoFactorStatus?.enabled
                          ? 'Ativada • Google Authenticator'
                          : 'Desativada • Recomendado ativar'}
                  </Text>
                </View>
              </View>
              <ChevronRightIcon size={18} color={colors.brandPrimary} />
            </Pressable>

            <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

            {/* Biometria no aparelho */}
            <View style={styles.menuItem}>
              <View style={styles.menuLeftCol}>
                <LockIcon size={20} color={colors.textPrimary} />
                <View style={styles.menuTextGroup}>
                  <Text style={[styles.menuItemTitle, { color: colors.textPrimary }]}>
                    Biometria neste aparelho
                  </Text>
                  <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>
                    {isBiometricActive
                      ? `Ativada (${biometricDeviceInfo?.biometricLabel ?? 'Biometria'}) • Desbloqueio rápido neste aparelho`
                      : biometricDeviceInfo?.isExpoGoIos
                        ? 'Indisponível no Expo Go • Requer build própria no iOS'
                        : !biometricDeviceInfo?.isSupported
                          ? (biometricDeviceInfo?.reasonNotSupported ?? 'Biometria não disponível neste aparelho')
                          : 'Desativada • Pode ser ativada na tela de login'}
                  </Text>
                </View>
              </View>

              {isBiometricActive ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Desativar biometria neste aparelho"
                  onPress={handleDisableBiometrics}
                  disabled={disablingBiometrics}
                  style={styles.deactivateBtn}
                >
                  <Text style={[styles.deactivateBtnText, { color: colors.statusDanger }]}>
                    {disablingBiometrics ? 'Desativando...' : 'Desativar'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      ) : (
        /* Seção Principal de Ajustes */
        <View>
          <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>
            Ajustes
          </Text>

          {/* Account Profile Row (Print 4) */}
          <View style={styles.profileRow}>
            <PixelMascot variant="avatar" size={44} withFrame />
            <View style={styles.profileTextCol}>
              <Text style={[styles.profileName, { color: colors.textPrimary }]}>
                {user?.name ?? 'Motorista FuelLog'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Minha conta"
                testID="settings-minha-conta-button"
                onPress={() => router.push('/account')}
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
              accessibilityLabel="Segurança, senha e autenticação em duas etapas"
              onPress={() => {
                setActiveSection('security');
                void check2FaStatus();
              }}
              style={styles.menuItem}
            >
              <View style={styles.menuLeftCol}>
                <LockIcon size={20} color={colors.textPrimary} />
                <View style={styles.menuTextGroup}>
                  <Text style={[styles.menuItemTitle, { color: colors.textPrimary }]}>
                    Segurança
                  </Text>
                  <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>
                    {twoFactorLoading
                      ? 'Verificando segurança...'
                      : twoFactorError
                        ? 'Senha e proteção da conta'
                        : isBiometricActive
                          ? `Senha, 2FA ${twoFactorStatus?.enabled ? 'ativo' : 'inativo'} • Biometria ativa`
                          : twoFactorStatus?.enabled
                            ? 'Senha e 2FA ativo'
                            : 'Senha e Google Authenticator'}
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
        </View>
      )}

      {/* Sheets de Segurança */}
      <ChangePasswordSheet
        visible={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
        isTwoFactorEnabled={twoFactorStatus?.enabled ?? false}
      />

      <TwoFactorSheet
        visible={twoFactorOpen}
        onClose={() => {
          setTwoFactorOpen(false);
          void check2FaStatus();
        }}
        onStatusChanged={handleTwoFactorStatusChanged}
      />

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
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  standaloneHeader: {
    paddingVertical: 8,
  },
  subSectionWrap: {
    gap: 8,
  },
  backButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  screenTitle: {
    ...typography.screenTitle,
    fontSize: 28,
    fontWeight: '800',
    paddingVertical: 4,
    marginBottom: 4,
  },
  sectionSubtitle: {
    ...typography.body,
    fontSize: 14,
    marginBottom: 12,
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
    flex: 1,
  },
  menuTextGroup: {
    gap: 2,
    flex: 1,
  },
  menuItemTitle: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
  menuItemSub: {
    ...typography.caption,
    fontSize: 13,
  },
  deactivateBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deactivateBtnText: {
    ...typography.bodyStrong,
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
});
