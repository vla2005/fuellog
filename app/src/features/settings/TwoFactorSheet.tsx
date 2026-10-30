import React, { useCallback, useEffect, useRef, useState } from 'react';
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

import {
  disableTwoFactor,
  enableTwoFactor,
  getTwoFactorStatus,
  setupTwoFactor,
} from '@/api/endpoints';
import {
  ApiError,
  TwoFactorRecoveryCodes,
  TwoFactorSetupResponse,
  TwoFactorStatus,
} from '@/api/types';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { CheckIcon, EyeIcon, LockIcon } from '@/components/icons/AppIcons';
import { OtpSixInput } from '@/components/inputs/OtpSixInput';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';
import { copyToClipboard } from '@/utils/clipboard';

import { QrCodeView } from './QrCodeView';

export interface TwoFactorSheetProps {
  visible: boolean;
  onClose: () => void;
  onStatusChanged?: (enabled: boolean) => void;
}

type SheetMode = 'status' | 'setup_password' | 'setup_qr' | 'setup_recovery' | 'disable';

export function TwoFactorSheet({
  visible,
  onClose,
  onStatusChanged,
}: TwoFactorSheetProps) {
  const { colors } = useAppTheme();
  const { showToast, getCurrentSessionEpoch } = useSession();

  const [mode, setMode] = useState<SheetMode>('status');
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const flowGenRef = useRef(0);
  const isVisibleRef = useRef(visible);
  isVisibleRef.current = visible;
  const onStatusChangedRef = useRef(onStatusChanged);
  onStatusChangedRef.current = onStatusChanged;

  // Campos temporários em memória (limpos ao cancelar/concluir/desmontar)
  const [currentPassword, setCurrentPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [confirmedSavedCodes, setConfirmedSavedCodes] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [copiedKeyNotice, setCopiedKeyNotice] = useState(false);
  const [copiedCodesNotice, setCopiedCodesNotice] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [disableWithRecovery, setDisableWithRecovery] = useState(false);

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCopyTimeout = () => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
  };

  const clearSecretsInMemory = useCallback(() => {
    flowGenRef.current += 1;
    clearCopyTimeout();
    setCurrentPassword('');
    setShowPassword(false);
    setTotpCode('');
    setSetupData(null);
    setRecoveryCodes([]);
    setConfirmedSavedCodes(false);
    setSubmitting(false);
    setErrorMessage(null);
    setFieldErrors({});
    setCopiedKeyNotice(false);
    setCopiedCodesNotice(false);
    setCopyError(null);
    setDisableWithRecovery(false);
  }, []);

  const fetchStatus = useCallback(async () => {
    const epoch = getCurrentSessionEpoch();
    const gen = ++flowGenRef.current;
    setLoadingStatus(true);
    setStatusError(null);
    try {
      const data = await getTwoFactorStatus();
      if (
        getCurrentSessionEpoch() === epoch &&
        flowGenRef.current === gen &&
        isVisibleRef.current
      ) {
        setStatus(data);
        setLoadingStatus(false);
        onStatusChangedRef.current?.(data.enabled);
      }
    } catch (err: unknown) {
      if (
        getCurrentSessionEpoch() === epoch &&
        flowGenRef.current === gen &&
        isVisibleRef.current
      ) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Não foi possível consultar o status da autenticação em duas etapas.';
        setStatusError(msg);
        setLoadingStatus(false);
      }
    }
  }, [getCurrentSessionEpoch]);

  useEffect(() => {
    if (visible) {
      setMode('status');
      void fetchStatus();
    } else {
      clearSecretsInMemory();
    }
    return () => {
      clearSecretsInMemory();
    };
  }, [clearSecretsInMemory, fetchStatus, visible]);

  // Intercepta botão voltar do Android na tela de códigos de recuperação até confirmar salvamento
  useEffect(() => {
    if (
      Platform.OS !== 'android' ||
      !visible ||
      mode !== 'setup_recovery' ||
      confirmedSavedCodes
    ) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setErrorMessage(
        'Atenção: Os códigos de recuperação são exibidos apenas agora. Marque a confirmação de que os guardou antes de sair.',
      );
      return true;
    });
    return () => {
      sub.remove();
    };
  }, [confirmedSavedCodes, mode, visible]);

  const handleSafeClose = () => {
    if (submitting) {
      return;
    }
    if (mode === 'setup_recovery' && !confirmedSavedCodes) {
      setErrorMessage(
        'Atenção: Os códigos de recuperação são exibidos apenas agora. Marque a confirmação de que os guardou antes de fechar.',
      );
      return;
    }
    clearSecretsInMemory();
    onClose();
  };

  const handleStartSetup = () => {
    clearSecretsInMemory();
    setMode('setup_password');
  };

  const handleStartDisable = () => {
    clearSecretsInMemory();
    setMode('disable');
  };

  const handleCancelFlow = () => {
    clearSecretsInMemory();
    setMode('status');
  };

  // 1. Setup - Passo 1: Enviar senha atual para obter segredo e QR
  const handleSubmitSetupPassword = async () => {
    setErrorMessage(null);
    setFieldErrors({});
    if (!currentPassword) {
      setFieldErrors({ currentPassword: 'Informe sua senha atual.' });
      return;
    }

    const epoch = getCurrentSessionEpoch();
    const gen = ++flowGenRef.current;
    setSubmitting(true);
    try {
      const res = await setupTwoFactor({ currentPassword });
      if (
        getCurrentSessionEpoch() !== epoch ||
        flowGenRef.current !== gen ||
        !isVisibleRef.current
      ) {
        return;
      }
      setSetupData(res);
      setCurrentPassword(''); // Limpa a senha da memória imediatamente após uso
      setMode('setup_qr');
    } catch (err: unknown) {
      if (
        getCurrentSessionEpoch() !== epoch ||
        flowGenRef.current !== gen ||
        !isVisibleRef.current
      ) {
        return;
      }
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
        if (err.problem?.fieldErrors) {
          setFieldErrors(err.problem.fieldErrors);
        }
      } else {
        setErrorMessage('Não foi possível iniciar a configuração. Tente novamente.');
      }
    } finally {
      if (
        getCurrentSessionEpoch() === epoch &&
        flowGenRef.current === gen &&
        isVisibleRef.current
      ) {
        setSubmitting(false);
      }
    }
  };

  // 2. Setup - Passo 2: Confirmar código de 6 dígitos para habilitar 2FA
  const handleSubmitEnableCode = async () => {
    setErrorMessage(null);
    setFieldErrors({});

    const cleanCode = totpCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setFieldErrors({ code: 'Digite o código de 6 dígitos do autenticador.' });
      return;
    }

    const epoch = getCurrentSessionEpoch();
    const gen = ++flowGenRef.current;
    setSubmitting(true);
    try {
      const res: TwoFactorRecoveryCodes = await enableTwoFactor({ code: cleanCode });
      if (
        getCurrentSessionEpoch() !== epoch ||
        flowGenRef.current !== gen ||
        !isVisibleRef.current
      ) {
        return;
      }
      setTotpCode('');
      setRecoveryCodes(res.recoveryCodes);
      setMode('setup_recovery');
    } catch (err: unknown) {
      if (
        getCurrentSessionEpoch() !== epoch ||
        flowGenRef.current !== gen ||
        !isVisibleRef.current
      ) {
        return;
      }
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
        if (err.problem?.fieldErrors) {
          setFieldErrors(err.problem.fieldErrors);
        }
      } else {
        setErrorMessage('Código inválido ou expirado. Tente novamente.');
      }
    } finally {
      if (
        getCurrentSessionEpoch() === epoch &&
        flowGenRef.current === gen &&
        isVisibleRef.current
      ) {
        setSubmitting(false);
      }
    }
  };

  // 3. Setup - Passo 3: Concluir após usuário confirmar ter guardado os códigos
  const handleFinishSetup = async () => {
    if (!confirmedSavedCodes) {
      setErrorMessage('Marque a confirmação de que guardou seus códigos de recuperação.');
      return;
    }
    const epoch = getCurrentSessionEpoch();
    const gen = ++flowGenRef.current;
    clearSecretsInMemory();
    setMode('status');
    await fetchStatus();
    if (
      getCurrentSessionEpoch() === epoch &&
      flowGenRef.current === gen &&
      isVisibleRef.current
    ) {
      showToast({
        tone: 'success',
        title: '2FA ativado com sucesso',
        subtitle: 'Sua conta agora está protegida com autenticação em duas etapas.',
      });
    }
  };

  // 4. Disable: Desativar com senha atual e código (TOTP ou recovery)
  const handleSubmitDisable = async () => {
    setErrorMessage(null);
    setFieldErrors({});

    const localErrors: Record<string, string> = {};
    if (!currentPassword) {
      localErrors.currentPassword = 'Informe sua senha atual.';
    }
    const cleanCode = totpCode.trim();
    if (!cleanCode) {
      localErrors.code = disableWithRecovery
        ? 'Informe o código de recuperação.'
        : 'Digite o código de 6 dígitos do autenticador.';
    } else if (!disableWithRecovery && !/^\d{6}$/.test(cleanCode)) {
      localErrors.code = 'Digite o código de 6 dígitos do autenticador.';
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    const epoch = getCurrentSessionEpoch();
    const gen = ++flowGenRef.current;
    setSubmitting(true);
    try {
      await disableTwoFactor({
        currentPassword,
        code: cleanCode,
      });
      if (
        getCurrentSessionEpoch() !== epoch ||
        flowGenRef.current !== gen ||
        !isVisibleRef.current
      ) {
        return;
      }
      clearSecretsInMemory();
      setMode('status');
      await fetchStatus();
      if (
        getCurrentSessionEpoch() === epoch &&
        flowGenRef.current === gen &&
        isVisibleRef.current
      ) {
        showToast({
          tone: 'info',
          title: '2FA desativado',
          subtitle: 'A verificação em duas etapas foi removida da sua conta.',
        });
      }
    } catch (err: unknown) {
      if (
        getCurrentSessionEpoch() !== epoch ||
        flowGenRef.current !== gen ||
        !isVisibleRef.current
      ) {
        return;
      }
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
        if (err.problem?.fieldErrors) {
          setFieldErrors(err.problem.fieldErrors);
        }
      } else {
        setErrorMessage('Não foi possível desativar a verificação em duas etapas.');
      }
    } finally {
      if (
        getCurrentSessionEpoch() === epoch &&
        flowGenRef.current === gen &&
        isVisibleRef.current
      ) {
        setSubmitting(false);
      }
    }
  };

  const handleCopyKey = async () => {
    if (!setupData?.secret) {
      return;
    }
    const gen = flowGenRef.current;
    setCopyError(null);
    const ok = await copyToClipboard(setupData.secret);
    if (!isVisibleRef.current || flowGenRef.current !== gen) {
      return;
    }
    if (ok) {
      clearCopyTimeout();
      setCopiedKeyNotice(true);
      copyTimeoutRef.current = setTimeout(() => {
        if (isVisibleRef.current && flowGenRef.current === gen) {
          setCopiedKeyNotice(false);
        }
      }, 3000);
    } else {
      setCopyError('Não foi possível copiar para a área de transferência. Selecione a chave manualmente para copiar.');
    }
  };

  const handleCopyAllRecoveryCodes = async () => {
    if (recoveryCodes.length === 0) {
      return;
    }
    const gen = flowGenRef.current;
    setCopyError(null);
    const ok = await copyToClipboard(recoveryCodes.join('\n'));
    if (!isVisibleRef.current || flowGenRef.current !== gen) {
      return;
    }
    if (ok) {
      clearCopyTimeout();
      setCopiedCodesNotice(true);
      copyTimeoutRef.current = setTimeout(() => {
        if (isVisibleRef.current && flowGenRef.current === gen) {
          setCopiedCodesNotice(false);
        }
      }, 3000);
    } else {
      setCopyError('Não foi possível copiar os códigos de recuperação. Selecione e copie o texto manualmente.');
    }
  };

  const inputBg = colors.surface;
  const inputBorder = colors.borderSubtle;

  return (
    <AppSheet
      visible={visible}
      title="Autenticação em duas etapas"
      subtitle="Proteção com Google Authenticator"
      onClose={handleSafeClose}
    >
      <View style={styles.sheetContent}>
        {/* MODO 1: Status inicial */}
        {mode === 'status' ? (
          loadingStatus ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color={colors.accentPrimary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Verificando status de segurança...
              </Text>
            </View>
          ) : statusError ? (
            <View style={styles.stateSection}>
              <InlineNotice tone="danger" message={statusError} />
              <PrimaryButton
                label="Tentar novamente"
                variant="secondary"
                onPress={fetchStatus}
              />
            </View>
          ) : status?.enabled ? (
            <View style={styles.stateSection}>
              {/* Badge Ativo */}
              <View
                style={[
                  styles.statusBadgeRow,
                  {
                    backgroundColor: colors.successSoft,
                    borderColor: colors.successBorder,
                  },
                ]}
              >
                <View style={[styles.badgeDot, { backgroundColor: colors.statusSuccess }]} />
                <Text style={[styles.statusBadgeText, { color: colors.successText }]}>
                  Proteção ativa com Google Authenticator
                </Text>
              </View>

              <Text style={[styles.bodyDescription, { color: colors.textSecondary }]}>
                Sua conta está protegida. Sempre que fizer login neste ou em outro dispositivo, será solicitado o código de verificação gerado pelo seu aplicativo autenticador.
              </Text>

              <View
                style={[
                  styles.infoBox,
                  {
                    backgroundColor: colors.bgElevated,
                    borderColor: colors.borderSubtle,
                  },
                ]}
              >
                <Text style={[styles.infoBoxTitle, { color: colors.textPrimary }]}>
                  Códigos de recuperação restantes
                </Text>
                <Text style={[styles.infoBoxCount, { color: colors.brandPrimary }]}>
                  {status.recoveryCodesRemaining} de 10 disponíveis
                </Text>
                <Text style={[styles.infoBoxHint, { color: colors.textMuted }]}>
                  Cada código pode ser utilizado uma única vez caso você não tenha acesso ao seu celular.
                </Text>
              </View>

              <View style={styles.actionWrap}>
                <PrimaryButton
                  label="Desativar autenticação em duas etapas"
                  variant="danger"
                  onPress={handleStartDisable}
                />
              </View>
            </View>
          ) : (
            <View style={styles.stateSection}>
              <View
                style={[
                  styles.statusBadgeRow,
                  {
                    backgroundColor: colors.warningSoft,
                    borderColor: colors.warningBorder,
                  },
                ]}
              >
                <View style={[styles.badgeDot, { backgroundColor: colors.statusWarning }]} />
                <Text style={[styles.statusBadgeText, { color: colors.warningText }]}>
                  Verificação em duas etapas inativa
                </Text>
              </View>

              <Text style={[styles.bodyDescription, { color: colors.textSecondary }]}>
                A autenticação em duas etapas (2FA) adiciona uma camada essencial de segurança à sua conta. Para entrar, além da senha, você precisará de um código temporário de 6 dígitos gerado pelo Google Authenticator.
              </Text>

              <View style={styles.actionWrap}>
                <PrimaryButton
                  label="Configurar autenticação em duas etapas"
                  onPress={handleStartSetup}
                  stepped
                />
              </View>
            </View>
          )
        ) : null}

        {/* MODO 2: Setup - Confirmação de senha */}
        {mode === 'setup_password' ? (
          <View style={styles.stateSection}>
            <Text style={[styles.bodyDescription, { color: colors.textSecondary }]}>
              Para configurar o Google Authenticator, confirme sua senha atual de acesso:
            </Text>

            {errorMessage ? (
              <InlineNotice tone="danger" message={errorMessage} />
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>
                Sua senha
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
                  accessibilityLabel="Sua senha"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
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
              {fieldErrors.currentPassword ? (
                <Text style={[styles.errorText, { color: colors.dangerText }]}>
                  {fieldErrors.currentPassword}
                </Text>
              ) : null}
            </View>

            <View style={styles.actionWrap}>
              <PrimaryButton
                label="Continuar"
                onPress={handleSubmitSetupPassword}
                loading={submitting}
                stepped
              />
              <PrimaryButton
                label="Cancelar"
                variant="ghost"
                onPress={handleCancelFlow}
                disabled={submitting}
              />
            </View>
          </View>
        ) : null}

        {/* MODO 3: Setup - Exibição do QR Code e Chave manual */}
        {mode === 'setup_qr' && setupData ? (
          <View style={styles.stateSection}>
            <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>
              1. Adicione a chave no Google Authenticator
            </Text>
            <Text style={[styles.bodyDescription, { color: colors.textSecondary }]}>
              Escaneie o código QR abaixo com a câmera do aplicativo autenticador:
            </Text>

            <QrCodeView
              uri={setupData.otpauthUri}
              size={180}
              accessibilityLabel="Código QR para escaneamento"
            />

            <View style={styles.divider} />

            {copyError ? (
              <InlineNotice tone="danger" message={copyError} />
            ) : null}

            <Text style={[styles.subLabel, { color: colors.textSecondary }]}>
              Se estiver usando o mesmo celular, selecione e copie a chave manual abaixo:
            </Text>
            <View
              style={[
                styles.keyContainer,
                {
                  backgroundColor: colors.bgElevated,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <Text
                selectable={true}
                accessibilityLabel={`Chave manual: ${setupData.secret}`}
                style={[styles.manualKeyText, { color: colors.textPrimary }]}
              >
                {setupData.secret}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copiar chave manual"
                onPress={() => void handleCopyKey()}
                style={[styles.copyButton, { backgroundColor: colors.brandSoft }]}
              >
                <Text style={[styles.copyButtonText, { color: colors.brandPrimary }]}>
                  {copiedKeyNotice ? 'Copiada!' : 'Copiar chave manual'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.divider} />

            <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>
              2. Confirme o código de 6 dígitos
            </Text>
            <Text style={[styles.bodyDescription, { color: colors.textSecondary }]}>
              Insira o código numérico gerado pelo Google Authenticator para ativar a proteção:
            </Text>

            {errorMessage ? (
              <InlineNotice tone="danger" message={errorMessage} />
            ) : null}

            <View style={styles.fieldGroup}>
              <OtpSixInput
                value={totpCode}
                onChange={setTotpCode}
                accessibilityLabel="Código de 6 dígitos"
                hasError={Boolean(fieldErrors.code)}
                disabled={submitting}
              />
              {fieldErrors.code ? (
                <Text style={[styles.errorText, { color: colors.dangerText }]}>
                  {fieldErrors.code}
                </Text>
              ) : null}
            </View>

            <View style={styles.actionWrap}>
              <PrimaryButton
                label="Confirmar e ativar"
                onPress={handleSubmitEnableCode}
                loading={submitting}
                stepped
              />
              <PrimaryButton
                label="Cancelar"
                variant="ghost"
                onPress={handleCancelFlow}
                disabled={submitting}
              />
            </View>
          </View>
        ) : null}

        {/* MODO 4: Setup - Exibição única dos 10 códigos de recuperação */}
        {mode === 'setup_recovery' ? (
          <View style={styles.stateSection}>
            <View
              style={[
                styles.statusBadgeRow,
                {
                  backgroundColor: colors.successSoft,
                  borderColor: colors.successBorder,
                },
              ]}
            >
              <CheckIcon size={18} color={colors.statusSuccess} />
              <Text style={[styles.statusBadgeText, { color: colors.successText }]}>
                Autenticação ativada com sucesso!
              </Text>
            </View>

            {errorMessage ? (
              <InlineNotice tone="danger" message={errorMessage} />
            ) : null}

            <InlineNotice
              tone="warning"
              title="Atenção: Guarde seus códigos de recuperação"
              message="Estes 10 códigos de recuperação são exibidos apenas agora. Cada um permite acessar sua conta uma única vez caso você não tenha seu celular. Salve-os em um local seguro."
            />

            {copyError ? (
              <InlineNotice tone="danger" message={copyError} />
            ) : null}

            <View
              style={[
                styles.codesContainer,
                {
                  backgroundColor: colors.bgElevated,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <View style={styles.codesList}>
                {recoveryCodes.map((code, index) => (
                  <View key={code} style={styles.codeItemRow}>
                    <Text style={[styles.codeIndex, { color: colors.textMuted }]}>
                      {String(index + 1).padStart(2, '0')}.
                    </Text>
                    <Text
                      selectable={true}
                      style={[styles.codeText, { color: colors.textPrimary }]}
                    >
                      {code}
                    </Text>
                  </View>
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copiar todos os códigos de recuperação"
                onPress={() => void handleCopyAllRecoveryCodes()}
                style={[styles.copyButton, { backgroundColor: colors.brandSoft, marginTop: 10 }]}
              >
                <Text style={[styles.copyButtonText, { color: colors.brandPrimary }]}>
                  {copiedCodesNotice ? 'Códigos copiados!' : 'Copiar todos os códigos'}
                </Text>
              </Pressable>
            </View>

            {/* Confirmação do usuário antes de fechar */}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="Confirmo que guardei meus códigos de recuperação com segurança"
              accessibilityState={{ checked: confirmedSavedCodes }}
              aria-checked={confirmedSavedCodes}
              onPress={() => setConfirmedSavedCodes((prev) => !prev)}
              style={styles.checkboxRow}
            >
              <View
                style={[
                  styles.checkboxSquare,
                  {
                    backgroundColor: confirmedSavedCodes ? colors.brandPrimary : colors.surface,
                    borderColor: confirmedSavedCodes ? colors.brandPrimary : colors.borderSubtle,
                  },
                ]}
              >
                {confirmedSavedCodes ? (
                  <CheckIcon size={14} color="#FFFFFF" strokeWidth={3} />
                ) : null}
              </View>
              <Text style={[styles.checkboxLabel, { color: colors.textPrimary }]}>
                Confirmo que salvei meus códigos de recuperação em local seguro.
              </Text>
            </Pressable>

            <View style={styles.actionWrap}>
              <PrimaryButton
                label="Concluir configuração"
                disabled={!confirmedSavedCodes}
                onPress={handleFinishSetup}
                stepped
              />
            </View>
          </View>
        ) : null}

        {/* MODO 5: Desativação */}
        {mode === 'disable' ? (
          <View style={styles.stateSection}>
            <InlineNotice
              tone="warning"
              title="Desativação de segurança"
              message="Ao desativar a autenticação em duas etapas, sua conta não exigirá mais o Google Authenticator para login. Para confirmar a desativação, confirme sua senha e um código de verificação."
            />

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
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
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
              {fieldErrors.currentPassword ? (
                <Text style={[styles.errorText, { color: colors.dangerText }]}>
                  {fieldErrors.currentPassword}
                </Text>
              ) : null}
            </View>

            {/* Código TOTP ou recuperação */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>
                {disableWithRecovery
                  ? 'Código de recuperação'
                  : 'Código do autenticador (6 dígitos)'}
              </Text>
              {disableWithRecovery ? (
                <View
                  style={[
                    styles.inputRow,
                    {
                      backgroundColor: inputBg,
                      borderColor: fieldErrors.code
                        ? colors.dangerBorder
                        : inputBorder,
                    },
                  ]}
                >
                  <LockIcon size={20} color={colors.accentPrimary} />
                  <TextInput
                    accessibilityLabel="Código de recuperação"
                    value={totpCode}
                    onChangeText={setTotpCode}
                    placeholder="Cole seu código de 43 caracteres"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.textInput, { color: colors.textPrimary }]}
                  />
                </View>
              ) : (
                <OtpSixInput
                  value={totpCode}
                  onChange={setTotpCode}
                  accessibilityLabel="Código de 6 dígitos"
                  hasError={Boolean(fieldErrors.code)}
                  disabled={submitting}
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
                  disableWithRecovery
                    ? 'Usar aplicativo autenticador'
                    : 'Usar código de recuperação'
                }
                onPress={() => {
                  setDisableWithRecovery((prev) => !prev);
                  setTotpCode('');
                  setFieldErrors({});
                }}
                style={styles.toggleModeButton}
              >
                <Text style={[styles.toggleModeText, { color: colors.brandPrimary }]}>
                  {disableWithRecovery
                    ? '← Usar aplicativo autenticador'
                    : 'Não tem acesso ao celular? Usar código de recuperação'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.actionWrap}>
              <PrimaryButton
                label="Confirmar e desativar"
                variant="danger"
                onPress={handleSubmitDisable}
                loading={submitting}
              />
              <PrimaryButton
                label="Voltar"
                variant="ghost"
                onPress={handleCancelFlow}
                disabled={submitting}
              />
            </View>
          </View>
        ) : null}
      </View>
    </AppSheet>
  );
}

const styles = StyleSheet.create({
  sheetContent: {
    paddingVertical: 12,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  loadingText: {
    ...typography.body,
    fontSize: 14,
  },
  stateSection: {
    gap: 14,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusBadgeText: {
    ...typography.bodyStrong,
    fontSize: 14,
  },
  bodyDescription: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
  },
  stepTitle: {
    ...typography.bodyStrong,
    fontSize: 15,
  },
  subLabel: {
    ...typography.caption,
    fontSize: 13,
  },
  infoBox: {
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 4,
  },
  infoBoxTitle: {
    ...typography.caption,
    fontSize: 12,
  },
  infoBoxCount: {
    ...typography.bodyStrong,
    fontSize: 16,
    fontWeight: '700',
  },
  infoBoxHint: {
    ...typography.caption,
    fontSize: 12,
    marginTop: 2,
  },
  keyContainer: {
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 8,
  },
  manualKeyText: {
    ...typography.bodyStrong,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  copyButton: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.sm,
  },
  copyButtonText: {
    ...typography.bodyStrong,
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: '#DFDDD5',
    marginVertical: 4,
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
  totpInput: {
    flex: 1,
    ...typography.bodyStrong,
    fontSize: 22,
    letterSpacing: 4,
    textAlign: 'center',
    paddingVertical: 10,
  },
  eyeButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
  },
  codesContainer: {
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  codesList: {
    gap: 6,
    width: '100%',
  },
  codeItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    width: '100%',
  },
  codeIndex: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 18,
    width: 22,
  },
  codeText: {
    ...typography.bodyStrong,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0.5,
    ...(Platform.OS === 'web' ? ({ wordBreak: 'break-all' } as any) : {}),
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  checkboxSquare: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: {
    flex: 1,
    ...typography.body,
    fontSize: 13,
    lineHeight: 18,
  },
  actionWrap: {
    marginTop: 8,
    gap: 8,
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
