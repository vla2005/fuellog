import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api/types';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { DiagonalPixelSpark } from '@/components/brand/PixelMascot';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { EyeIcon, LockIcon, MailIcon } from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { FONTS, radii, typography } from '@/theme/tokens';

export function LoginScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { signIn, prefilledLoginEmail, showToast } = useSession();

  const [email, setEmail] = useState(prefilledLoginEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);

  useEffect(() => {
    if (prefilledLoginEmail && !email) {
      setEmail(prefilledLoginEmail);
    }
  }, [email, prefilledLoginEmail]);

  const handleSubmit = async () => {
    setErrorMessage(null);
    setFieldErrors({});

    const cleanEmail = email.trim();
    const localErrors: Record<string, string> = {};
    if (!cleanEmail || !cleanEmail.includes('@')) {
      localErrors.email = 'Informe um endereço de e-mail válido.';
    }
    if (!password) {
      localErrors.password = 'Informe sua senha para entrar.';
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    setSubmitting(true);
    try {
      await signIn({ email: cleanEmail, password });
      showToast({
        tone: 'success',
        title: 'Sessão iniciada',
        subtitle: 'Seus abastecimentos foram sincronizados.',
      });
      router.replace('/');
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
        if (err.problem?.fieldErrors) {
          setFieldErrors(err.problem.fieldErrors);
        }
      } else {
        setErrorMessage('Não foi possível autenticar sua conta. Tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const inputBg = colors.surface;
  const inputBorder = colors.borderSubtle;

  return (
    <ScreenShell contentContainerStyle={styles.scrollContent}>
      <Pressable
        onPress={Keyboard.dismiss}
        accessible={false}
        style={styles.heroBlock}
      >
        <BrandLockup mode="auth-login" />
        <Text style={[styles.headline, { color: colors.textPrimary }]}>
          Bom te ver por aqui.
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Entre para acompanhar seus abastecimentos.
        </Text>
      </Pressable>

      <View style={styles.formSection}>
        {errorMessage ? (
          <InlineNotice tone="danger" message={errorMessage} />
        ) : null}

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
              autoComplete="password"
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
          ) : null}

          <View style={styles.forgotRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Esqueci minha senha"
              onPress={() => setForgotPasswordOpen(true)}
              style={({ pressed }) => [
                styles.forgotLink,
                pressed && { opacity: 0.75 },
              ]}
            >
              <Text
                style={[styles.forgotLinkText, { color: colors.accentPrimary }]}
              >
                Esqueci minha senha
              </Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Entrar"
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
              <Text style={styles.primaryCtaLabel}>Entrar</Text>
              <Text style={styles.primaryCtaArrow} aria-hidden>
                →
              </Text>
            </>
          )}
        </Pressable>
      </View>

      <View style={styles.registerStack}>
        <Text style={[styles.noAccountText, { color: colors.textPrimary }]}>
          Ainda não tem conta?
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Criar conta"
          onPress={() => router.push('/register')}
          style={({ pressed }) => [
            styles.registerAction,
            pressed && { opacity: 0.75 },
          ]}
        >
          <Text
            style={[styles.registerActionText, { color: colors.accentPrimary }]}
          >
            Criar conta
          </Text>
        </Pressable>
      </View>

      <View style={styles.brandFooter}>
        <DiagonalPixelSpark size={6} />
        <Text style={[styles.brandFooterText, { color: colors.textSecondary }]}>
          Cada abastecimento conta.
        </Text>
      </View>

      <AppSheet
        visible={forgotPasswordOpen}
        title="Recuperação de senha"
        subtitle="Acesso à sua conta"
        onClose={() => setForgotPasswordOpen(false)}
      >
        <InlineNotice
          tone="info"
          title="Recuperação automática temporariamente indisponível"
          message="O envio automático de redefinição de senha por e-mail ainda não está habilitado. Caso precise recuperar seu acesso, entre em contato com o suporte ou crie uma nova conta."
        />
        <PrimaryButton
          label="Entendi"
          variant="secondary"
          onPress={() => setForgotPasswordOpen(false)}
        />
      </AppSheet>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    justifyContent: 'space-between',
    paddingVertical: 18,
  },
  heroBlock: {
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 18,
  },
  headline: {
    fontFamily: FONTS.extraBold,
    fontSize: 27,
    lineHeight: 33,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 14,
  },
  subtitle: {
    ...typography.body,
    fontSize: 15,
    textAlign: 'center',
    marginTop: 6,
  },
  formSection: {
    gap: 14,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontFamily: FONTS.bold,
    fontSize: 14,
    lineHeight: 18,
  },
  inputRow: {
    minHeight: 54,
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
  forgotRow: {
    alignItems: 'flex-end',
    marginTop: 2,
  },
  forgotLink: {
    minHeight: 30,
    justifyContent: 'center',
  },
  forgotLinkText: {
    fontFamily: FONTS.bold,
    fontSize: 13,
    lineHeight: 18,
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
    marginTop: 2,
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
  registerStack: {
    marginTop: 22,
    alignItems: 'center',
    gap: 4,
  },
  noAccountText: {
    ...typography.body,
    fontSize: 15,
  },
  registerAction: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  registerActionText: {
    fontFamily: FONTS.bold,
    fontSize: 16,
    lineHeight: 20,
  },
  brandFooter: {
    marginTop: 20,
    alignItems: 'center',
    gap: 6,
  },
  brandFooterText: {
    ...typography.caption,
    fontSize: 13,
  },
});
