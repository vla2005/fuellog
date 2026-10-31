import React, { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, interpolate, runOnJS, useAnimatedProps, useAnimatedReaction,
  useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useAppTheme } from '@/theme/ThemeProvider';
import { typography } from '@/theme/tokens';
import { plotGeometry, visibleDrawing } from './model';
import type { ChartDatum, ChartKind } from './presentation';
import { DashboardMotionContext } from './useDashboard';

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedGroup = Animated.createAnimatedComponent(G);
const HEIGHT = 226;
const fuelColors = ['#1D59F2', '#158F8B', '#8C58C7', '#B66B09', '#BE4964'];
export function chartColor(index: number) { return fuelColors[index % fuelColors.length]; }

function GrowingSegment({ x, width, color, opacity, progress }: { x: number; width: number; color: string; opacity: number; progress: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ x: x * progress.value, width: width * progress.value }));
  return <AnimatedRect y={20} height={28} fill={color} opacity={opacity} animatedProps={props} />;
}

function GrowingBar({ x, y, width, bottom, color, progress }: { x: number; y: number; width: number; bottom: number; color: string; progress: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ y: bottom - (bottom - y) * progress.value, height: Math.max(0, (bottom - y) * progress.value) }));
  return <AnimatedRect x={x} width={width} rx={4} fill={color} animatedProps={props} />;
}

export function DashboardPlot({ kind, rows, signature, sectionTop, onDetails, onList, onSelectChange }: {
  kind: ChartKind; rows: ChartDatum[]; signature: string; sectionTop: SharedValue<number>;
  onDetails: (row: ChartDatum) => void; onList: () => void; onSelectChange?: () => void;
}) {
  const { colors, isDark } = useAppTheme();
  const motion = useContext(DashboardMotionContext)!;
  const {scrollY,viewportHeight,expandedHeight,compactHeight,dockHeight,active}=motion;
  const [width, setWidth] = useState(320);
  const hitRef = useRef<React.ElementRef<typeof View>>(null);
  const wrapperRef = useRef<React.ElementRef<typeof View>>(null);
  const [selection, setSelection] = useState<{signature:string;index:number} | null>(null);
  const selected = selection?.signature === signature && selection.index < rows.length ? selection.index : null;
  const setSelected = (index: number | null) => setSelection(index === null ? null : {signature,index});
  const tooltipHeight = useSharedValue(120);
  const plotLeft = useSharedValue(20);
  const localTop = useSharedValue(-100000);
  const progress = useSharedValue(motion.played.has(signature) || motion.reduceMotion ? 1 : 0);
  const currentSignature = useRef(signature); currentSignature.current = signature;
  const clipId = useId().replace(/[^a-zA-Z0-9]/g, '') + kind;
  const bars = kind === 'spending' || kind === 'liters';
  const stacked = kind === 'fuel';
  const values = rows.map(row => row.value === null ? null : Number(row.value));
  const geometry = useMemo(() => plotGeometry(values,width,HEIGHT,bars), [width, rows, bars]);
  const total = stacked ? values.reduce<number>((sum,value) => sum + (value ?? 0), 0) : 0;
  const start = useCallback(() => {
    if (currentSignature.current !== signature || !motion.active || motion.played.has(signature)) return;
    motion.played.add(signature);
    progress.value = motion.reduceMotion ? 1 : withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) });
  }, [signature, motion.active, motion.played, motion.reduceMotion, progress]);

  useEffect(() => {
    setSelected(null);
    cancelAnimation(progress);
    progress.value = motion.played.has(signature) || motion.reduceMotion ? 1 : 0;
    return () => cancelAnimation(progress);
  }, [signature, progress]);
  useEffect(() => {
    if (!motion.active || motion.reduceMotion) {
      cancelAnimation(progress);
      if (motion.played.has(signature) || motion.reduceMotion) progress.value = 1;
      if (!motion.active) setSelected(null);
    }
  }, [motion.active, motion.reduceMotion, motion.played, signature, progress]);
  useAnimatedReaction(() => {
    const header = Math.max(compactHeight, expandedHeight - Math.max(0, scrollY.value));
    const visible = active && visibleDrawing(expandedHeight + sectionTop.value + localTop.value,
      stacked ? 96 : HEIGHT, scrollY.value, viewportHeight.value, header, dockHeight);
    return visible ? signature : '';
  }, (key, previous) => { if (key && key !== previous) runOnJS(start)(); }, [signature, motion.active, start]);
  const clipProps = useAnimatedProps(() => ({ width: width * progress.value }));
  const labelsProps = useAnimatedProps(() => ({ opacity: interpolate(progress.value, [0.84,1], [0,1], 'clamp') }));
  const tooltipStyle = useAnimatedStyle(() => {
    const plotY = expandedHeight + sectionTop.value + localTop.value - scrollY.value;
    const header = Math.max(compactHeight, expandedHeight - Math.max(0,scrollY.value));
    const top = Math.max(header+8,Math.min(plotY+4,viewportHeight.value-dockHeight-tooltipHeight.value-8));
    return { transform: [{ translateY: top-plotY-4 }] };
  });
  const legendStyle = useAnimatedStyle(() => ({opacity:interpolate(progress.value,[0.84,1],[0,1],'clamp')}));
  useEffect(() => {
    const closeOutside = (point: {pageX:number;pageY:number} | null) => {
      const top = motion.expandedHeight + sectionTop.value + localTop.value - motion.scrollY.value;
      const header = Math.max(motion.compactHeight,motion.expandedHeight-Math.max(0,motion.scrollY.value));
      const tooltipTop = Math.max(header+8,Math.min(top+4,motion.viewportHeight.value-motion.dockHeight-tooltipHeight.value-8));
      const insidePlot = point && point.pageX>=plotLeft.value && point.pageX<=plotLeft.value+width && point.pageY>=top && point.pageY<=top+(stacked?96:HEIGHT);
      const insideTooltip = point && point.pageX>=plotLeft.value+8 && point.pageX<=plotLeft.value+8+Math.min(280,width-16) && point.pageY>=tooltipTop && point.pageY<=tooltipTop+tooltipHeight.value;
      if (!insidePlot && !insideTooltip) setSelected(null);
    };
    motion.touchObservers.add(closeOutside);
    return () => { motion.touchObservers.delete(closeOutside); };
  },[signature,motion,sectionTop,localTop,tooltipHeight,stacked,width,plotLeft]);
  useEffect(()=>{
    if(Platform.OS!=='web')return;
    const closeOutside=(event:PointerEvent)=>{
      const root=wrapperRef.current as unknown as HTMLElement|null;
      if(root && !root.contains(event.target as Node))setSelected(null);
    };
    document.addEventListener('pointerdown',closeOutside,true);
    return()=>document.removeEventListener('pointerdown',closeOutside,true);
  },[signature]);
  const select = (index: number | null) => {
    motion.touchObservers.forEach(observer=>observer(null));
    setSelected(index);
    onSelectChange?.();
    if (index !== null) AccessibilityInfo.announceForAccessibility(`${rows[index].title}, ${rows[index].formatted}`);
  };
  const selectedPoint = selected === null ? null : geometry.points[selected];
  const barSlot = (geometry.right - geometry.left) / Math.max(rows.length, 1);
  const barWidth = Math.max(1, Math.min(48, barSlot * 0.7));
  const barX = (index: number) => geometry.left + barSlot * (index + 0.5) - barWidth / 2;
  const labelStride = Math.max(1, Math.ceil(rows.length / (width < 340 ? 4 : 6)));
  const hasValues = values.some(value => value !== null);
  const svgHeight = stacked ? 58 : HEIGHT;
  const selectX = (x: number) => {
    if (!Number.isFinite(x)) { select(rows.length ? 0 : null); return; }
    if (!stacked && x < geometry.left) { select(null); return; }
    let index: number;
    if (stacked) {
      let accumulated = 0;
      index = rows.findIndex(row => { accumulated += Number(row.value); return x <= accumulated / total * width; });
    } else if (bars) index = Math.floor((x-geometry.left) / barSlot);
    else index = Math.round((x-geometry.left) / (geometry.right-geometry.left) * Math.max(0,rows.length-1));
    select(index >= 0 && index < rows.length ? index : null);
  };

  return <View ref={wrapperRef} onLayout={event => { localTop.value = event.nativeEvent.layout.y; setWidth(event.nativeEvent.layout.width); hitRef.current?.measureInWindow(left=>{plotLeft.value=left;}); }}>
    <View testID={`chart-${kind}`} style={{ height: stacked ? 96 : HEIGHT, position: 'relative' }}>
      {hasValues ? <>
        <Svg width={width} height={svgHeight} accessible={Platform.OS === 'web' ? undefined : false} aria-hidden>
          <Defs><ClipPath id={clipId}><AnimatedRect x={0} y={0} height={HEIGHT} animatedProps={clipProps} /></ClipPath></Defs>
          {!stacked ? [0,0.5,1].map(fraction => {
            const y = geometry.bottom - fraction * (geometry.bottom - geometry.top);
            const value = geometry.min + fraction * (geometry.max - geometry.min);
            return <G key={fraction}>
              <Line x1={geometry.left} x2={geometry.right} y1={y} y2={y} stroke={colors.borderSubtle} strokeDasharray={fraction ? '4 4' : undefined} />
              <SvgText x={geometry.left - 8} y={y + 4} textAnchor="end" fill={colors.textSecondary} fontSize={11}>
                {new Intl.NumberFormat('pt-BR', { maximumFractionDigits: kind === 'cost' || kind === 'price' ? 2 : 1, notation: value >= 10000 ? 'compact' : 'standard' }).format(value)}
              </SvgText>
            </G>;
          }) : null}
          {stacked ? <G>
            {rows.map((row,index) => {
              const before = values.slice(0,index).reduce<number>((sum,value) => sum + (value ?? 0),0);
              return <GrowingSegment key={row.id} x={total ? before / total * width : 0} width={total ? Number(row.value) / total * width : 0}
                progress={progress} color={chartColor(index)} opacity={selected === null || selected === index ? 1 : 0.35} />;
            })}
          </G> : bars ? rows.map((row,index) => geometry.points[index] && <GrowingBar key={row.id} x={barX(index)} y={geometry.points[index]!.y}
            width={barWidth} bottom={geometry.bottom} progress={progress}
            color={selected === index || selected === null && index === rows.length - 1 ? colors.brandPrimary : isDark ? '#3979C3' : '#8BBEF2'} />)
            : <G clipPath={`url(#${clipId})`}>
              <Path d={geometry.path} fill="none" stroke={colors.brandPrimary} strokeWidth={2.5} strokeLinejoin="round" />
              {geometry.points.map((point,index) => point && <Circle key={rows[index].id} cx={point.x} cy={point.y}
                r={selected === index ? 7 : 4.5} fill={colors.brandPrimary} stroke={colors.bgPrimary} strokeWidth={2} />)}
            </G>}
          {!stacked && !bars && selectedPoint ? <Line testID={`guide-${kind}`} x1={selectedPoint.x} x2={selectedPoint.x} y1={geometry.top} y2={geometry.bottom}
            stroke={colors.textSecondary} strokeDasharray="3 4" /> : null}
          {!stacked ? <AnimatedGroup animatedProps={labelsProps}>
            {rows.map((row,index) => {
              if (index % labelStride !== 0 && index !== rows.length - 1) return null;
              const x = bars ? barX(index) + barWidth / 2 : geometry.points[index]?.x ?? geometry.left + index * (geometry.right-geometry.left)/Math.max(1,rows.length-1);
              const lastLineLabel = !bars && rows.length > 1 && index === rows.length - 1;
              return <G key={row.id}>
                {row.label.split('\n').map((line,lineIndex) => <SvgText key={lineIndex} x={lastLineLabel?width-4:x} y={geometry.bottom+15+lineIndex*12}
                  fontSize={10} fill={colors.textSecondary} textAnchor={lastLineLabel?'end':'middle'}>{line}</SvgText>)}
                {bars && rows.length <= 6 && geometry.points[index] ? <SvgText x={x} y={Math.max(12,geometry.points[index]!.y-7)}
                  fontSize={10} textAnchor="middle" fill={colors.textPrimary}>{new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(row.value))}</SvgText> : null}
              </G>;
            })}
          </AnimatedGroup> : null}
        </Svg>
        <Pressable ref={hitRef} style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Selecionar dado no gráfico. Consulte também os dados em lista."
          onPress={event => {
            if(Platform.OS==='web'){
              const target=event.currentTarget as unknown as HTMLElement;
              const native=event.nativeEvent as unknown as MouseEvent;
              selectX(native.clientX-target.getBoundingClientRect().left);
            } else selectX(event.nativeEvent.locationX);
          }} />
      </> : <View style={styles.empty}><Text style={[styles.body,{color:colors.textSecondary}]}>Nenhum valor disponível para desenhar neste período.</Text></View>}
      {selected !== null ? <Animated.View testID={`tooltip-${kind}`} onLayout={event=>{tooltipHeight.value=event.nativeEvent.layout.height;}}
        style={[styles.tooltip,{ maxWidth: width-16, backgroundColor:colors.bgElevated,borderColor:colors.borderFocus },tooltipStyle]}>
        <Text style={[styles.caption,{color:colors.textSecondary}]}>{rows[selected].title}</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.bodyStrong,{color:colors.textPrimary}]}>{rows[selected].formatted}</Text>
        <View style={styles.tooltipActions}>
          <Pressable accessibilityRole="button" onPress={() => onDetails(rows[selected])} style={styles.action}><Text style={[styles.bodyStrong,{color:colors.brandPrimary}]}>Ver detalhes</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Fechar seleção" onPress={() => select(null)} style={styles.action}><Text style={[styles.body,{color:colors.textSecondary}]}>Fechar</Text></Pressable>
        </View>
      </Animated.View> : null}
    </View>
    {stacked ? <Animated.View style={legendStyle}>{rows.map((row,index) => <Pressable key={row.id} accessibilityRole="button" accessibilityState={{selected:selected===index}}
      accessibilityLabel={`${row.title}, ${row.formatted}`} onPress={() => select(index)} style={styles.legendRow}>
      <View style={[styles.legendDot,{backgroundColor:chartColor(index)}]} /><Text style={[styles.body,{flex:1,color:colors.textPrimary}]}>{row.label}</Text>
      <Text style={[styles.bodyStrong,{color:colors.textPrimary}]}>{row.formatted}</Text>
    </Pressable>)}</Animated.View> : null}
    <Pressable accessibilityRole="button" onPress={onList} style={styles.listAction}><Text style={[styles.bodyStrong,{color:colors.brandPrimary}]}>Consultar dados em lista</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  body: {...typography.body}, bodyStrong: {...typography.bodyStrong}, caption: {...typography.caption},
  empty: {flex:1,justifyContent:'center',padding:20},
  tooltip: {position:'absolute',top:4,left:8,width:280,paddingHorizontal:12,paddingTop:8,borderWidth:1,borderRadius:12,zIndex:4},
  tooltipActions: {flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:8}, action: {minHeight:48,minWidth:0,flexShrink:1,justifyContent:'center',paddingHorizontal:4},
  listAction: {minHeight:48,justifyContent:'center',alignSelf:'flex-start'},
  legendRow: {flexDirection:'row',alignItems:'center',gap:10,minHeight:48,flexWrap:'wrap'}, legendDot:{width:11,height:11,borderRadius:6},
});
