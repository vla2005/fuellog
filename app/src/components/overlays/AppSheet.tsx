import React, { useContext, useEffect, useId, useRef } from 'react';
import {
  Animated,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CloseIcon } from '@/components/icons/AppIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenOverlayContext } from '@/components/layout/ScreenShell';
import { TabActiveContext } from '@/components/navigation/AuthenticatedTabShell';
import { IconButton } from '@/components/ui/IconButton';
import { useLateralTransition } from '@/motion/useLateralTransition';
import { useMotionPolicy } from '@/motion/useMotionPolicy';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export interface AppSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  modal?: boolean;
  lateral?: boolean;
  transitionKey?: string;
  transitionOrder?: number;
}

export function AppSheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  modal = false,
  lateral = false,
  transitionKey = 'sheet',
  transitionOrder = 0,
}: AppSheetProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { reduceMotion, shouldAnimate, duration, easing } = useMotionPolicy();
  const overlayContext = useContext(ScreenOverlayContext);
  const isPaneActive = useContext(TabActiveContext);
  const lateralStyle = useLateralTransition(transitionKey, transitionOrder, lateral && visible && isPaneActive);
  const sheetId = useId();
  const modalRootRef = useRef<React.ElementRef<typeof View>>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!modal || !visible || !isPaneActive || Platform.OS !== 'web') return;
    const root = modalRootRef.current as unknown as HTMLElement | null;
    if (!root) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [role="button"]:not([aria-disabled="true"]), [tabindex="0"]',
    )).filter((node) => node.getClientRects().length > 0);
    const focusFirst = () => (root.querySelector<HTMLElement>('[data-testid="fuel-delete-cancel"]') ?? focusable()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === 'Tab') {
        const nodes = focusable();
        const index = nodes.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        nodes[(index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length]?.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (!root.contains(event.target as Node)) focusFirst();
    };
    focusFirst();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', containFocus);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isPaneActive, modal, visible]);
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const motionPolicyRef = useRef({ duration, easing, reduceMotion });
  motionPolicyRef.current = { duration, easing, reduceMotion };

  useEffect(() => {
    if (!visible || !isPaneActive || lateral || !shouldAnimate) {
      translateY.setValue(0);
      opacity.setValue(1);
      return;
    }
    const policy = motionPolicyRef.current;
    if (policy.reduceMotion) {
      translateY.setValue(0);
      opacity.setValue(1);
      return;
    }

    translateY.setValue(24);
    opacity.setValue(0);

    const anim = Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: policy.duration('sheet'),
        easing: policy.easing.enter,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: policy.duration('standard'),
        easing: policy.easing.enter,
        useNativeDriver: true,
      }),
    ]);

    anim.start();
    return () => {
      anim.stop();
      translateY.setValue(0);
      opacity.setValue(1);
    };
  }, [isPaneActive, lateral, opacity, shouldAnimate, translateY, visible]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !visible || !isPaneActive) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Keyboard.dismiss();
      onClose();
      return true;
    });
    return () => {
      sub.remove();
    };
  }, [isPaneActive, onClose, visible]);

  const handleDismiss = () => {
    Keyboard.dismiss();
    onClose();
  };

  const withDockClearance = !modal && Boolean(overlayContext?.withDockClearance);

  const sheetBody = (
    <View
      ref={modalRootRef}
      role={modal ? 'dialog' : undefined}
      aria-modal={modal || undefined}
      aria-label={modal ? title : undefined}
      accessibilityViewIsModal={modal}
      pointerEvents="auto"
      style={[
        styles.modalRoot,
        overlayContext && !modal ? styles.inlineOverlayRoot : null,
        withDockClearance ? styles.modalRootWithDock : null,
      ]}
    >
      <Pressable
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={handleDismiss}
        accessibilityRole="button"
        accessibilityLabel="Fechar painel"
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
        style={styles.keyboardAvoid}
      >
        <Animated.View
          pointerEvents="auto"
          testID={lateral ? "sheet-transition" : undefined}
          style={[
            styles.sheetCard,
            withDockClearance ? styles.sheetCardWithDock : null,
            {
              backgroundColor: colors.bgElevated,
              borderColor: colors.borderDefault,
              opacity,
              transform: [{ translateY }],
            },
            lateral ? lateralStyle : null,
            modal ? { paddingBottom: Math.max(24, insets.bottom + 12) } : null,
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
          <View style={styles.headerRow}>
            <View style={styles.headerTextGroup}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <IconButton
              icon={<CloseIcon size={18} color={colors.textPrimary} />}
              accessibilityLabel="Fechar"
              onPress={handleDismiss}
              variant="subtle"
            />
          </View>
          <ScrollView
            style={styles.scrollBody}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );

  useEffect(() => {
    if (modal || Platform.OS === 'web' || !overlayContext) {
      return;
    }
    overlayContext.setNativeOverlay(
      sheetId,
      visible && isPaneActive ? sheetBody : null,
    );
    return () => {
      overlayContext.setNativeOverlay(sheetId, null);
    };
  });

  if (!visible) {
    return null;
  }

  if (!modal && Platform.OS === 'web' && overlayContext?.webHostElement) {
    const ReactDOM = require('react-dom') as {
      createPortal: (
        children: React.ReactNode,
        container: Element,
      ) => React.ReactPortal;
    };
    return ReactDOM.createPortal(sheetBody, overlayContext.webHostElement);
  }

  if (!modal && Platform.OS !== 'web' && overlayContext) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleDismiss}
    >
      {sheetBody}
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  inlineOverlayRoot: {
    ...StyleSheet.absoluteFill,
    zIndex: 25,
  },
  modalRootWithDock: {
    paddingTop: 6,
    paddingBottom: 76,
  },
  keyboardAvoid: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sheetCard: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    maxHeight: '86%',
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
  },
  sheetCardWithDock: {
    maxHeight: '100%',
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
    paddingBottom: 14,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  headerTextGroup: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.sectionTitle,
  },
  subtitle: {
    ...typography.caption,
  },
  scrollBody: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: 16,
    gap: 12,
  },
});
