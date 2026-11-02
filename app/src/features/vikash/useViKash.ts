import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getViKashCatalog, getViKashStatus } from '@/api/endpoints';
import { ApiError, ViKashCatalog, ViKashStatus } from '@/api/types';
import { useSession } from '@/state/SessionContext';

export function useViKash(active = true, withCatalog = true) {
  const { user, getCurrentSessionEpoch } = useSession();
  const [status, setStatus] = useState<ViKashStatus | null>(null);
  const [catalog, setCatalog] = useState<ViKashCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const enabled = useRef(active);
  enabled.current = active;
  const epoch = getCurrentSessionEpoch();
  const reload = useCallback(async () => {
    if (!mounted.current || !user || !active || !enabled.current || epoch !== getCurrentSessionEpoch()) return;
    const seq = ++sequence.current;
    const valid = () => mounted.current && seq === sequence.current && epoch === getCurrentSessionEpoch();
    setLoading(true); setError(null);
    try {
      const next = await getViKashStatus();
      if (!valid()) return;
      setStatus(next); setCatalog(null);
      if (next.status === 'CONNECTED' && withCatalog) {
        const options = await getViKashCatalog();
        if (valid()) setCatalog(options);
      }
    } catch (err) {
      if (valid()) setError(err instanceof ApiError ? err.message : 'ViKash indisponível. Tente novamente.');
    } finally { if (valid()) setLoading(false); }
  }, [active, withCatalog, user?.id, epoch, getCurrentSessionEpoch]);
  useEffect(() => {
    mounted.current = true;
    setStatus(null); setCatalog(null); setError(null); setLoading(false);
    void reload();
    let appState = AppState.currentState;
    const subscription = active && user ? AppState.addEventListener('change', next => {
      const wasActive = appState === 'active';
      appState = next;
      if (!wasActive && next === 'active') void reload();
    }) : null;
    return () => { mounted.current = false; sequence.current++; subscription?.remove(); };
  }, [reload]);
  return { status, catalog, error, loading, reload };
}
