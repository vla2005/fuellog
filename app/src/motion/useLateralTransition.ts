import { useLayoutEffect, useRef } from 'react';
import { Animated } from 'react-native';

import { useMotionPolicy } from './useMotionPolicy';

/** Animates a change of view without changing the identity of its content. */
export function useLateralTransition(
  transitionKey: string,
  order = 0,
  active = true,
  animateOnActivate = true,
) {
  const policy = useMotionPolicy();
  const policyRef = useRef(policy);
  policyRef.current = policy;
  const previous = useRef({ transitionKey, order, active });
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useLayoutEffect(() => {
    const prev = previous.current;
    previous.current = { transitionKey, order, active };
    const reset = () => {
      translateX.setValue(0);
      opacity.setValue(1);
    };
    const changed = prev.active ? prev.transitionKey !== transitionKey : animateOnActivate;
    if (!active || !policyRef.current.shouldAnimate || !changed) {
      reset();
      return;
    }

    translateX.setValue(order >= prev.order ? 18 : -18);
    opacity.setValue(0.92);
    const animation = Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: policyRef.current.duration('standard', 0),
        easing: policyRef.current.easing.enter,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: policyRef.current.duration('micro', 0),
        easing: policyRef.current.easing.enter,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => {
      animation.stop();
      reset();
    };
  }, [active, animateOnActivate, opacity, order, policy.shouldAnimate, transitionKey, translateX]);

  return { opacity, transform: [{ translateX }] };
}
