import { useCallback, useEffect, useRef, useState } from 'react';
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
  const reload = useCallback(async () => {
    if (!user || !active) return;
    const seq = ++sequence.current, epoch = getCurrentSessionEpoch();
    const valid = () => seq === sequence.current && epoch === getCurrentSessionEpoch();
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
  }, [active, withCatalog, user?.id, getCurrentSessionEpoch]);
  useEffect(() => {
    setStatus(null); setCatalog(null); setError(null);
    void reload();
    return () => { sequence.current++; };
  }, [reload]);
  return { status, catalog, error, loading, reload };
}
