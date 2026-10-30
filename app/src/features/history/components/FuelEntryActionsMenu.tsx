import React, { useEffect, useRef } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, shadows, typography } from '@/theme/tokens';

export function FuelEntryActionsMenu({ anchor, onClose, onEdit, onDelete }: {
  anchor: { top: number; right: number };
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const rootRef = useRef<React.ElementRef<typeof View>>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const top = Math.max(insets.top + 8, Math.min(anchor.top + 4, height - insets.bottom - 120));

  const focusFirst = () => {
    if (Platform.OS === 'web') {
      (rootRef.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) {
        const items = Array.from((rootRef.current as unknown as HTMLElement | null)?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1) + items.length) % items.length;
        event.preventDefault();
        items[next]?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <Modal transparent animationType="none" statusBarTranslucent onRequestClose={onClose} onShow={focusFirst}>
      <View style={styles.overlay} accessibilityViewIsModal>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Fechar menu de opções"
          onPress={onClose}
        />
        <View
          ref={rootRef}
          accessibilityRole="menu"
          accessibilityLabel="Opções do abastecimento"
          style={[styles.menu, isDark ? shadows.darkCard : shadows.lightFloating, {
            top,
            right: Math.max(insets.right + 8, Math.min(anchor.right, width - insets.left - 248)),
            maxWidth: width - insets.left - insets.right - 16,
            maxHeight: height - top - insets.bottom - 8,
            backgroundColor: colors.bgElevated,
            borderColor: colors.borderDefault,
          }]}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Editar abastecimento"
              onPress={onEdit}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.brandSoft }]}
            >
              <Text style={[styles.label, { color: colors.textPrimary }]}>Editar abastecimento</Text>
            </Pressable>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Excluir abastecimento"
              onPress={onDelete}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.dangerSoft }]}
            >
              <Text style={[styles.label, { color: colors.dangerText }]}>Excluir abastecimento</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  menu: {
    position: 'absolute',
    width: 248,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 4,
  },
  item: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12 },
  label: { ...typography.bodyStrong, fontSize: 14, flexShrink: 1 },
});
