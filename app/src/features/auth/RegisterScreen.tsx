import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api/types';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { DiagonalPixelSpark, PixelMascot } from '@/components/brand/PixelMascot';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import {
  ChevronLeftIcon,
  EyeIcon,
  LockIcon,
  MailIcon,
  UserIcon,
} from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { FONTS, radii, typography } from '@/theme/tokens';

export function RegisterScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { signUpAndSignIn, showToast } = useSession();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [legalDocModal, setLegalDocModal] = useState<'terms' | 'privacy' | null>(
    null,
  );

  const openLegalDocument = async (type: 'terms' | 'privacy') => {
    const configuredUrl =
      type === 'terms'
        ? process.env.EXPO_PUBLIC_TERMS_URL?.trim()
        : process.env.EXPO_PUBLIC_PRIVACY_URL?.trim();

    if (configuredUrl) {
      await Linking.openURL(configuredUrl).catch(() => {
        setLegalDocModal(type);
      });
      return;
    }
    setLegalDocModal(type);
  };

  const handleSubmit = async () => {
    setErrorMessage(null);
    setFieldErrors({});

    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const localErrors: Record<string, string> = {};

    if (!cleanName) {
      localErrors.name = 'Informe como podemos chamar você.';
    } else if (cleanName.length > 100) {
      localErrors.name = 'O nome deve ter no máximo 100 caracteres.';
    }

    if (!cleanEmail || !cleanEmail.includes('@')) {
      localErrors.email = 'Informe um endereço de e-mail válido.';
    }

    if (password.length < 12 || password.length > 128) {
      localErrors.password = 'A senha deve ter entre 12 e 128 caracteres.';
    }

    if (!confirmPassword) {
      localErrors.confirmPassword = 'Confirme a senha digitada.';
    } else if (confirmPassword !== password) {
      localErrors.confirmPassword = 'As senhas informadas não coincidem.';
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await signUpAndSignIn({
        name: cleanName,
        email: cleanEmail,
        password,
      });

      if (result.registeredOnly) {
        showToast({
          tone: 'warning',
          title: 'Conta criada com sucesso',
          subtitle: 'Entre com seu e-mail e senha para iniciar a sessão.',
        });
        router.replace('/login');
        return;
      }

      showToast({
        tone: 'success',
        title: 'Conta criada e conectada',
        subtitle: `Bem-vindo ao FuelLog, ${cleanName}!`,
      });
      router.replace('/');
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
        if (err.problem?.fieldErrors) {
          setFieldErrors(err.problem.fieldErrors);
        }
      } else {
        setErrorMessage('Não foi possível concluir o cadastro. Tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const inputBg = colors.surface;
  const inputBorder = colors.borderSubtle;

  return (
    <ScreenShell contentContainerStyle={styles.scrollContent}>
      {/* Top Bar: Back button left + Wordmark centered */}
      <View style={styles.topHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar para login"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/login');
            }
          }}
          style={[
            styles.backSquare,
            {
              backgroundColor: inputBg,
              borderColor: inputBorder,
            },
          ]}
        >
          <ChevronLeftIcon size={20} color={colors.accentPrimary} />
        </Pressable>
        <BrandLockup mode="wordmark-only" wordmarkWidth={148} />
        <View style={styles.headerRightSpacer} />
      </View>

      {/* Split Hero: Left text + Right Mascot */}
      <View style={styles.heroSplitRow}>
        <View style={styles.heroTextCol}>
          <Text style={[styles.heroHeadline, { color: colors.textPrimary }]}>
            Vamos começar?
          </Text>
          <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>
            Crie sua conta no FuelLog.
          </Text>
        </View>
        <View style={styles.heroMascotCol}>
          <PixelMascot variant="full" size={88} showSparks />
        </View>
      </View>

      {/* Form Fields directly on canvas */}
      <View style={styles.formSection}>
        {errorMessage ? (
          <InlineNotice tone="danger" message={errorMessage} />
        ) : null}

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>Nome</Text>
          <View
            style={[
              styles.inputRow,
              {
                backgroundColor: inputBg,
                borderColor: fieldErrors.name ? colors.dangerBorder : inputBorder,
              },
            ]}
          >
            <UserIcon size={20} color={colors.accentPrimary} />
            <TextInput
              accessibilityLabel="Nome"
              value={name}
              onChangeText={setName}
              placeholder="Como podemos te chamar?"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              autoComplete="name"
              style={[styles.textInput, { color: colors.textPrimary }]}
            />
          </View>
          {fieldErrors.name ? (
            <Text style={[styles.errorText, { color: colors.dangerText }]}>
              {fieldErrors.name}
            </Text>
          ) : null}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>E-mail</Text>
          <View
            style={[
              styles.inputRow,
              {
                backgroundColor: inputBg,
                borderColor: fieldErrors.email ? colors.dangerBorder : inputBorder,
              },
            ]}
          >
            <MailIcon size={20} color={colors.accentPrimary} />
            <TextInput
              accessibilityLabel="E-mail"
              value={email}
              onChangeText={setEmail}
              placeholder="voce@email.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              style={[styles.textInput, { color: colors.textPrimary }]}
            />
          </View>
          {fieldErrors.email ? (
            <Text style={[styles.errorText, { color: colors.dangerText }]}>
              {fieldErrors.email}
            </Text>
          ) : null}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>Senha</Text>
          <View
            style={[
              styles.inputRow,
              {
                backgroundColor: inputBg,
                borderColor: fieldErrors.password
                  ? colors.dangerBorder
                  : inputBorder,
              },
            ]}
          >
            <LockIcon size={20} color={colors.accentPrimary} />
            <TextInput
              accessibilityLabel="Senha"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.textInput, { color: colors.textPrimary }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              onPress={() => setShowPassword((prev) => !prev)}
              style={styles.eyeButton}
            >
              <EyeIcon size={20} color={colors.textSecondary} off={showPassword} />
            </Pressable>
          </View>
          {fieldErrors.password ? (
            <Text style={[styles.errorText, { color: colors.dangerText }]}>
              {fieldErrors.password}
            </Text>
          ) : (
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>
              Use uma senha exclusiva.
            </Text>
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>
            Confirmar senha
          </Text>
          <View
            style={[
              styles.inputRow,
              {
                backgroundColor: inputBg,
                borderColor: fieldErrors.confirmPassword
                  ? colors.dangerBorder
                  : inputBorder,
              },
            ]}
          >
            <LockIcon size={20} color={colors.accentPrimary} />
            <TextInput
              accessibilityLabel="Confirmar senha"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.textInput, { color: colors.textPrimary }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                showConfirmPassword
                  ? 'Ocultar confirmação de senha'
                  : 'Mostrar confirmação de senha'
              }
              onPress={() => setShowConfirmPassword((prev) => !prev)}
              style={styles.eyeButton}
            >
              <EyeIcon
                size={20}
                color={colors.textSecondary}
                off={showConfirmPassword}
              />
            </Pressable>
          </View>
          {fieldErrors.confirmPassword ? (
            <Text style={[styles.errorText, { color: colors.dangerText }]}>
              {fieldErrors.confirmPassword}
            </Text>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Criar conta"
          accessibilityState={{ disabled: submitting, busy: submitting }}
          aria-disabled={submitting}
          aria-busy={submitting}
          disabled={submitting}
          onPress={handleSubmit}
          style={({ pressed }) => [
            styles.primaryCta,
            {
              backgroundColor: pressed
                ? colors.accentPressed
                : colors.accentPrimary,
              opacity: submitting ? 0.7 : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <View style={styles.ctaSideSpacer} />
              <Text style={styles.primaryCtaLabel}>Criar conta</Text>
              <Text style={styles.primaryCtaArrow} aria-hidden>
                →
              </Text>
            </>
          )}
        </Pressable>
      </View>

      {/* Legal & Login links */}
      <View style={styles.bottomLinksBlock}>
        <View style={styles.legalCenteredRow}>
          <Text style={[styles.legalText, { color: colors.textPrimary }]}>
            Consulte nossos{' '}
          </Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Termos de Uso"
            onPress={() => openLegalDocument('terms')}
          >
            <Text style={[styles.legalLink, { color: colors.accentPrimary }]}>
              Termos de Uso
            </Text>
          </Pressable>
          <Text style={[styles.legalText, { color: colors.textPrimary }]}> e </Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Política de Privacidade"
            onPress={() => openLegalDocument('privacy')}
          >
            <Text style={[styles.legalLink, { color: colors.accentPrimary }]}>
              Política de Privacidade
            </Text>
          </Pressable>
          <Text style={[styles.legalText, { color: colors.textPrimary }]}>.</Text>
        </View>

        <View style={styles.loginInlineRow}>
          <Text style={[styles.alreadyText, { color: colors.textPrimary }]}>
            Já tem uma conta?
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Entrar"
            onPress={() => router.replace('/login')}
            style={({ pressed }) => [
              styles.loginAction,
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text
              style={[styles.loginActionText, { color: colors.accentPrimary }]}
            >
              Entrar
            </Text>
          </Pressable>
        </View>

        <View style={styles.brandFooter}>
          <DiagonalPixelSpark size={6} />
          <Text style={[styles.brandFooterText, { color: colors.textSecondary }]}>
            Cada abastecimento conta.
          </Text>
        </View>
      </View>

      <AppSheet
        visible={legalDocModal !== null}
        title={
          legalDocModal === 'terms' ? 'Termos de Uso' : 'Política de Privacidade'
        }
        subtitle="Informações institucionais"
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
  scrollContent: {
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backSquare: {
    width: 42,
    height: 42,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRightSpacer: {
    width: 42,
  },
  heroSplitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 12,
  },
  heroTextCol: {
    flex: 1,
    gap: 4,
  },
  heroHeadline: {
    fontFamily: FONTS.extraBold,
    fontSize: 23,
    lineHeight: 28,
    letterSpacing: -0.6,
  },
  heroSubtitle: {
    ...typography.body,
    fontSize: 15,
  },
  heroMascotCol: {
    paddingRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formSection: {
    gap: 12,
  },
  fieldGroup: {
    gap: 5,
  },
  label: {
    fontFamily: FONTS.bold,
    fontSize: 14,
    lineHeight: 18,
  },
  inputRow: {
    minHeight: 52,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  textInput: {
    flex: 1,
    ...typography.body,
    fontSize: 16,
    paddingVertical: 10,
  },
  eyeButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helperText: {
    ...typography.caption,
    fontSize: 12,
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
  },
  primaryCta: {
    minHeight: 56,
    borderRadius: radii.lg,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  ctaSideSpacer: {
    width: 24,
  },
  primaryCtaLabel: {
    fontFamily: FONTS.bold,
    fontSize: 18,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  primaryCtaArrow: {
    fontFamily: FONTS.extraBold,
    fontSize: 20,
    lineHeight: 22,
    color: '#FFFFFF',
    width: 24,
    textAlign: 'right',
  },
  bottomLinksBlock: {
    marginTop: 14,
    alignItems: 'center',
    gap: 10,
  },
  legalCenteredRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    maxWidth: 300,
  },
  legalText: {
    ...typography.caption,
    fontSize: 13,
    textAlign: 'center',
  },
  legalLink: {
    fontFamily: FONTS.bold,
    fontSize: 13,
    lineHeight: 18,
  },
  loginInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  alreadyText: {
    ...typography.body,
    fontSize: 14,
  },
  loginAction: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  loginActionText: {
    fontFamily: FONTS.bold,
    fontSize: 14,
    lineHeight: 18,
  },
  brandFooter: {
    marginTop: 4,
    alignItems: 'center',
    gap: 6,
  },
  brandFooterText: {
    ...typography.caption,
    fontSize: 13,
  },
});
