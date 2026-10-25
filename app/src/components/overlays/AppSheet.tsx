import React, { useEffect, useRef } from 'react';
import {
  Animated,
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
import { IconButton } from '@/components/ui/IconButton';
import { useMotionPolicy } from '@/motion/useMotionPolicy';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export interface AppSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function AppSheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: AppSheetProps) {
  const { colors } = useAppTheme();
  const { reduceMotion, duration, easing } = useMotionPolicy();
  const translateY = useRef(new Animated.Value(24)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    if (reduceMotion) {
      translateY.setValue(0);
      opacity.setValue(1);
      return;
    }

    translateY.setValue(24);
    opacity.setValue(0);

    const anim = Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: duration('sheet'),
        easing: easing.enter,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: duration('standard'),
        easing: easing.enter,
        useNativeDriver: true,
      }),
    ]);

    anim.start();
    return () => {
      anim.stop();
    };
  }, [duration, easing.enter, opacity, reduceMotion, translateY, visible]);

  const handleDismiss = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleDismiss}
    >
      <View style={styles.modalRoot}>
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
            style={[
              styles.sheetCard,
              {
                backgroundColor: colors.bgElevated,
                borderColor: colors.borderDefault,
                opacity,
                transform: [{ translateY }],
              },
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
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
