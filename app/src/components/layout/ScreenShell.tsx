import React from 'react';
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

export interface ScreenShellProps {
  children: React.ReactNode;
  scrollable?: boolean;
  withDockClearance?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

export function ScreenShell({
  children,
  scrollable = true,
  withDockClearance = false,
  contentContainerStyle,
  header,
  footer,
}: ScreenShellProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();

  const baseBottomPadding = withDockClearance
    ? layout.bottomDockClearance
    : Math.max(28, insets.bottom + 8);

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
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
              { paddingBottom: baseBottomPadding },
              contentContainerStyle,
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.maxWidthContainer}>{children}</View>
          </ScrollView>
        ) : (
          <View
            style={[
              styles.flex,
              styles.nonScrollContent,
              {
                paddingBottom: withDockClearance
                  ? layout.bottomDockClearance
                  : Math.max(20, insets.bottom + 8),
              },
              contentContainerStyle,
            ]}
          >
            <View style={[styles.flex, styles.maxWidthContainer]}>{children}</View>
          </View>
        )}
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
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
});
