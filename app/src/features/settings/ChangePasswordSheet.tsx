import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { changePassword } from '@/api/endpoints';
import { ApiError } from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { EyeIcon, LockIcon } from '@/components/icons/AppIcons';
import { OtpSixInput } from '@/components/inputs/OtpSixInput';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export interface ChangePasswordSheetProps {
  visible: boolean;
  onClose: () => void;
  isTwoFactorEnabled: boolean;
}

export function ChangePasswordSheet({
  visible,
  onClose,
  isTwoFactorEnabled,
}: ChangePasswordSheetProps) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { handlePasswordChanged, getCurrentSessionEpoch, showToast } = useSession();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [secondFactorCode, setSecondFactorCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Limpeza de segredos em memória ao desmontar ou fechar
  const handleClearSecrets = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setSecondFactorCode('');
    setUseRecoveryCode(false);
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
    setErrorMessage(null);
    setFieldErrors({});
  };

  useEffect(() => {
    if (!visible) {
      handleClearSecrets();
    }
    return () => {
      handleClearSecrets();
    };
  }, [visible]);

  const handleSubmit = async () => {
    setErrorMessage(null);
    setFieldErrors({});

    const localErrors: Record<string, string> = {};

    if (!currentPassword) {
      localErrors.currentPassword = 'Informe sua senha atual.';
    }

    if (!newPassword) {
      localErrors.newPassword = 'A nova senha deve ter entre 6 e 128 caracteres.';
    } else if (newPassword.length < 6 || newPassword.length > 128) {
      localErrors.newPassword = 'A nova senha deve ter entre 6 e 128 caracteres.';
    } else if (newPassword === currentPassword) {
      localErrors.newPassword = 'A nova senha deve ser diferente da senha atual.';
    }

    if (!confirmPassword) {
      localErrors.confirmPassword = 'Confirme sua nova senha.';
    } else if (confirmPassword !== newPassword) {
      localErrors.confirmPassword = 'A confirmação não coincide com a nova senha.';
    }

    if (isTwoFactorEnabled) {
      const cleanMfa = secondFactorCode.trim();
      if (!cleanMfa) {
        localErrors.secondFactorCode = useRecoveryCode
          ? 'Informe o código de recuperação.'
          : 'Digite o código de 6 dígitos do autenticador.';
      } else if (!useRecoveryCode && !/^\d{6}$/.test(cleanMfa)) {
        localErrors.secondFactorCode = 'Digite o código de 6 dígitos do autenticador.';
      }
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    setSubmitting(true);
    const expectedEpoch = getCurrentSessionEpoch();

    try {
      await changePassword({
        currentPassword,
        newPassword,
        secondFactorCode: isTwoFactorEnabled ? secondFactorCode.trim() : undefined,
      });

      // Sucesso revoga todas as sessões inclusive atual: limpa estado/tokens SEM enviar logout agora revogado
      const ok = await handlePasswordChanged(expectedEpoch);
      if (!ok) {
        return;
      }
      handleClearSecrets();
      onClose();

      showToast({
        tone: 'success',
        title: 'Senha alterada com sucesso',
        subtitle: 'Todas as sessões foram encerradas. Entre novamente com sua nova senha.',
      });

      router.replace('/login');
    } catch (err: unknown) {
      if (getCurrentSessionEpoch() !== expectedEpoch) {
        return;
      }
      // Preserva digitado em falhas e não persiste em storage/logs
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
        const mappedErrors: Record<string, string> = {};
        if (err.problem?.fieldErrors) {
          for (const [key, value] of Object.entries(err.problem.fieldErrors)) {
            if (key === 'code') {
              mappedErrors.secondFactorCode = value;
            } else {
              mappedErrors[key] = value;
            }
          }
        }
        setFieldErrors(mappedErrors);
      } else {
        setErrorMessage('Não foi possível alterar sua senha. Tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSafeClose = () => {
    if (submitting) {
      return;
    }
    handleClearSecrets();
    onClose();
  };

  const inputBg = colors.surface;
  const inputBorder = colors.borderSubtle;

  return (
    <AppSheet
      visible={visible}
      title="Trocar senha"
      subtitle="Atualização da credencial de acesso"
      onClose={handleSafeClose}
    >
      <View style={styles.formContainer}>
        {errorMessage ? (
          <InlineNotice tone="danger" message={errorMessage} />
        ) : null}

        {/* Senha atual */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>
            Senha atual
          </Text>
          <View
            style={[
              styles.inputRow,
              {
                backgroundColor: inputBg,
                borderColor: fieldErrors.currentPassword
                  ? colors.dangerBorder
                  : inputBorder,
              },
            ]}
          >
            <LockIcon size={20} color={colors.accentPrimary} />
            <TextInput
              accessibilityLabel="Senha atual"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showCurrent}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              style={[styles.textInput, { color: colors.textPrimary }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showCurrent ? 'Ocultar senha atual' : 'Mostrar senha atual'}
              onPress={() => setShowCurrent((prev) => !prev)}
              style={styles.eyeButton}
            >
              <EyeIcon size={20} color={colors.textSecondary} off={showCurrent} />
            </Pressable>
          </View>
          {fieldErrors.currentPassword ? (
            <Text style={[styles.errorText, { color: colors.dangerText }]}>
              {fieldErrors.currentPassword}
            </Text>
          ) : null}
        </View>

        {/* Nova senha */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>
            Nova senha
          </Text>
          <View
            style={[
              styles.inputRow,
              {
                backgroundColor: inputBg,
                borderColor: fieldErrors.newPassword
                  ? colors.dangerBorder
                  : inputBorder,
              },
            ]}
          >
            <LockIcon size={20} color={colors.accentPrimary} />
            <TextInput
              accessibilityLabel="Nova senha"
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showNew}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              style={[styles.textInput, { color: colors.textPrimary }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showNew ? 'Ocultar nova senha' : 'Mostrar nova senha'}
              onPress={() => setShowNew((prev) => !prev)}
              style={styles.eyeButton}
            >
              <EyeIcon size={20} color={colors.textSecondary} off={showNew} />
            </Pressable>
          </View>
          {fieldErrors.newPassword ? (
            <Text style={[styles.errorText, { color: colors.dangerText }]}>
              {fieldErrors.newPassword}
            </Text>
          ) : (
            <Text style={[styles.helperText, { color: colors.textMuted }]}>
              Entre 6 e 128 caracteres. Deve ser diferente da senha atual.
            </Text>
          )}
        </View>

        {/* Confirmação da nova senha */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>
            Confirmar nova senha
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
              accessibilityLabel="Confirmar nova senha"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              style={[styles.textInput, { color: colors.textPrimary }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showConfirm ? 'Ocultar confirmação' : 'Mostrar confirmação'}
              onPress={() => setShowConfirm((prev) => !prev)}
              style={styles.eyeButton}
            >
              <EyeIcon size={20} color={colors.textSecondary} off={showConfirm} />
            </Pressable>
          </View>
          {fieldErrors.confirmPassword ? (
            <Text style={[styles.errorText, { color: colors.dangerText }]}>
              {fieldErrors.confirmPassword}
            </Text>
          ) : null}
        </View>

        {/* Segundo fator quando 2FA ativo */}
        {isTwoFactorEnabled ? (
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
                    borderColor: fieldErrors.secondFactorCode
                      ? colors.dangerBorder
                      : inputBorder,
                  },
                ]}
              >
                <LockIcon size={20} color={colors.accentPrimary} />
                <TextInput
                  accessibilityLabel="Código de recuperação"
                  value={secondFactorCode}
                  onChangeText={setSecondFactorCode}
                  placeholder="Cole seu código de 43 caracteres"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.textInput, { color: colors.textPrimary }]}
                />
              </View>
            ) : (
              <OtpSixInput
                value={secondFactorCode}
                onChange={setSecondFactorCode}
                accessibilityLabel="Código de 6 dígitos"
                hasError={Boolean(fieldErrors.secondFactorCode)}
                disabled={submitting}
              />
            )}
            {fieldErrors.secondFactorCode ? (
              <Text style={[styles.errorText, { color: colors.dangerText }]}>
                {fieldErrors.secondFactorCode}
              </Text>
            ) : (
              <Text style={[styles.helperText, { color: colors.textMuted }]}>
                {useRecoveryCode
                  ? 'Informe seu código de recuperação de 43 caracteres.'
                  : 'Informe o código de 6 dígitos gerado pelo Google Authenticator.'}
              </Text>
            )}

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
                setSecondFactorCode('');
                setFieldErrors((prev) => ({ ...prev, secondFactorCode: '' }));
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
        ) : null}

        <View style={styles.actionWrap}>
          <PrimaryButton
            label="Atualizar senha"
            onPress={handleSubmit}
            loading={submitting}
            stepped
          />
        </View>
      </View>
    </AppSheet>
  );
}

const styles = StyleSheet.create({
  formContainer: {
    paddingVertical: 12,
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
  actionWrap: {
    marginTop: 8,
  },
  toggleModeButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 2,
  },
  toggleModeText: {
    ...typography.caption,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
