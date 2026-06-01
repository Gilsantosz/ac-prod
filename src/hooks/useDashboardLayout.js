import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/lib/localDb';
import { toast } from 'sonner';

// Ordena uma lista de ids conforme a ordem salva, mantendo novos ids no fim
function applyOrder(defaultIds, savedOrder) {
  if (!Array.isArray(savedOrder) || !savedOrder.length) return defaultIds;
  const known = savedOrder.filter((id) => defaultIds.includes(id));
  const missing = defaultIds.filter((id) => !known.includes(id));
  return [...known, ...missing];
}

export function useDashboardLayout(defaultIds) {
  const [order, setOrder] = useState(defaultIds);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    base44.auth.me()
      .then((user) => {
        if (active) setOrder(applyOrder(defaultIds, user?.dashboard_layout));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reorder = useCallback(async (newOrder) => {
    setOrder(newOrder);
    setSaving(true);
    try {
      await base44.auth.updateMe({ dashboard_layout: newOrder });
      toast.success('Layout salvo');
    } catch {
      toast.error('Não foi possível salvar o layout');
    } finally {
      setSaving(false);
    }
  }, []);

  return { order, reorder, saving };
}