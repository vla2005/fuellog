import { createContext, useEffect, useRef, useState } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import { getDashboard, type DashboardParams } from '@/api/endpoints';
import type { DashboardResponse } from '@/api/types';
import { DashboardCache, datasetSignature } from './model';

export interface DashboardMotion {
  scrollY: SharedValue<number>;
  viewportHeight: SharedValue<number>;
  expandedHeight: number;
  compactHeight: number;
  dockHeight: number;
  active: boolean;
  reduceMotion: boolean;
  played: Set<string>;
  touchObservers: Set<(point: {pageX:number;pageY:number} | null) => void>;
}
export const DashboardMotionContext = createContext<DashboardMotion | null>(null);

export function useDashboardData(cache: DashboardCache, scope: string, vehicleId: string | null, version: number, params: DashboardParams) {
  const queryKey = datasetSignature([scope, vehicleId,
    {from:params.from ?? null,to:params.to ?? null,timezone:params.timezone,fuelType:params.fuelType ?? null}]);
  const key = `${version}:${queryKey}`;
  const latest = useRef(key); latest.current = key;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; queryKey: string; data?: DashboardResponse; error?: string; loading: boolean }>({ key, queryKey, loading: true });
  useEffect(() => {
    let mounted = true;
    if (!vehicleId) { setState({ key, queryKey, loading: false }); return; }
    setState(previous=>({ key,queryKey,loading:true,data:previous.queryKey===queryKey?previous.data:undefined }));
    cache.read(key, () => getDashboard(vehicleId, params)).then(data => {
      if (mounted && latest.current === key) setState({ key, queryKey, data, loading: false });
    }, error => {
      if (mounted && latest.current === key) setState(previous=>({ key, queryKey, loading: false,
        data:previous.queryKey===queryKey?previous.data:undefined,error: error instanceof Error ? error.message : 'Não foi possível carregar este gráfico.' }));
    });
    return () => { mounted = false; };
    // The canonical key includes every request parameter; object identity is irrelevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, key, attempt]);
  return { ...(state.queryKey === queryKey ? {...state,loading:state.key!==key || state.loading} : { data: undefined, error: undefined, loading: Boolean(vehicleId) }),
    retry: () => { cache.evict(key); setAttempt(value => value + 1); } };
}
