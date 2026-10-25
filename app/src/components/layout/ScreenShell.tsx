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
import { SafeAreaView } from 'react-native-safe-area-context';

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

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.safeArea, { backgroundColor: colors.bgPrimary }]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {header}
        {scrollable ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[
              styles.scrollContent,
              withDockClearance && { paddingBottom: layout.bottomDockClearance },
              contentContainerStyle,
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.maxWidthContainer}>{children}</View>
          </ScrollView>
        ) : (
          <View
            style={[
              styles.flex,
              styles.nonScrollContent,
              withDockClearance && { paddingBottom: layout.bottomDockClearance },
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
