import { useRouter } from 'expo-router';
import React, { useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { PixelMascot } from '@/components/brand/PixelMascot';
import { EmptyState } from '@/components/feedback/EmptyState';
import { CarIcon, ChevronDownIcon, PlusIcon } from '@/components/icons/AppIcons';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { TabActiveContext, useAuthenticatedHeader } from '@/components/navigation/AuthenticatedTabShell';
import { FloatingDock } from '@/components/navigation/FloatingDock';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { VehicleFormSheet } from '@/features/vehicles/VehicleFormSheet';
import { useMotionPolicy } from '@/motion/useMotionPolicy';
import { useSession } from '@/state/SessionContext';
import { useAppTheme } from '@/theme/ThemeProvider';
import { layout, typography } from '@/theme/tokens';
import { formatCurrencyBRL } from '@/utils/decimal';
import { DashboardSection } from './dashboard/DashboardSection';
import { DashboardCache, dashboardPeriod } from './dashboard/model';
import { DashboardMotionContext, useDashboardData } from './dashboard/useDashboard';
import type { ChartDatum, ChartKind } from './dashboard/presentation';

const CHARTS: ChartKind[] = ['spending','fuel','consumption','cost','price','liters'];
export function HomeScreen({ embeddedInShell = false }: { embeddedInShell?: boolean } = {}) {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { status,user,vehicles,activeVehicle,selectVehicle,dataVersion } = useSession();
  const activeTab = useContext(TabActiveContext);
  const { reduceMotion,isAppActive } = useMotionPolicy();
  const { width,fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { headerHeight: measuredHeader } = useAuthenticatedHeader();
  const headerHeight = embeddedInShell && measuredHeader ? measuredHeader : insets.top + 60;
  const selectorHeight = Math.max(48,48*fontScale);
  const compactHeight = headerHeight + selectorHeight;
  const expandedHeight = Math.max(compactHeight, Math.min(width,620)*0.74 + insets.top);
  const scrollY = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const timezone = user?.preferredTimezone || 'America/Sao_Paulo';
  const scope = `${status}:${user?.id ?? 'anonymous'}:${activeVehicle?.id ?? 'none'}`;
  const vehicleId = status === 'authenticated' && user ? activeVehicle?.id ?? null : null;
  const cache = useMemo(() => new DashboardCache(),[status,user?.id]);
  const played = useMemo(() => new Set<string>(),[status,user?.id]);
  const touchObservers = useMemo(() => new Set<(point: {pageX:number;pageY:number} | null) => void>(),[status,user?.id]);
  const month = useMemo(() => dashboardPeriod(1,timezone),[timezone]);
  const summary = useDashboardData(cache,scope,vehicleId,dataVersion,{from:month.from,to:month.to,timezone});
  const [vehicleOpen,setVehicleOpen] = useState(false);
  const [createOpen,setCreateOpen] = useState(false);
  useEffect(() => { setVehicleOpen(false); setCreateOpen(false); },[scope,activeTab]);
  const onScroll = useAnimatedScrollHandler({ onScroll: event => {
    if (activeTab) scrollY.value = Math.max(0,event.contentOffset.y);
  } });
  const landscapeStyle = useAnimatedStyle(() => ({ height:Math.max(compactHeight,expandedHeight-scrollY.value) }));
  const tailStyle = useAnimatedStyle(() => {
    const fraction=Math.min(1,scrollY.value/Math.max(1,expandedHeight-compactHeight));
    return {height:28-16*fraction,bottom:Math.max(0,width*(0.08-0.098*fraction))};
  });
  const imageSource = isDark ? require('@/assets/brand/scene_night_road_compact.png') : require('@/assets/brand/scene_day_road_compact.png');
  const resolved = Image.resolveAssetSource?.(imageSource);
  const expandedSceneWidth = Math.max(width,Math.min(width,620)*1.65);
  const sceneRatio = resolved?.height && resolved?.width ? resolved.height/resolved.width : 2/3;
  const imageStyle = useAnimatedStyle(() => {
    const fraction=Math.min(1,scrollY.value/Math.max(1,expandedHeight-compactHeight));
    // One opaque scene keeps the skyline and subjects continuous while reframing.
    const imageWidth=expandedSceneWidth+(width-expandedSceneWidth)*fraction;
    const height=Math.max(compactHeight,expandedHeight-scrollY.value);
    return {width:imageWidth,height:imageWidth*sceneRatio,
      right:0,
      top:height-imageWidth*sceneRatio-width*(0.08-0.098*fraction)};
  });
  const motion = useMemo(() => ({ scrollY,viewportHeight,expandedHeight,compactHeight,dockHeight:Math.max(layout.bottomDockClearance,insets.bottom+76),
    active:activeTab && isAppActive,reduceMotion,played,touchObservers }),[expandedHeight,compactHeight,activeTab,isAppActive,reduceMotion,played,touchObservers,insets.bottom,scrollY,viewportHeight]);
  const onHistory = (row: ChartDatum) => {
    const params: Record<string,string> = { vehicleId: vehicleId ?? '', source:'dashboard', selection:`${row.id}:${Date.now()}` };
    for (const [key,value] of Object.entries(row.history)) if (value) params[key] = value;
    router.push({pathname:'/history',params});
  };

  return <ScreenShell scrollable={false} edgeToEdge withDockClearance omitTopSafeArea transitionActive={false}
    footer={embeddedInShell ? undefined : <FloatingDock activeTab="home" />}>
    <DashboardMotionContext.Provider value={motion}>
      <View style={styles.flex} onTouchStart={event => touchObservers.forEach(observer=>observer({pageX:event.nativeEvent.pageX,pageY:event.nativeEvent.pageY}))}
        onLayout={event => { viewportHeight.value = event.nativeEvent.layout.height; }}>
        <Animated.ScrollView testID="dashboard-scroll" style={styles.flex} onScroll={onScroll} scrollEventThrottle={16}
          onScrollBeginDrag={() => touchObservers.forEach(observer=>observer(null))}
          contentContainerStyle={{paddingBottom:motion.dockHeight+20}} keyboardShouldPersistTaps="handled">
          <View style={{height:expandedHeight}} />
          <View style={[styles.content,{paddingHorizontal:width<350?16:20}]}>
            {vehicles.length === 0 ? <EmptyState title="Bem-vindo ao FuelLog!" description="Cadastre seu primeiro veículo para acompanhar gastos e abastecimentos."
              action={<PrimaryButton label="Cadastrar veículo" leftIcon={<PlusIcon size={18} color={colors.onBrand} />} onPress={() => setCreateOpen(true)} />} /> : <>
              <View style={styles.intro}>
                <Text role="heading" aria-level={1} style={[styles.pageTitle,{color:colors.textPrimary}]}>Visão geral</Text>
                <Text style={[styles.subtitle,{color:colors.textSecondary}]}>Seu combustível em números</Text>
                <Text style={[styles.summaryTitle,{color:colors.textPrimary}]}>Gasto em {month.label.toLowerCase()}</Text>
                {summary.loading && !summary.data ? <View accessibilityRole="progressbar" accessibilityLabel="Carregando gasto do mês" style={styles.summaryPending}><ActivityIndicator color={colors.brandPrimary} /></View>
                  : summary.error ? <View style={styles.summaryPending}><Text accessibilityRole="alert" style={[styles.body,{color:colors.dangerText}]}>{summary.error}</Text><PrimaryButton label="Tentar novamente" variant="ghost" onPress={summary.retry} /></View>
                    : <><Text testID="dashboard-month-total" style={[styles.amount,{color:colors.textPrimary}]}>{summary.data ? formatCurrencyBRL(summary.data.paidTotal) : '—'}</Text>
                      <Text style={[styles.body,{color:colors.textSecondary}]}>{summary.data ? `${summary.data.purchaseCount} ${summary.data.purchaseCount===1?'abastecimento':'abastecimentos'}` : 'Resumo indisponível'}</Text></>}
              </View>
              {CHARTS.map(kind => <DashboardSection key={kind} kind={kind} cache={cache} scope={scope} vehicleId={vehicleId} version={dataVersion}
                timezone={timezone} allowedFuels={activeVehicle?.allowedFuels ?? []} onHistory={onHistory} />)}
            </>}
          </View>
        </Animated.ScrollView>
        <Animated.View testID="dashboard-landscape" style={[styles.landscape,{backgroundColor:colors.bgPrimary},landscapeStyle]}>
          <Animated.Image testID="dashboard-compact-art" source={imageSource} resizeMode="cover" accessible={false} style={[styles.scene,imageStyle]} />
          <Animated.View style={[styles.tail,tailStyle]} pointerEvents="none"><Svg height="100%" width="100%"><Defs><LinearGradient id="dashboard-tail" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0" stopColor={colors.bgPrimary} stopOpacity={0}/><Stop offset="1" stopColor={colors.bgPrimary} stopOpacity={1}/>
          </LinearGradient></Defs><Rect width="100%" height="100%" fill="url(#dashboard-tail)"/></Svg></Animated.View>
          {!embeddedInShell ? <View pointerEvents="box-none" style={[styles.standaloneHeader,{top:insets.top+16}]}><View pointerEvents="none"><BrandLockup mode="wordmark-only" wordmarkWidth={96}/></View>
            <Pressable style={styles.avatarButton} accessibilityRole="button" accessibilityLabel="Minha conta" onPress={() => router.push('/account')}><PixelMascot variant="avatar" size={24} withFrame /></Pressable></View> : null}
          <View style={[styles.selectorContainer,{top:headerHeight-20+Math.max(0,fontScale-1)*20,paddingHorizontal:width<350?16:20,minHeight:selectorHeight}]} pointerEvents="box-none">
            <Pressable testID="dashboard-vehicle" accessibilityRole="button" accessibilityLabel={`Veículo selecionado: ${activeVehicle?.nickname ?? 'Selecionar veículo'}`}
              onPress={() => setVehicleOpen(true)} style={[styles.selector,{minHeight:selectorHeight,maxWidth:width*0.36}]}>
              <Text numberOfLines={2} style={[styles.vehicleLabel,{color:isDark?'#FFFFFF':'#111D35'}]}>{activeVehicle?.nickname ?? 'Selecionar veículo'}</Text><ChevronDownIcon size={16} color={isDark?'#FFFFFF':colors.brandPrimary}/>
            </Pressable>
          </View>
        </Animated.View>
      </View>
      <AppSheet modal visible={vehicleOpen} title="Selecionar veículo" onClose={() => setVehicleOpen(false)}><View style={styles.options}>
        {vehicles.map(vehicle => <PrimaryButton key={vehicle.id} label={vehicle.nickname} variant="secondary" leftIcon={<CarIcon size={20} color={colors.textPrimary}/>}
          onPress={() => { void selectVehicle(vehicle.id); setVehicleOpen(false); }} />)}
        <PrimaryButton label="Novo veículo" onPress={() => {setVehicleOpen(false);setCreateOpen(true);}} />
      </View></AppSheet>
      <VehicleFormSheet visible={createOpen} onClose={() => setCreateOpen(false)} onCreated={async vehicle => {await selectVehicle(vehicle.id);setCreateOpen(false);}} />
    </DashboardMotionContext.Provider>
  </ScreenShell>;
}
const styles=StyleSheet.create({
  flex:{flex:1},content:{width:'100%',maxWidth:460,alignSelf:'center'},intro:{paddingTop:12,paddingBottom:24,gap:6},
  pageTitle:{...typography.screenTitle,fontSize:29,lineHeight:38},subtitle:{...typography.body,fontSize:17,lineHeight:25},
  summaryTitle:{...typography.cardTitle,marginTop:20},body:{...typography.body},amount:{...typography.heroValue,fontSize:40,lineHeight:54},
  summaryPending:{minHeight:88,justifyContent:'center'},landscape:{position:'absolute',top:0,left:0,right:0,overflow:'hidden',zIndex:5},scene:{position:'absolute'},
  tail:{position:'absolute',bottom:0,left:0,right:0},
  selectorContainer:{position:'absolute',left:0,right:0,width:'100%',maxWidth:460,alignSelf:'center'},selector:{minHeight:48,flexDirection:'row',alignItems:'center',gap:4,alignSelf:'flex-start',maxWidth:'55%'},
  vehicleLabel:{...typography.cardTitle,fontSize:14,lineHeight:20,flexShrink:1},standaloneHeader:{position:'absolute',left:20,right:20,minHeight:44,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},avatarButton:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},options:{gap:12,paddingVertical:8},
});
