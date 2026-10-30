import { usePathname, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { ApiError } from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { EyeIcon, LockIcon, MailIcon } from '@/components/icons/AppIcons';
import { OtpSixInput } from '@/components/inputs/OtpSixInput';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { AuthSceneHero } from '@/features/auth/AuthSceneHero';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

interface MfaChallengeState {
  challengeToken: string;
  expiresAt: string;
}

export function LoginScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const {
    signIn,
    completeTwoFactorSignIn,
    cancelTwoFactorChallenge,
    prefilledLoginEmail,
    showToast,
    hasBiometricLock,
    biometricDeviceInfo,
    unlockWithBiometrics,
  } = useSession();

  const [email, setEmail] = useState(prefilledLoginEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallengeState | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [biometricUnlocking, setBiometricUnlocking] = useState(false);
  const [biometricNotice, setBiometricNotice] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);

  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  const resetTransientState = useCallback(() => {
    setPassword('');
    setShowPassword(false);
    setMfaChallenge(null);
    setMfaCode('');
    setUseRecoveryCode(false);
    setErrorMessage(null);
    setBiometricNotice(null);
    setBiometricUnlocking(false);
    setFieldErrors({});
    setForgotPasswordOpen(false);
    cancelTwoFactorChallenge();
  }, [cancelTwoFactorChallenge]);

  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;

    if (prev === '/login' && pathname !== '/login') {
      resetTransientState();
    } else if (prev !== '/login' && pathname === '/login') {
      resetTransientState();
      if (prefilledLoginEmail) {
        setEmail(prefilledLoginEmail);
      }
    }
  }, [pathname, prefilledLoginEmail, resetTransientState]);

  useEffect(() => {
    if (prefilledLoginEmail && !email) {
      setEmail(prefilledLoginEmail);
    }
  }, [email, prefilledLoginEmail]);

  useEffect(() => {
    return () => {
      resetTransientState();
    };
  }, [resetTransientState]);

  const handleBiometricUnlock = async () => {
    setBiometricNotice(null);
    setErrorMessage(null);
    setBiometricUnlocking(true);
    try {
      const res = await unlockWithBiometrics();
      if (res.success) {
        showToast({
          tone: 'success',
          title: 'Sessão iniciada',
          subtitle: 'Acesso biométrico confirmado.',
        });
        router.replace('/');
      } else if (res.canceled) {
        setBiometricNotice(
          'Autenticação biométrica cancelada. Entre com sua senha ou tente novamente.',
        );
      } else if (res.invalidated) {
        setErrorMessage(
          'Os dados biométricos do aparelho foram alterados. Entre com sua senha para reativar.',
        );
      } else {
        setErrorMessage(res.error || 'Falha ao autenticar com biometria.');
      }
    } catch {
      setErrorMessage('Não foi possível autenticar com biometria.');
    } finally {
      setBiometricUnlocking(false);
    }
  };

  const biometricLabel = biometricDeviceInfo?.biometricLabel ?? 'biometria';
  const biometricButtonLabel = biometricDeviceInfo?.biometricLabel
    ? `Entrar com ${biometricDeviceInfo.biometricLabel}`
    : 'Entrar com biometria';

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
      const result = await signIn({ email: cleanEmail, password });

      // Se a conta exige 2FA, entramos no fluxo de desafio MFA sem salvar tokens
      if (result.mfaRequired) {
        setPassword(''); // Limpa a senha imediatamente da memória
        setMfaChallenge({
          challengeToken: result.challengeToken,
          expiresAt: result.expiresAt,
        });
        setMfaCode('');
        setErrorMessage(null);
        setFieldErrors({});
        return;
      }
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

  const handleVerifyMfa = async () => {
    if (!mfaChallenge) return;
    setErrorMessage(null);
    setFieldErrors({});

    const cleanCode = mfaCode.trim();
    if (!cleanCode) {
      setFieldErrors({
        code: useRecoveryCode
          ? 'Informe o código de recuperação.'
          : 'Digite o código de 6 dígitos do autenticador.',
      });
      return;
    }

    if (!useRecoveryCode && !/^\d{6}$/.test(cleanCode)) {
      setFieldErrors({ code: 'Digite o código de 6 dígitos do autenticador.' });
      return;
    }

    setSubmitting(true);
    try {
      await completeTwoFactorSignIn(mfaChallenge.challengeToken, cleanCode);
      setMfaChallenge(null);
      setMfaCode('');
      setUseRecoveryCode(false);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setErrorMessage('O desafio de autenticação expirou. Faça login novamente.');
        } else {
          setErrorMessage(err.message);
        }
        if (err.problem?.fieldErrors) {
          setFieldErrors(err.problem.fieldErrors);
        }
      } else {
        setErrorMessage('Código inválido ou expirado. Tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelMfa = () => {
    cancelTwoFactorChallenge();
    setMfaChallenge(null);
    setMfaCode('');
    setUseRecoveryCode(false);
    setErrorMessage(null);
    setFieldErrors({});
  };

  const inputBg = colors.surface;
  const inputBorder = colors.borderSubtle;

  return (
    <ScreenShell
      omitTopSafeArea
      fullBleedHero={<AuthSceneHero mode="login" />}
      contentContainerStyle={styles.scrollContent}
    >
      <Pressable
        onPress={Keyboard.dismiss}
        accessible={false}
        style={styles.heroTextWrap}
      >
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>
          {mfaChallenge ? 'Autenticação em duas etapas' : 'Bem-vindo de volta'}
        </Text>
        <Text style={[styles.screenSubtitle, { color: colors.textSecondary }]}>
          {mfaChallenge
            ? 'Digite o código de 6 dígitos do Google Authenticator ou um código de recuperação para entrar.'
            : 'Entre para acompanhar seus abastecimentos.'}
        </Text>
      </Pressable>

      {mfaChallenge ? (
        /* Formulário de Desafio 2FA */
        <View style={styles.formSection}>
          {errorMessage ? (
            <InlineNotice tone="danger" message={errorMessage} />
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>
              {useRecoveryCode
                ? 'Código de recuperação'
                : 'Código de verificação (6 dígitos)'}
            </Text>
            {useRecoveryCode ? (
              <View
                style={[
                  styles.inputRow,
                  {
                    backgroundColor: inputBg,
                    borderColor: fieldErrors.code ? colors.dangerBorder : inputBorder,
                  },
                ]}
              >
                <LockIcon size={20} color={colors.accentPrimary} />
                <TextInput
                  accessibilityLabel="Código de recuperação"
                  value={mfaCode}
                  onChangeText={setMfaCode}
                  placeholder="Cole seu código de 43 caracteres"
                  placeholderTextColor={colors.textMuted}
                  autoFocus={true}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.textInput, { color: colors.textPrimary }]}
                />
              </View>
            ) : (
              <OtpSixInput
                value={mfaCode}
                onChange={setMfaCode}
                accessibilityLabel="Código de 6 dígitos"
                hasError={Boolean(fieldErrors.code)}
                disabled={submitting}
                autoFocus={true}
              />
            )}
            {fieldErrors.code ? (
              <Text style={[styles.errorText, { color: colors.dangerText }]}>
                {fieldErrors.code}
              </Text>
            ) : null}

            {/* Alternância clara entre autenticador e recovery */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                useRecoveryCode
                  ? 'Usar aplicativo autenticador'
                  : 'Usar código de recuperação'
              }
              onPress={() => {
                setUseRecoveryCode((prev) => !prev);
                setMfaCode('');
                setFieldErrors({});
              }}
              style={styles.toggleModeButton}
            >
              <Text style={[styles.toggleModeText, { color: colors.brandPrimary }]}>
                {useRecoveryCode
                  ? '← Usar aplicativo autenticador'
                  : 'Não tem acesso ao celular? Usar código de recuperação'}
              </Text>
            </Pressable>
          </View>

          <PrimaryButton
            label="Verificar e entrar"
            onPress={handleVerifyMfa}
            loading={submitting}
            stepped
            style={{ marginTop: 4 }}
          />

          <PrimaryButton
            label="Voltar ao login"
            variant="ghost"
            onPress={handleCancelMfa}
            disabled={submitting}
          />
        </View>
      ) : (
        /* Formulário de Login Principal */
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

          {hasBiometricLock ? (
            <View style={styles.discreetBiometricWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={biometricButtonLabel}
                accessibilityHint="Desbloqueia o FuelLog com a biometria cadastrada neste aparelho"
                onPress={handleBiometricUnlock}
                disabled={biometricUnlocking}
                style={({ pressed }) => [
                  styles.discreetBiometricButton,
                  pressed && { opacity: 0.75, transform: [{ scale: 0.96 }] },
                ]}
              >
                <View
                  style={[
                    styles.biometricCircle,
                    {
                      backgroundColor: colors.brandSoft,
                      borderColor: colors.brandPrimary,
                    },
                  ]}
                >
                  {biometricUnlocking ? (
                    <ActivityIndicator size="small" color={colors.brandPrimary} />
                  ) : biometricDeviceInfo?.biometricType === 'face' ? (
                    <FaceIdIcon size={26} color={colors.brandPrimary} />
                  ) : (
                    <FingerprintIcon size={26} color={colors.brandPrimary} />
                  )}
                </View>
                <Text style={[styles.biometricLabelText, { color: colors.textPrimary }]}>
                  {biometricButtonLabel}
                </Text>
              </Pressable>

              {biometricNotice ? (
                <InlineNotice tone="info" message={biometricNotice} />
              ) : null}
            </View>
          ) : null}
        </View>
      )}

      {!mfaChallenge ? (
        <View style={styles.registerStack}>
          <Text style={[styles.noAccountText, { color: colors.textPrimary }]}>
            Ainda não tem conta?
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Criar conta"
            onPress={() => {
              resetTransientState();
              router.push('/register');
            }}
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
      ) : null}

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
    paddingBottom: 24,
  },
  heroTextWrap: {
    paddingTop: 14,
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
  toggleModeButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 2,
  },
  discreetBiometricWrap: {
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 4,
    gap: 12,
  },
  discreetBiometricButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
    gap: 8,
  },
  biometricCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  biometricLabelText: {
    ...typography.bodyStrong,
    fontSize: 14,
    textAlign: 'center',
  },
  toggleModeText: {
    ...typography.caption,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});


function FingerprintIcon({ size = 26, color = '#1D59F2' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2a10 10 0 0 0-8 4" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M20 6a10 10 0 0 0-4-3" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M12 6a6 6 0 0 0-5.66 4" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M17.66 10A6 6 0 0 0 12 6" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M12 10a2 2 0 0 0-2 2c0 4.5-2 6-2 6" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M14 12c0 3.5-1.5 5.5-2 8" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M16 14.5c0 3-1 5.5-1 6.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M8.5 14c-.3 1.5-.5 3-.5 4" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function FaceIdIcon({ size = 26, color = '#1D59F2' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 8V5a1 1 0 0 1 1-1h3" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M16 4h3a1 1 0 0 1 1 1v3" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M20 16v3a1 1 0 0 1-1 1h-3" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M8 20H5a1 1 0 0 1-1-1v-3" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M9 10h.01M15 10h.01" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <Path d="M9.5 15a3.5 3.5 0 0 0 5 0" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M12 11v2.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
