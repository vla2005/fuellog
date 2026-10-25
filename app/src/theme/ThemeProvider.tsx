import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { DARK_COLORS, LIGHT_COLORS, ThemeColors } from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'fuellog:theme-preference:v1';

interface ThemeContextValue {
  mode: ThemePreference;
  preference: ThemePreference;
  isDark: boolean;
  colors: ThemeColors;
  setMode: (next: ThemePreference) => Promise<void>;
  setPreference: (next: ThemePreference) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  preference: 'system',
  isDark: false,
  colors: LIGHT_COLORS,
  setMode: async () => {},
  setPreference: async () => {},
});

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemePreference>('system');

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (!mounted) return;
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setModeState(stored);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const setMode = async (next: ThemePreference) => {
    setModeState(next);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Non-blocking persistence
    }
  };

  const isDark = useMemo(() => {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return systemScheme === 'dark';
  }, [mode, systemScheme]);

  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;

  const value = useMemo(
    () => ({
      mode,
      preference: mode,
      isDark,
      colors,
      setMode,
      setPreference: setMode,
    }),
    [mode, isDark, colors],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
