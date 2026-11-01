import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { ReduceMotion } from 'react-native-reanimated';

import { useMotionPolicy } from '@/motion/useMotionPolicy';
import { ChevronRightIcon } from '@/components/icons/AppIcons';
import { useAppTheme } from '@/theme/ThemeProvider';

export function HistorySwipeRow({ children, onDelete, onOpen, label }: {
  children: (openDetails: () => void) => React.ReactNode;
  onDelete: () => void;
  onOpen: () => void;
  label: string;
}) {
  const ref = useRef<SwipeableMethods>(null);
  const swiping = useRef(false);
  const [open, setOpen] = useState(false);
  const { colors } = useAppTheme();
  const { reduceMotion, isAppActive } = useMotionPolicy();
  useEffect(() => {
    if (!isAppActive) {
      ref.current?.reset();
      swiping.current = false;
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
      onSwipeableOpenStartDrag={() => { swiping.current = true; }}
      onSwipeableWillOpen={() => { swiping.current = true; setOpen(true); }}
      onSwipeableClose={() => { swiping.current = false; setOpen(false); }}
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
      <View style={{ flexDirection: 'row', backgroundColor: colors.bgPrimary, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle }}>
        <View style={{ flex: 1 }}>{children(() => { if (!swiping.current) onOpen(); })}</View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ver detalhes de ${label}`}
          onPress={() => { if (!swiping.current) onOpen(); }}
          style={{ minWidth: 44, minHeight: 48, justifyContent: 'center', alignItems: 'center' }}
        >
          <ChevronRightIcon size={20} color={colors.brandPrimary} />
        </Pressable>
      </View>
    </Swipeable>
  );
}
