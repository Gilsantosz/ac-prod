import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/lib/localDb';
import { toast } from 'sonner';

const OLD_CHARTS = ['hourly', 'cellChart', 'shiftChart'];
export function mergeDashboardLayout(saved, defaultIds) {
  const source = Array.isArray(saved) ? { order: saved } : saved && typeof saved === 'object' ? saved : {};
  const expand = (ids) => (Array.isArray(ids) ? ids : []).flatMap((id) => id === 'charts' ? OLD_CHARTS : [id]);
  const order = [...new Set([...expand(source.order), ...defaultIds])].filter((id) => defaultIds.includes(id));
  const hidden = [...new Set(expand(source.hidden))].filter((id) => defaultIds.includes(id));
  const sizes = Object.fromEntries(defaultIds.map((id) => [id,
    ['full', 'half'].includes(source.sizes?.[id]) ? source.sizes[id]
      : OLD_CHARTS.includes(id) ? (['full', 'half'].includes(source.sizes?.charts) ? source.sizes.charts : 'half') : 'full']));
  return { order, hidden, sizes };
}

export function useDashboardLayout(defaultIds) {
  const [layout, setLayout] = useState(() => mergeDashboardLayout(null, defaultIds));
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const current = useRef(layout);
  const saved = useRef(layout);
  const pending = useRef(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    setReady(false);
    base44.auth.me().then((user) => {
      if (!active) return;
      current.current = saved.current = mergeDashboardLayout(user?.dashboard_layout, defaultIds);
      setLayout(current.current);
      setReady(true);
    }).catch(() => { if (active) toast.error('Não foi possível carregar sua organização. Recarregue a página para editar o layout.'); });
    return () => { active = false; mounted.current = false; };
  }, [defaultIds]);

  // Serialize writes; rapid edits coalesce, preventing an older response overwriting the newest layout.
  const persist = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSaving(true);
    let succeeded = false;
    while (pending.current) {
      const next = pending.current;
      pending.current = null;
      try {
        await base44.auth.updateMe({ dashboard_layout: next });
        saved.current = next;
        succeeded = true;
      } catch {
        succeeded = false;
        if (!pending.current && mounted.current) { current.current = saved.current; setLayout(saved.current); }
        toast.error('Não foi possível salvar a organização. Tente novamente.');
      }
    }
    running.current = false;
    if (mounted.current) setSaving(false);
    if (succeeded) toast.success('Organização salva no seu perfil.');
  }, []);
  const change = useCallback((update) => {
    if (!ready) return;
    const next = mergeDashboardLayout(update(current.current), defaultIds);
    current.current = next;
    setLayout(next);
    pending.current = next;
    void persist();
  }, [ready, defaultIds, persist]);
  const reorder = useCallback((visible) => change((prev) => {
    const ids = new Set(visible); let index = 0;
    return { ...prev, order: prev.order.map((id) => ids.has(id) ? visible[index++] : id) };
  }), [change]);
  const toggleHidden = useCallback((id) => change((prev) => ({ ...prev,
    hidden: prev.hidden.includes(id) ? prev.hidden.filter((value) => value !== id) : [...prev.hidden, id] })), [change]);
  const toggleSize = useCallback((id) => change((prev) => ({ ...prev,
    sizes: { ...prev.sizes, [id]: prev.sizes[id] === 'half' ? 'full' : 'half' } })), [change]);
  return { order: layout.order.filter((id) => !layout.hidden.includes(id)), hidden: layout.hidden,
    sizes: layout.sizes, reorder, toggleHidden, toggleSize, saving, ready };
}
