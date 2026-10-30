import { usePathname, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api/types';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { EyeIcon, LockIcon, MailIcon } from '@/components/icons/AppIcons';
import { OtpSixInput } from '@/components/inputs/OtpSixInput';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
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
  const [useBiometrics, setUseBiometrics] = useState(false);
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
    setUseBiometrics(false);
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
      const result = await signIn(
        { email: cleanEmail, password },
        { enableBiometrics: useBiometrics && Boolean(biometricDeviceInfo?.isSupported) },
      );

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

          {hasBiometricLock ? (
            <View
              style={[
                styles.biometricLockCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <View style={styles.biometricLockHeader}>
                <LockIcon size={22} color={colors.accentPrimary} />
                <View style={styles.biometricLockTextCol}>
                  <Text style={[styles.biometricLockTitle, { color: colors.textPrimary }]}>
                    Acesso rápido
                  </Text>
                  <Text style={[styles.biometricLockSub, { color: colors.textSecondary }]}>
                    Use sua biometria para entrar sem digitar senha.
                  </Text>
                </View>
              </View>

              {biometricNotice ? (
                <InlineNotice tone="info" message={biometricNotice} />
              ) : null}

              <PrimaryButton
                label={`Entrar com ${biometricLabel}`}
                onPress={handleBiometricUnlock}
                loading={biometricUnlocking}
                stepped
              />

              <View style={styles.biometricDividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: colors.borderSubtle }]} />
                <Text style={[styles.dividerText, { color: colors.textMuted }]}>
                  ou entre com e-mail e senha
                </Text>
                <View style={[styles.dividerLine, { backgroundColor: colors.borderSubtle }]} />
              </View>
            </View>
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

          {biometricDeviceInfo?.isSupported ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="Usar biometria neste aparelho"
              accessibilityState={{ checked: useBiometrics }}
              onPress={() => setUseBiometrics((prev) => !prev)}
              style={[
                styles.biometricToggleCard,
                {
                  backgroundColor: inputBg,
                  borderColor: useBiometrics ? colors.borderFocus : inputBorder,
                },
              ]}
            >
              <View style={styles.biometricToggleTextCol}>
                <Text style={[styles.biometricToggleTitle, { color: colors.textPrimary }]}>
                  Usar biometria neste aparelho
                </Text>
                <Text style={[styles.biometricToggleSubtitle, { color: colors.textSecondary }]}>
                  Entrar com {biometricLabel} nos próximos acessos
                </Text>
              </View>
              <Switch
                value={useBiometrics}
                onValueChange={setUseBiometrics}
                trackColor={{ false: colors.borderSubtle, true: colors.brandPrimary }}
                thumbColor={colors.surface}
                accessibilityLabel="Usar biometria neste aparelho"
              />
            </Pressable>
          ) : biometricDeviceInfo?.isExpoGoIos ? (
            <View style={styles.biometricNoticeWrap}>
              <InlineNotice
                tone="info"
                title="Face ID no iOS"
                message="A autenticação por Face ID requer build de desenvolvimento (development build) e não está disponível no Expo Go."
              />
            </View>
          ) : null}

          <PrimaryButton
            label="Entrar"
            onPress={handleSubmit}
            loading={submitting}
            stepped
            style={{ marginTop: 4 }}
          />
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
  toggleModeButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 2,
  },
  biometricLockCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    marginBottom: 4,
  },
  biometricLockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  biometricLockTextCol: {
    flex: 1,
    gap: 2,
  },
  biometricLockTitle: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
  biometricLockSub: {
    ...typography.body,
    fontSize: 13,
  },
  biometricDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    ...typography.caption,
    fontSize: 12,
  },
  biometricToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 12,
  },
  biometricToggleTextCol: {
    flex: 1,
    gap: 2,
  },
  biometricToggleTitle: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  biometricToggleSubtitle: {
    ...typography.caption,
    fontSize: 12,
  },
  biometricNoticeWrap: {
    marginVertical: 2,
  },
  toggleModeText: {
    ...typography.caption,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
