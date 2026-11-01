import React from 'react';
import { Platform, Switch, SwitchProps, View } from 'react-native';
import { viKashColors, viKashStyles } from './viKashTheme';

function sizeWebTarget(control: React.ElementRef<typeof Switch> | null) {
  if (Platform.OS !== 'web' || !control) return;
  // react-native-web exposes the input; enlarge its hit area without resizing the track.
  const input = control as unknown as HTMLInputElement;
  input.style.height = '44px';
  input.style.top = '-10px';
}

export function ViKashSwitch(props: Pick<SwitchProps, 'accessibilityLabel' | 'value' | 'disabled' | 'onValueChange'>) {
  return <View style={viKashStyles.switchTarget}>
    <Switch {...props} ref={sizeWebTarget} hitSlop={8}
      {...(Platform.OS === 'web' ? { activeThumbColor: viKashColors.text, style: { width: 48, height: 24 } } : {})}
      trackColor={{ false: viKashColors.divider, true: viKashColors.amber }} thumbColor={viKashColors.text} />
  </View>;
}
