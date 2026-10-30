import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { toQR } from 'toqr';

export interface QrCodeViewProps {
  uri: string;
  size?: number;
  accessibilityLabel?: string;
}

export function QrCodeView({
  uri,
  size = 200,
  accessibilityLabel = 'Código QR para configuração no aplicativo autenticador',
}: QrCodeViewProps) {
  const { pathData, viewBoxSize } = useMemo(() => {
    try {
      if (!uri) return { pathData: '', viewBoxSize: 0 };
      const matrix = toQR(uri);
      const matrixSize = Math.round(Math.sqrt(matrix.length));
      const quietZone = 4;
      const totalSize = matrixSize + quietZone * 2;
      let path = '';
      for (let y = 0; y < matrixSize; y++) {
        for (let x = 0; x < matrixSize; x++) {
          if (matrix[y * matrixSize + x] === 1) {
            path += `M${x + quietZone} ${y + quietZone}h1v1h-1z `;
          }
        }
      }
      return { pathData: path, viewBoxSize: totalSize };
    } catch {
      return { pathData: '', viewBoxSize: 0 };
    }
  }, [uri]);

  if (!pathData || viewBoxSize === 0) {
    return (
      <View style={[styles.container, { width: size, height: size }]}>
        <Text style={styles.errorText}>Não foi possível gerar o código QR.</Text>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.container, { width: size, height: size }]}
    >
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      >
        <Rect width={viewBoxSize} height={viewBoxSize} fill="#FFFFFF" />
        <Path d={pathData} fill="#000000" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#DFDDD5',
    alignSelf: 'center',
  },
  errorText: {
    fontSize: 12,
    color: '#8A93A3',
    textAlign: 'center',
    padding: 12,
  },
});
