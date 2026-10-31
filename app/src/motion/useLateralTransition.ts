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

  useLayoutEffect(() => {
    const prev = previous.current;
    previous.current = { transitionKey, order, active };
    const reset = () => {
      translateX.setValue(0);
    };
    const changed = prev.active ? prev.transitionKey !== transitionKey : animateOnActivate;
    if (!active || !policyRef.current.shouldAnimate || !changed) {
      reset();
      return;
    }

    translateX.setValue(order >= prev.order ? 18 : -18);
    const animation = Animated.timing(translateX, {
      toValue: 0,
      duration: policyRef.current.duration('standard', 0),
      easing: policyRef.current.easing.enter,
      useNativeDriver: true,
    });
    animation.start();
    return () => {
      animation.stop();
      reset();
    };
  }, [active, animateOnActivate, order, policy.shouldAnimate, transitionKey, translateX]);

  return { transform: [{ translateX }] };
}
