import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { FUEL_TYPE_LABELS, UNAVAILABLE_REASON_EXPLANATIONS } from '@/api/endpoints';
import type { FuelType } from '@/api/types';
import { CalendarIcon, ChevronDownIcon, DropletIcon } from '@/components/icons/AppIcons';
import { AppSheet } from '@/components/overlays/AppSheet';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { CalendarRangePicker } from '@/features/history/components/CalendarRangePicker';
import { formatPeriodSummaryBR } from '@/features/history/helpers/calendarHelper';
import { useAppTheme } from '@/theme/ThemeProvider';
import { typography } from '@/theme/tokens';
import { DashboardCache, dashboardPeriod, datasetSignature, type DashboardPeriod } from './model';
import { chartRows, chartValue, CHART_TITLES, type ChartDatum, type ChartKind } from './presentation';
import { DashboardPlot } from './DashboardPlot';
import { useDashboardData } from './useDashboard';

export function DashboardSection({ kind, cache, scope, vehicleId, version, timezone, allowedFuels, onHistory }: {
  kind: ChartKind; cache: DashboardCache; scope: string; vehicleId: string | null; version: number; timezone: string;
  allowedFuels: FuelType[]; onHistory: (row: ChartDatum) => void;
}) {
  const { colors } = useAppTheme();
  const { width, fontScale } = useWindowDimensions();
  const stackedFilters=width<350 || fontScale>1.2;
  const [period, setPeriod] = useState<DashboardPeriod>(() => dashboardPeriod(kind === 'fuel' ? 1 : 6,timezone));
  const [fuel, setFuel] = useState<FuelType | null>(null);
  const [menu, setMenu] = useState<'period' | 'calendar' | 'fuel' | null>(null);
  const [detail, setDetail] = useState<ChartDatum | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const sectionTop = useSharedValue(0);
  const params = useMemo(() => ({ from: period.from, to: period.to, timezone, fuelType: fuel }), [period.from,period.to,timezone,fuel]);
  const { data, loading, error, retry } = useDashboardData(cache,scope,vehicleId,version,params);
  const rows = useMemo(() => data ? chartRows(kind,data,period,fuel) : [],[data,kind,period,fuel]);
  const signature = datasetSignature([scope,kind,params,rows]);
  useEffect(() => { setMenu(null); setDetail(null); setListOpen(false); }, [scope]);
  useEffect(() => { setDetail(null); setListOpen(false); }, [signature]);
  useEffect(() => { if (fuel && !allowedFuels.includes(fuel)) setFuel(null); }, [allowedFuels,fuel]);
  const setRange = (range: DashboardPeriod) => { setPeriod(range); setMenu(null); };
  const unit = kind === 'consumption' ? 'km/L' : kind === 'cost' ? 'R$/km' : kind === 'price' ? 'R$/L' : kind === 'liters' ? 'Litros (L)' : 'Reais (R$)';
  const stat = !data ? null : kind === 'consumption' ? chartValue(kind,data.consumptionKmPerLiter) : kind === 'cost' ? chartValue(kind,data.replacementCostPerKm)
    : kind === 'price' && data.prices.length ? chartValue(kind,data.prices[data.prices.length-1].unitPrice) : null;
  const note = !data ? '' : kind === 'consumption' || kind === 'cost'
    ? `${data.validCycleCount} ${data.validCycleCount === 1 ? 'ciclo válido' : 'ciclos válidos'} · ${fuel ? 'Somente ciclos puros deste combustível.' : 'Inclui ciclos mistos identificados nos detalhes.'}`
    : kind === 'price' ? 'Último preço declarado · por abastecimento' : '';
  const empty = kind === 'consumption' || kind === 'cost'
    ? data?.unavailableReason ? UNAVAILABLE_REASON_EXPLANATIONS[data.unavailableReason].description : 'Nenhum ciclo válido neste período.'
    : 'Nenhum abastecimento neste período e combustível.';
  const isMetric=kind==='consumption'||kind==='cost'||kind==='price';
  const statusHeight=kind==='fuel'?144+allowedFuels.length*48:312;

  return <View testID={`section-${kind}`} onLayout={event => { sectionTop.value = event.nativeEvent.layout.y; }}
    style={[styles.section,{borderTopColor:colors.borderSubtle}]}>
    <Text role="heading" aria-level={2} style={[styles.title,{color:colors.textPrimary}]}>{CHART_TITLES[kind]}</Text>
    <View style={[styles.filters,stackedFilters && {flexDirection:'column'}]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Período: ${period.label}. ${CHART_TITLES[kind]}`}
        onPress={() => setMenu('period')} style={[styles.filter,stackedFilters && styles.stackedFilter,{borderColor:colors.borderSubtle}]}>
        <CalendarIcon size={20} color={colors.textPrimary} /><Text style={[styles.filterLabel,{color:colors.textPrimary}]}>{period.label}</Text><ChevronDownIcon size={16} color={colors.brandPrimary} />
      </Pressable>
      {kind !== 'fuel' ? <Pressable accessibilityRole="button" accessibilityLabel={`Combustível: ${fuel ? FUEL_TYPE_LABELS[fuel] : 'Todos'}. ${CHART_TITLES[kind]}`}
        onPress={() => setMenu('fuel')} style={[styles.filter,stackedFilters && styles.stackedFilter,{borderColor:colors.borderSubtle}]}>
        <DropletIcon size={20} color={colors.textPrimary} /><Text style={[styles.filterLabel,{color:colors.textPrimary}]}>{fuel ? FUEL_TYPE_LABELS[fuel] : 'Todos os combustíveis'}</Text><ChevronDownIcon size={16} color={colors.brandPrimary} />
      </Pressable> : null}
    </View>
    {isMetric ? <View style={{minHeight:kind==='price'?86:108,gap:6}}>
      <Text style={[styles.stat,{color:colors.textPrimary}]}>{stat && stat!=='Indisponível'?stat:'—'}</Text>
      <Text style={[styles.body,{color:colors.textSecondary}]}>{note || (kind==='price'?'Por abastecimento':'Entre tanques cheios.')}</Text>
    </View> : null}
    {error && data ? <View><Text accessibilityRole="alert" style={[styles.body,{color:colors.dangerText}]}>{error}</Text><PrimaryButton label="Tentar novamente" variant="ghost" onPress={retry}/></View>:null}
    {loading && !data ? <View style={[styles.status,{minHeight:statusHeight}]} accessibilityRole="progressbar" accessibilityLabel={`Carregando ${CHART_TITLES[kind]}`}>
      <ActivityIndicator color={colors.brandPrimary} /><Text style={[styles.body,{color:colors.textSecondary}]}>Carregando gráfico...</Text>
    </View> : error && !data ? <View style={[styles.status,{minHeight:statusHeight}]}>
      <Text accessibilityRole="alert" style={[styles.body,{color:colors.dangerText}]}>{error}</Text>
      <PrimaryButton label="Tentar novamente" variant="secondary" onPress={retry} />
    </View> : rows.length ? <>
      {kind !== 'fuel' ? <Text style={[styles.unit,{color:colors.textSecondary}]}>{unit}</Text> : null}
      {rows.every(row=>row.value===null) ? <Text style={[styles.body,{color:colors.textSecondary}]}>{empty}</Text> : null}
      <DashboardPlot kind={kind} rows={rows} signature={signature} sectionTop={sectionTop} onDetails={setDetail} onList={() => setListOpen(true)} />
    </> : <View testID={`chart-${kind}`} style={[styles.status,{minHeight:statusHeight}]}><Text style={[styles.body,{color:colors.textSecondary}]}>{empty}</Text></View>}

    <AppSheet modal visible={menu !== null} title={menu === 'fuel' ? 'Selecionar combustível' : menu === 'calendar' ? 'Selecionar período' : 'Período do gráfico'}
      subtitle={CHART_TITLES[kind]} onClose={() => setMenu(null)}>
      {menu === 'calendar' ? <CalendarRangePicker initialStart={period.from} initialEnd={period.to}
        onConfirm={(from,to) => setRange({from,to,label:formatPeriodSummaryBR(from,to)})}
        onSelectAllHistory={() => setRange({from:null,to:null,label:'Todo o histórico'})} />
        : menu === 'period' ? <View style={styles.options}>
          {[3,6].map(months => <PrimaryButton key={months} label={`${months} meses`} variant="secondary" onPress={() => setRange(dashboardPeriod(months,timezone))} />)}
          <PrimaryButton label="Este mês" variant="secondary" onPress={() => setRange(dashboardPeriod(1,timezone))} />
          <PrimaryButton label="Período personalizado" variant="secondary" onPress={() => setMenu('calendar')} />
        </View> : <View style={styles.options}>
          <PrimaryButton label="Todos os combustíveis" variant="secondary" onPress={() => { setFuel(null); setMenu(null); }} />
          {allowedFuels.map(type => <PrimaryButton key={type} label={FUEL_TYPE_LABELS[type]} variant="secondary" onPress={() => { setFuel(type); setMenu(null); }} />)}
        </View>}
    </AppSheet>
    <AppSheet modal visible={detail !== null || listOpen} title={detail ? detail.title : `Dados: ${CHART_TITLES[kind]}`} onClose={() => { setDetail(null); setListOpen(false); }}>
      {detail ? <View style={styles.options}>
        {detail.fields.map(([label,value]) => <View key={label} style={[styles.detailRow,{borderBottomColor:colors.borderSubtle}]}>
          <Text style={[styles.body,{color:colors.textSecondary}]}>{label}</Text><Text style={[styles.detailValue,{color:colors.textPrimary}]}>{value}</Text>
        </View>)}
        <PrimaryButton label="Ver abastecimentos" onPress={() => { onHistory(detail); setDetail(null); setListOpen(false); }} />
      </View> : <View style={styles.options}>
        {rows.map(row => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`${row.title}, ${row.formatted}. Ver detalhes`}
          onPress={() => setDetail(row)} style={[styles.dataRow,{borderBottomColor:colors.borderSubtle}]}>
          <Text style={[styles.body,{color:colors.textSecondary}]}>{row.title}</Text><Text style={[styles.detailValue,{color:colors.textPrimary}]}>{row.formatted}</Text>
        </Pressable>)}
      </View>}
    </AppSheet>
  </View>;
}
const styles = StyleSheet.create({
  section:{borderTopWidth:1,paddingTop:22,paddingBottom:16,gap:12},title:{...typography.sectionTitle,fontSize:22,lineHeight:29},
  filters:{flexDirection:'row',flexWrap:'wrap',gap:8},filter:{flexGrow:1,flexShrink:1,flexBasis:140,minHeight:48,borderWidth:1,borderRadius:10,paddingHorizontal:10,paddingVertical:8,flexDirection:'row',alignItems:'center',gap:8},
  stackedFilter:{flexBasis:'auto',flexGrow:0,flexShrink:0,width:'100%'},
  filterLabel:{...typography.body,flex:1},stat:{...typography.heroValue,fontSize:36,lineHeight:46,marginTop:6},body:{...typography.body},unit:{...typography.caption,marginTop:10},
  status:{minHeight:220,justifyContent:'center',gap:16},options:{gap:12,paddingVertical:8},detailRow:{gap:4,borderBottomWidth:1,paddingVertical:10},detailValue:{...typography.bodyStrong,fontVariant:['tabular-nums']},
  dataRow:{minHeight:68,paddingVertical:12,borderBottomWidth:1,gap:6},
});
