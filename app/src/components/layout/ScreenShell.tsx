import React, { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/ThemeProvider';
import { layout } from '@/theme/tokens';

export interface ScreenOverlayContextValue {
  withDockClearance: boolean;
  webHostElement: HTMLElement | null;
  setNativeOverlay: (id: string, node: React.ReactNode | null) => void;
}

export const ScreenOverlayContext =
  React.createContext<ScreenOverlayContextValue | null>(null);

export interface ScreenShellProps {
  children: React.ReactNode;
  scrollable?: boolean;
  withDockClearance?: boolean;
  omitTopSafeArea?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  fullBleedHero?: React.ReactNode;
}

export function ScreenShell({
  children,
  scrollable = true,
  withDockClearance = false,
  omitTopSafeArea = false,
  contentContainerStyle,
  header,
  footer,
  fullBleedHero,
}: ScreenShellProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [webHostElement, setWebHostElement] = useState<HTMLElement | null>(null);
  const [nativeOverlays, setNativeOverlays] = useState<
    Record<string, React.ReactNode>
  >({});

  const setNativeOverlay = useCallback(
    (id: string, node: React.ReactNode | null) => {
      setNativeOverlays((prev) => {
        if (node === null) {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        }
        if (prev[id] === node) return prev;
        return { ...prev, [id]: node };
      });
    },
    [],
  );

  const handleWebHostRef = useCallback((node: unknown) => {
    const el = (node as HTMLElement | null) ?? null;
    setWebHostElement((prev) => (prev === el ? prev : el));
  }, []);

  const overlayContextValue = useMemo<ScreenOverlayContextValue>(
    () => ({
      withDockClearance,
      webHostElement,
      setNativeOverlay,
    }),
    [setNativeOverlay, webHostElement, withDockClearance],
  );

  const baseBottomPadding = withDockClearance
    ? Math.max(layout.bottomDockClearance, 58 + insets.bottom)
    : Math.max(28, insets.bottom + 8);

  return (
    <ScreenOverlayContext.Provider value={overlayContextValue}>
      <SafeAreaView
        edges={omitTopSafeArea ? ['left', 'right'] : ['top', 'left', 'right']}
        style={[styles.safeArea, { backgroundColor: colors.bgPrimary }]}
      >
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {header}
          {scrollable ? (
            <ScrollView
              style={styles.flex}
              contentContainerStyle={[
                styles.scrollContent,
                fullBleedHero ? styles.fullBleedScrollContent : null,
                contentContainerStyle,
                { paddingBottom: baseBottomPadding },
              ]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}
              showsVerticalScrollIndicator={false}
            >
              {fullBleedHero}
              <View
                style={[
                  styles.maxWidthContainer,
                  fullBleedHero ? styles.maxWidthWithPadding : null,
                ]}
              >
                {children}
              </View>
            </ScrollView>
          ) : (
            <View
              style={[
                styles.flex,
                styles.nonScrollContent,
                fullBleedHero ? styles.fullBleedScrollContent : null,
                contentContainerStyle,
                {
                  paddingBottom: withDockClearance
                  ? Math.max(layout.bottomDockClearance, 58 + insets.bottom)
                  : Math.max(20, insets.bottom + 8),
                },
              ]}
            >
              {fullBleedHero}
              <View
                style={[
                  styles.flex,
                  styles.maxWidthContainer,
                  fullBleedHero ? styles.maxWidthWithPadding : null,
                ]}
              >
                {children}
              </View>
            </View>
          )}
          {Platform.OS === 'web' ? (
            <View
              ref={handleWebHostRef}
              pointerEvents="box-none"
              style={styles.overlayHost}
            />
          ) : (
            Object.entries(nativeOverlays).map(([id, node]) => (
              <React.Fragment key={id}>{node}</React.Fragment>
            ))
          )}
          {footer}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenOverlayContext.Provider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: layout.horizontalPadding,
    paddingTop: 8,
    paddingBottom: 28,
  },
  fullBleedScrollContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  maxWidthWithPadding: {
    paddingHorizontal: layout.horizontalPadding,
  },
  nonScrollContent: {
    paddingHorizontal: layout.horizontalPadding,
    paddingTop: 8,
    paddingBottom: 20,
  },
  maxWidthContainer: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  overlayHost: {
    ...StyleSheet.absoluteFill,
    zIndex: 25,
  },
});
