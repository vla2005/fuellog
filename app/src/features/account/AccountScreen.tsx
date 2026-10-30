import { useRouter } from 'expo-router';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { getTwoFactorStatus, updateMe } from '@/api/endpoints';
import { ApiError, TwoFactorStatus, UpdateMeRequest } from '@/api/types';
import { PixelMascot } from '@/components/brand/PixelMascot';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import {
  ChevronLeftIcon,
  EyeIcon,
  LockIcon,
  UserIcon,
} from '@/components/icons/AppIcons';
import { OtpSixInput } from '@/components/inputs/OtpSixInput';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { TabActiveContext } from '@/components/navigation/AuthenticatedTabShell';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export interface AccountScreenProps {
  embeddedInShell?: boolean;
}

export function AccountScreen({ embeddedInShell = false }: AccountScreenProps = {}) {
  const router = useRouter();
  const isTabActive = useContext(TabActiveContext);
  const { colors, isDark } = useAppTheme();
  const {
    user,
    updateUser,
    getCurrentSessionEpoch,
    showToast,
  } = useSession();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [secondFactorCode, setSecondFactorCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [twoFactorStatus, setTwoFactorStatus] = useState<TwoFactorStatus | null>(null);
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const statusGenRef = useRef(0);
  const submitGenRef = useRef(0);
  const initialLoadedRef = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;

  const resetFormToSavedUser = useCallback(() => {
    statusGenRef.current += 1;
    submitGenRef.current += 1;
    setSubmitting(false);
    const currentUser = userRef.current;
    setName(currentUser?.name ?? '');
    setEmail(currentUser?.email ?? '');
    setCurrentPassword('');
    setSecondFactorCode('');
    setUseRecoveryCode(false);
    setShowPassword(false);
    setFieldErrors({});
    setGeneralError(null);
  }, []);

  useEffect(() => {
    if (user && !initialLoadedRef.current) {
      setName(user.name ?? '');
      setEmail(user.email ?? '');
      initialLoadedRef.current = true;
    }
  }, [user]);

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
        setTwoFactorError('Não foi possível verificar status de segurança da conta.');
        setTwoFactorLoading(false);
      }
      return null;
    }
  }, [getCurrentSessionEpoch]);

  useEffect(() => {
    void check2FaStatus();
  }, [check2FaStatus]);

  const prevActiveRef = useRef(isTabActive);
  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = isTabActive;

    if (wasActive && !isTabActive) {
      resetFormToSavedUser();
    } else if (!wasActive && isTabActive) {
      resetFormToSavedUser();
      void check2FaStatus();
    }
  }, [check2FaStatus, isTabActive, resetFormToSavedUser]);

  useEffect(() => {
    return () => {
      resetFormToSavedUser();
    };
  }, [resetFormToSavedUser]);

  const currentEmailNormalized = (user?.email ?? '').trim().toLowerCase();
  const nextEmailNormalized = email.trim().toLowerCase();
  const isEmailChanged = nextEmailNormalized !== currentEmailNormalized;

  const handleBack = useCallback(() => {
    resetFormToSavedUser();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/settings');
    }
  }, [resetFormToSavedUser, router]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !isTabActive) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => {
      sub.remove();
    };
  }, [handleBack, isTabActive]);

  const handleSubmit = async () => {
    setGeneralError(null);
    setFieldErrors({});

    const epoch = getCurrentSessionEpoch();
    const submitGen = ++submitGenRef.current;

    const localErrors: Record<string, string> = {};
    const cleanName = name.trim();
    const cleanEmail = email.trim();

    if (!cleanName) {
      localErrors.name = 'Informe seu nome.';
    } else if (cleanName.length > 100) {
      localErrors.name = 'O nome deve ter no máximo 100 caracteres.';
    }

    if (!cleanEmail) {
      localErrors.email = 'Informe seu e-mail.';
    } else if (cleanEmail.length > 254) {
      localErrors.email = 'O e-mail deve ter no máximo 254 caracteres.';
    } else if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      localErrors.email = 'Informe um endereço de e-mail válido.';
    }

    let activeTwoFactor = twoFactorStatus;

    if (isEmailChanged) {
      if (activeTwoFactor === null) {
        setTwoFactorLoading(true);
        activeTwoFactor = await check2FaStatus();
        if (getCurrentSessionEpoch() !== epoch || submitGen !== submitGenRef.current) {
          return;
        }
        if (activeTwoFactor === null) {
          setGeneralError(
            'Não foi possível verificar os requisitos de segurança para alterar o e-mail. Tente novamente.',
          );
          return;
        }
      }

      if (!currentPassword) {
        localErrors.currentPassword = 'Informe sua senha atual para alterar o e-mail.';
      }
      if (activeTwoFactor.enabled) {
        const cleanMfa = secondFactorCode.trim();
        if (!cleanMfa) {
          localErrors.secondFactorCode = useRecoveryCode
            ? 'Informe o código de recuperação.'
            : 'Digite o código de 6 dígitos do autenticador.';
        } else if (!useRecoveryCode && !/^\d{6}$/.test(cleanMfa)) {
          localErrors.secondFactorCode = 'Digite o código de 6 dígitos do autenticador.';
        } else if (useRecoveryCode && cleanMfa.length !== 43) {
          localErrors.secondFactorCode = 'O código de recuperação deve ter 43 caracteres.';
        }
      }
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    const payload: UpdateMeRequest = {
      name: cleanName,
      email: cleanEmail,
    };
    if (isEmailChanged) {
      payload.currentPassword = currentPassword;
      if (activeTwoFactor?.enabled) {
        payload.secondFactorCode = secondFactorCode.trim();
      }
    }

    setSubmitting(true);
    try {
      const updated = await updateMe(payload);
      const isCurrentSubmit =
        getCurrentSessionEpoch() === epoch && submitGen === submitGenRef.current;
      const ok = updateUser(updated, epoch);
      if (!ok || !isCurrentSubmit) {
        return;
      }
      userRef.current = updated;
      setName(updated.name);
      setEmail(updated.email);
      setCurrentPassword('');
      setSecondFactorCode('');
      setShowPassword(false);
      setFieldErrors({});
      setGeneralError(null);
      showToast({
        tone: 'success',
        title: 'Alterações salvas',
        subtitle: 'Seus dados foram atualizados com sucesso.',
      });
    } catch (err: unknown) {
      if (getCurrentSessionEpoch() !== epoch || submitGen !== submitGenRef.current) {
        return;
      }
      if (err instanceof ApiError) {
        if (err.status === 409 || err.problem?.code === 'ACCOUNT_CONFLICT') {
          const emailErr =
            err.problem?.fieldErrors?.email ||
            err.message ||
            'Este e-mail já está em uso por outra conta.';
          setFieldErrors((prev) => ({ ...prev, email: emailErr }));
          setGeneralError('Este e-mail já está cadastrado em outra conta.');
        } else if (err.status === 422 || err.problem?.code === 'VALIDATION_ERROR') {
          const mapped: Record<string, string> = {};
          if (err.problem?.fieldErrors) {
            for (const [k, v] of Object.entries(err.problem.fieldErrors)) {
              if (k === 'code') {
                mapped.secondFactorCode = v;
              } else {
                mapped[k] = v;
              }
            }
          }
          if (err.problem?.code === 'MFA_INVALID_CODE' && !mapped.secondFactorCode) {
            mapped.secondFactorCode = err.message || 'Código de autenticação inválido.';
          }
          setFieldErrors((prev) => ({ ...prev, ...mapped }));
          setGeneralError(err.message || 'Verifique os campos destacados e tente novamente.');
        } else if (err.problem?.code === 'MFA_INVALID_CODE') {
          setFieldErrors((prev) => ({
            ...prev,
            secondFactorCode:
              err.problem?.fieldErrors?.code ||
              err.message ||
              'Código de autenticação inválido.',
          }));
          setGeneralError(err.message || 'Código de autenticação inválido.');
        } else {
          setGeneralError(err.message || 'Não foi possível salvar as alterações.');
        }
      } else if (err instanceof Error) {
        setGeneralError(err.message);
      } else {
        setGeneralError('Falha de rede ou comunicação com o servidor.');
      }
    } finally {
      if (getCurrentSessionEpoch() === epoch && submitGen === submitGenRef.current) {
        setSubmitting(false);
      }
    }
  };

  const inputBg = colors.bgElevated;
  const inputBorder = colors.borderSubtle;

  return (
    <ScreenShell
      withDockClearance={false}
      omitTopSafeArea={false}
    >
      <View style={styles.container}>
        {/* Top Back Action */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          testID="account-back-button"
          onPress={handleBack}
          style={styles.backButtonRow}
        >
          <ChevronLeftIcon size={18} color={colors.brandPrimary} />
          <Text style={[styles.backButtonText, { color: colors.brandPrimary }]}>
            Voltar
          </Text>
        </Pressable>

        {/* Screen Title & Subtitle */}
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>
          Conta
        </Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
          Visualize e atualize suas informações cadastrais.
        </Text>

        {/* Mascot Avatar Card */}
        <View
          style={[
            styles.avatarCard,
            {
              backgroundColor: colors.bgElevated,
              borderColor: colors.borderDefault,
            },
          ]}
        >
          <PixelMascot variant="avatar" size={56} withFrame />
          <View style={styles.avatarInfoCol}>
            <Text
              style={[styles.avatarCardName, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {user?.name || 'Motorista FuelLog'}
            </Text>
            <Text
              style={[styles.avatarCardEmail, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {user?.email || 'email@exemplo.com'}
            </Text>
          </View>
        </View>

        {/* Form Fields */}
        <View style={styles.formSection}>
          {/* Campo: Nome */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>
              Nome completo
            </Text>
            <View
              style={[
                styles.inputWrapper,
                {
                  backgroundColor: inputBg,
                  borderColor: fieldErrors.name ? colors.statusDanger : inputBorder,
                },
              ]}
            >
              <UserIcon size={18} color={colors.textSecondary} />
              <TextInput
                testID="account-name-input"
                accessibilityLabel="Nome completo"
                value={name}
                onChangeText={setName}
                placeholder="Seu nome"
                placeholderTextColor={colors.textSecondary}
                editable={!submitting}
                style={[styles.textInput, { color: colors.textPrimary }]}
              />
            </View>
            {fieldErrors.name ? (
              <Text style={[styles.errorText, { color: colors.statusDanger }]}>
                {fieldErrors.name}
              </Text>
            ) : null}
          </View>

          {/* Campo: E-mail */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>
              E-mail
            </Text>
            <View
              style={[
                styles.inputWrapper,
                {
                  backgroundColor: inputBg,
                  borderColor: fieldErrors.email ? colors.statusDanger : inputBorder,
                },
              ]}
            >
              <LockIcon size={18} color={colors.textSecondary} />
              <TextInput
                testID="account-email-input"
                accessibilityLabel="E-mail"
                value={email}
                onChangeText={setEmail}
                placeholder="voce@email.com"
                placeholderTextColor={colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!submitting}
                style={[styles.textInput, { color: colors.textPrimary }]}
              />
            </View>
            {fieldErrors.email ? (
              <Text style={[styles.errorText, { color: colors.statusDanger }]}>
                {fieldErrors.email}
              </Text>
            ) : null}
          </View>

          {/* Seção Condicional de Confirmação para Troca de E-mail */}
          {isEmailChanged ? (
            <View style={styles.securityConfirmationBox}>
              <InlineNotice
                tone="warning"
                title="Confirmação de segurança"
                message="Para alterar o e-mail da sua conta, informe sua senha atual."
              />

              {twoFactorLoading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.accentPrimary} />
                  <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                    Verificando requisitos de segurança...
                  </Text>
                </View>
              ) : twoFactorError ? (
                <InlineNotice
                  tone="warning"
                  title="Verificação necessária"
                  message={twoFactorError}
                  action={
                    <PrimaryButton
                      label="Tentar verificar novamente"
                      variant="secondary"
                      onPress={() => void check2FaStatus()}
                    />
                  }
                />
              ) : null}

              {/* Senha atual */}
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>
                  Senha atual
                </Text>
                <View
                  style={[
                    styles.inputWrapper,
                    {
                      backgroundColor: inputBg,
                      borderColor: fieldErrors.currentPassword
                        ? colors.statusDanger
                        : inputBorder,
                    },
                  ]}
                >
                  <LockIcon size={18} color={colors.textSecondary} />
                  <TextInput
                    testID="account-current-password-input"
                    accessibilityLabel="Senha atual"
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    placeholder="Digite sua senha atual"
                    placeholderTextColor={colors.textSecondary}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="current-password"
                    editable={!submitting}
                    style={[styles.textInput, { color: colors.textPrimary }]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      showPassword ? 'Ocultar senha atual' : 'Mostrar senha atual'
                    }
                    onPress={() => setShowPassword((prev) => !prev)}
                    style={styles.eyeBtn}
                  >
                    <EyeIcon size={18} color={colors.textSecondary} />
                  </Pressable>
                </View>
                {fieldErrors.currentPassword ? (
                  <Text style={[styles.errorText, { color: colors.statusDanger }]}>
                    {fieldErrors.currentPassword}
                  </Text>
                ) : null}
              </View>

              {/* 2FA caso ativo */}
              {twoFactorStatus?.enabled ? (
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>
                    {useRecoveryCode
                      ? 'Código de recuperação'
                      : 'Código de autenticação (2FA)'}
                  </Text>
                  <Text
                    style={[styles.fieldSubLabel, { color: colors.textSecondary }]}
                  >
                    {useRecoveryCode
                      ? 'Informe um código reserva de 43 caracteres.'
                      : 'Abra seu app autenticador e digite o código de 6 dígitos.'}
                  </Text>

                  {useRecoveryCode ? (
                    <View
                      style={[
                        styles.inputWrapper,
                        {
                          backgroundColor: inputBg,
                          borderColor: fieldErrors.secondFactorCode
                            ? colors.statusDanger
                            : inputBorder,
                        },
                      ]}
                    >
                      <LockIcon size={18} color={colors.textSecondary} />
                      <TextInput
                        testID="account-recovery-input"
                        accessibilityLabel="Código de recuperação"
                        value={secondFactorCode}
                        onChangeText={setSecondFactorCode}
                        placeholder="Cole seu código de 43 caracteres"
                        placeholderTextColor={colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!submitting}
                        style={[styles.textInput, { color: colors.textPrimary }]}
                      />
                    </View>
                  ) : (
                    <OtpSixInput
                      testID="account-otp-input"
                      value={secondFactorCode}
                      onChange={setSecondFactorCode}
                      accessibilityLabel="Código de 6 dígitos"
                      hasError={Boolean(fieldErrors.secondFactorCode)}
                      disabled={submitting}
                    />
                  )}

                  {fieldErrors.secondFactorCode ? (
                    <Text
                      style={[styles.errorText, { color: colors.statusDanger }]}
                    >
                      {fieldErrors.secondFactorCode}
                    </Text>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      useRecoveryCode
                        ? 'Usar aplicativo autenticador'
                        : 'Usar código de recuperação'
                    }
                    onPress={() => {
                      setUseRecoveryCode((prev) => !prev);
                      setSecondFactorCode('');
                      setFieldErrors((prev) => {
                        const copy = { ...prev };
                        delete copy.secondFactorCode;
                        return copy;
                      });
                    }}
                    style={styles.toggleRecoveryBtn}
                  >
                    <Text
                      style={[
                        styles.toggleRecoveryText,
                        { color: colors.brandPrimary },
                      ]}
                    >
                      {useRecoveryCode
                        ? '← Usar aplicativo autenticador'
                        : 'Não tem acesso ao autenticador? Usar código de recuperação'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* General Error Notice */}
          {generalError ? (
            <InlineNotice
              tone="danger"
              title="Aviso"
              message={generalError}
            />
          ) : null}

          {/* Action Button: Salvar alterações */}
          <PrimaryButton
            testID="account-save-button"
            label="Salvar alterações"
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting}
            stepped
            style={{ marginTop: 8, marginBottom: 24 }}
          />
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    paddingTop: 8,
  },
  backButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    minHeight: 44,
  },
  backButtonText: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  screenTitle: {
    ...typography.screenTitle,
    fontSize: 28,
    fontWeight: '800',
    paddingVertical: 2,
  },
  sectionSubtitle: {
    ...typography.body,
    fontSize: 14,
    marginBottom: 4,
  },
  avatarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    marginVertical: 4,
  },
  avatarInfoCol: {
    flex: 1,
    gap: 3,
  },
  avatarCardName: {
    ...typography.sectionTitle,
    fontSize: 18,
    fontWeight: '700',
  },
  avatarCardEmail: {
    ...typography.body,
    fontSize: 13,
  },
  formSection: {
    gap: 16,
    marginTop: 6,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  fieldSubLabel: {
    ...typography.caption,
    fontSize: 13,
    marginBottom: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    minHeight: 48,
    gap: 10,
  },
  textInput: {
    ...typography.body,
    fontSize: 15,
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
  },
  eyeBtn: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 44,
    minHeight: 44,
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  securityConfirmationBox: {
    gap: 14,
    paddingVertical: 8,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  loadingText: {
    ...typography.caption,
    fontSize: 13,
  },
  toggleRecoveryBtn: {
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  toggleRecoveryText: {
    ...typography.bodyStrong,
    fontSize: 13,
  },
});
