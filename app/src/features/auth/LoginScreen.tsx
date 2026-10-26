import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api/types';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { EyeIcon, LockIcon, MailIcon } from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export function LoginScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
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
      {/* Top Wordmark */}
      <View style={styles.topHeader}>
        <BrandLockup mode="wordmark-only" wordmarkWidth={160} />
      </View>

      {/* Hero Scene with Night Road, Mascot and Car */}
      <View style={[styles.sceneCard, { borderColor: colors.borderSubtle, backgroundColor: colors.surface }]}>
        <Image
          source={require('@/assets/brand/scene_night_road.png')}
          style={styles.sceneImage}
          resizeMode="cover"
          accessibilityLabel="Cena noturna com Renault, mascote e estrada"
        />
      </View>

      <Pressable
        onPress={Keyboard.dismiss}
        accessible={false}
        style={styles.heroTextWrap}
      >
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>
          Bem-vindo de volta
        </Text>
        <Text style={[styles.screenSubtitle, { color: colors.textSecondary }]}>
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

        <PrimaryButton
          label="Entrar"
          onPress={handleSubmit}
          loading={submitting}
          stepped
          style={{ marginTop: 4 }}
        />
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
    paddingVertical: 14,
  },
  topHeader: {
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  sceneCard: {
    height: 146,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 14,
  },
  sceneImage: {
    width: '100%',
    height: '100%',
  },
  heroTextWrap: {
    marginBottom: 16,
    gap: 4,
  },
  screenTitle: {
    ...typography.screenTitle,
  },
  screenSubtitle: {
    ...typography.body,
    fontSize: 14,
  },
  formSection: {
    gap: 14,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    ...typography.bodyStrong,
    fontSize: 14,
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
    fontSize: 15,
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
    ...typography.bodyStrong,
    fontSize: 13,
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
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
    ...typography.bodyStrong,
    fontSize: 15,
  },
});
