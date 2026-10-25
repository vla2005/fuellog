import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, AppStateStatus, Easing, EasingFunction } from 'react-native';

export const MOTION_TOKENS = {
  pressIn: 80,
  pressOut: 120,
  fast: 120,
  micro: 160,
  standard: 220,
  screen: 280,
  sheet: 280,
  sheetIn: 300,
  sheetOut: 240,
  success: 600,
  stagger: 35,
  skeletonCycle: 1200,
} as const;

export type MotionDurationToken = keyof typeof MOTION_TOKENS | number;

export interface MotionPolicy {
  reduceMotion: boolean;
  isAppActive: boolean;
  shouldAnimate: boolean;
  duration: (tokenOrMs: MotionDurationToken, reducedMs?: number) => number;
  easing: {
    enter: EasingFunction;
    exit: EasingFunction;
    standard: EasingFunction;
  };
}

const EASING_MAP = {
  enter: Easing.out(Easing.cubic),
  exit: Easing.in(Easing.cubic),
  standard: Easing.inOut(Easing.cubic),
};

export function useMotionPolicy(): MotionPolicy {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(
    () => (AppState.currentState || 'active') as AppStateStatus,
  );

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});

    const reduceSub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        if (mounted) setReduceMotion(Boolean(enabled));
      },
    );

    const appSub = AppState.addEventListener('change', (nextState) => {
      if (mounted) setAppState(nextState);
    });

    return () => {
      mounted = false;
      reduceSub.remove();
      appSub.remove();
    };
  }, []);

  const isAppActive = appState === 'active';
  const shouldAnimate = !reduceMotion && isAppActive;

  const duration = (tokenOrMs: MotionDurationToken, reducedMs = 0) => {
    if (!isAppActive) return 0;
    if (reduceMotion) return reducedMs;
    if (typeof tokenOrMs === 'number') {
      return tokenOrMs;
    }
    return MOTION_TOKENS[tokenOrMs];
  };

  return {
    reduceMotion,
    isAppActive,
    shouldAnimate,
    duration,
    easing: EASING_MAP,
  };
}
