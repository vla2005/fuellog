import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { requestRegistrationCode } from '@/api/endpoints';
import { ApiError, RegistrationCodeResponse } from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import {
  EyeIcon,
  LockIcon,
  MailIcon,
  UserIcon,
} from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { OtpSixInput } from '@/components/inputs/OtpSixInput';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { AuthSceneHero } from '@/features/auth/AuthSceneHero';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export function RegisterScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { signUpAndSignIn, showToast, getCurrentSessionEpoch } = useSession();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [registration, setRegistration] = useState<{
    name: string; email: string; password: string; verification: RegistrationCodeResponse;
  } | null>(null);
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!registration) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [registration]);
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const expired = registration ? now >= Date.parse(registration.verification.expiresAt) : false;
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
    if (busy.current) return;
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

    if (password.length < 6 || password.length > 128) {
      localErrors.password = 'A senha deve ter entre 6 e 128 caracteres.';
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    await sendCode({ name: cleanName, email: cleanEmail, password });
  };

  const sendCode = async (details: { name: string; email: string; password: string }) => {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    const epoch = getCurrentSessionEpoch();
    try {
      const verification = await requestRegistrationCode(details.email);
      if (!mounted.current || getCurrentSessionEpoch() !== epoch) return;
      setRegistration({ ...details, verification });
      setCode('');
      setNow(Date.now());
      setResendAt(Date.now() + verification.resendAfterSeconds * 1000);
      Keyboard.dismiss();
    } catch (err) {
      if (!mounted.current || getCurrentSessionEpoch() !== epoch) return;
      setErrorMessage(err instanceof ApiError ? err.message : 'Não foi possível enviar o código. Tente novamente.');
      if (err instanceof ApiError && err.problem?.fieldErrors) setFieldErrors(err.problem.fieldErrors);
    } finally {
      busy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  const confirmRegistration = async () => {
    if (busy.current || !registration || !/^[0-9]{6}$/.test(code) || Date.now() >= Date.parse(registration.verification.expiresAt)) return;
    busy.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await signUpAndSignIn({
        name: registration.name, email: registration.email, password: registration.password,
        verificationId: registration.verification.verificationId, code,
      });
      if (!mounted.current) return;

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
        subtitle: `Bem-vindo ao FuelLog, ${registration.name}!`,
      });
      router.replace('/');
    } catch (err: unknown) {
      if (!mounted.current) return;
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
        if (err.problem?.fieldErrors) {
          setFieldErrors(err.problem.fieldErrors);
        }
      } else {
        setErrorMessage('Não foi possível concluir o cadastro. Tente novamente.');
      }
    } finally {
      busy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  const inputBg = colors.surface;
  const inputBorder = colors.borderSubtle;

  return (
    <ScreenShell
      transitionKey={registration ? 'register-code' : 'register-details'}
      transitionOrder={registration ? 1 : 0}
      omitTopSafeArea
      fullBleedHero={
        <AuthSceneHero
          mode="register"
          onBack={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/login');
            }
          }}
        />
      }
      contentContainerStyle={styles.scrollContent}
    >
      <Pressable
        onPress={Keyboard.dismiss}
        accessible={false}
        style={styles.heroTextWrap}
      >
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>
          {registration ? 'Confirme seu e-mail' : 'Criar conta'}
        </Text>
        <Text style={[styles.screenSubtitle, { color: colors.textSecondary }]}>
          {registration ? `Enviamos um código de 6 dígitos para ${registration.email}.` : 'Acompanhe seus gastos com precisão.'}
        </Text>
      </Pressable>

      {/* Form Fields directly on canvas: Nome, E-mail, Senha */}
      <View style={styles.formSection}>
        {errorMessage ? (
          <InlineNotice tone="danger" message={errorMessage} />
        ) : null}

        {registration ? (
          <>
            <OtpSixInput
              value={code}
              onChange={setCode}
              accessibilityLabel="Código de verificação do e-mail"
              hasError={Boolean(errorMessage)}
              disabled={submitting}
              autoFocus
            />
            <Text style={[styles.helperText, { color: expired ? colors.dangerText : colors.textSecondary }]}>
              {expired ? 'Código expirado. Solicite um novo para continuar.' : 'O código vale por 10 minutos. Confira também sua caixa de spam.'}
            </Text>
            <PrimaryButton
              label="Confirmar e criar conta"
              onPress={confirmRegistration}
              loading={submitting}
              disabled={code.length !== 6 || expired}
              stepped
            />
            <PrimaryButton
              label={resendSeconds > 0 ? `Reenviar em ${resendSeconds}s` : 'Reenviar código'}
              variant="secondary"
              disabled={submitting || resendSeconds > 0}
              onPress={() => { if (Date.now() >= resendAt) void sendCode(registration); }}
            />
            <PrimaryButton
              label="Alterar dados"
              variant="ghost"
              disabled={submitting}
              onPress={() => {
                if (busy.current) return;
                setRegistration(null); setCode(''); setErrorMessage(null); setFieldErrors({});
              }}
            />
          </>
        ) : (
          <>
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
                  editable={!submitting}
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
                  editable={!submitting}
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
                  editable={!submitting}
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
                  Mínimo de 6 caracteres.
                </Text>
              )}
            </View>

            <PrimaryButton
              label="Criar conta"
              onPress={handleSubmit}
              loading={submitting}
              stepped
              style={{ marginTop: 4 }}
            />
          </>
        )}
      </View>

      {/* Legal & Login links */}
      <View style={styles.bottomLinksBlock}>
        <View style={styles.legalCenteredRow}>
          <Text style={[styles.legalText, { color: colors.textSecondary }]}>
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
          <Text style={[styles.legalText, { color: colors.textSecondary }]}> e </Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Política de Privacidade"
            onPress={() => openLegalDocument('privacy')}
          >
            <Text style={[styles.legalLink, { color: colors.accentPrimary }]}>
              Política de Privacidade
            </Text>
          </Pressable>
          <Text style={[styles.legalText, { color: colors.textSecondary }]}>.</Text>
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
  helperText: {
    ...typography.caption,
    fontSize: 12,
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
  },
  bottomLinksBlock: {
    marginTop: 24,
    alignItems: 'center',
    gap: 12,
  },
  legalCenteredRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  legalText: {
    ...typography.caption,
    fontSize: 12,
  },
  legalLink: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
  },
  loginInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  alreadyText: {
    ...typography.body,
    fontSize: 14,
  },
  loginAction: {
    minHeight: 30,
    justifyContent: 'center',
  },
  loginActionText: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
});
