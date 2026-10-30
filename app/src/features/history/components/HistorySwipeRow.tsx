import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { ReduceMotion } from 'react-native-reanimated';

import { useMotionPolicy } from '@/motion/useMotionPolicy';
import { useAppTheme } from '@/theme/ThemeProvider';

export function HistorySwipeRow({ children, onDelete, label }: {
  children: React.ReactNode;
  onDelete: () => void;
  label: string;
}) {
  const ref = useRef<SwipeableMethods>(null);
  const [open, setOpen] = useState(false);
  const { colors } = useAppTheme();
  const { reduceMotion, isAppActive } = useMotionPolicy();
  useEffect(() => {
    if (!isAppActive) {
      ref.current?.reset();
      setOpen(false);
    }
  }, [isAppActive]);
  return (
    <Swipeable
      ref={ref}
      enabled={isAppActive}
      testID="history-swipe-row"
      overshootRight={false}
      dragOffsetFromRight={-24}
      dragOffsetFromLeft={24}
      rightThreshold={44}
      animationOptions={{ reduceMotion: reduceMotion ? ReduceMotion.Always : ReduceMotion.System }}
      onSwipeableWillOpen={() => setOpen(true)}
      onSwipeableClose={() => setOpen(false)}
      renderRightActions={() => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Excluir ${label}`}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? 'yes' : 'no-hide-descendants'}
          aria-hidden={!open}
          pointerEvents={open ? 'auto' : 'none'}
          onPress={() => { ref.current?.close(); onDelete(); }}
          style={{ minWidth: 96, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.dangerSoft, padding: 12 }}
        >
          <Text style={{ color: colors.dangerText, fontWeight: '700' }}>Excluir</Text>
        </Pressable>
      )}
    >
      <View style={{ flexDirection: 'row', backgroundColor: colors.surface }}>
        <View style={{ flex: 1 }}>{children}</View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ações: ${label}`}
          accessibilityHint="Revela a opção Excluir; a exclusão exige confirmação"
          onPress={() => ref.current?.openRight()}
          style={{ minWidth: 44, minHeight: 48, justifyContent: 'center', alignItems: 'center' }}
        >
          <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>•••</Text>
        </Pressable>
      </View>
    </Swipeable>
  );
}
