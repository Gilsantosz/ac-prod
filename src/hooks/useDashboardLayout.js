import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/lib/localDb';
import { toast } from 'sonner';

// IDs padrão de todos os painéis disponíveis
const DEFAULT_LAYOUT = {
  order: [],   // preenchido com defaultIds se vazio
  hidden: [],
  sizes: {},   // 'full' | 'half' por panel id
};

function applyOrder(defaultIds, savedOrder) {
  if (!Array.isArray(savedOrder) || !savedOrder.length) return defaultIds;
  const known = savedOrder.filter((id) => defaultIds.includes(id));
  const missing = defaultIds.filter((id) => !known.includes(id));
  return [...known, ...missing];
}

function mergeLayout(saved, defaultIds) {
  // Suporte ao formato legado (array simples de ids)
  if (Array.isArray(saved)) {
    return { order: applyOrder(defaultIds, saved), hidden: [], sizes: {} };
  }
  if (!saved || typeof saved !== 'object') {
    return { order: defaultIds, hidden: [], sizes: {} };
  }
  return {
    order: applyOrder(defaultIds, saved.order || []),
    hidden: (saved.hidden || []).filter((id) => defaultIds.includes(id)),
    sizes: saved.sizes || {},
  };
}

export function useDashboardLayout(defaultIds) {
  const [layout, setLayout] = useState(() => ({ ...DEFAULT_LAYOUT, order: defaultIds }));
  const [saving, setSaving] = useState(false);

  // Carrega layout salvo do perfil do usuário
  useEffect(() => {
    let active = true;
    base44.auth
      .me()
      .then((user) => {
        if (active) setLayout(mergeLayout(user?.dashboard_layout, defaultIds));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);  

  const saveLayout = useCallback(async (newLayout) => {
    setSaving(true);
    try {
      await base44.auth.updateMe({ dashboard_layout: newLayout });
    } catch {
      toast.error('Não foi possível salvar o layout');
    } finally {
      setSaving(false);
    }
  }, []);

  // Reordena apenas os painéis visíveis (recebido do DnD)
  const reorder = useCallback(
    (newVisibleOrder) => {
      setLayout((prev) => {
        const hiddenIds = (prev.hidden || []).filter((id) => !newVisibleOrder.includes(id));
        const newOrder = [...newVisibleOrder, ...hiddenIds];
        const newLayout = { ...prev, order: newOrder };
        saveLayout(newLayout);
        toast.success('Layout salvo');
        return newLayout;
      });
    },
    [saveLayout]
  );

  // Alterna visibilidade de um painel
  const toggleHidden = useCallback(
    (id) => {
      setLayout((prev) => {
        const isHidden = (prev.hidden || []).includes(id);
        const newHidden = isHidden
          ? prev.hidden.filter((h) => h !== id)
          : [...(prev.hidden || []), id];
        const newLayout = { ...prev, hidden: newHidden };
        saveLayout(newLayout);
        return newLayout;
      });
    },
    [saveLayout]
  );

  // Alterna tamanho de um painel: 'full' ↔ 'half'
  const toggleSize = useCallback(
    (id) => {
      setLayout((prev) => {
        const current = (prev.sizes || {})[id] || 'full';
        const next = current === 'full' ? 'half' : 'full';
        const newSizes = { ...(prev.sizes || {}), [id]: next };
        const newLayout = { ...prev, sizes: newSizes };
        saveLayout(newLayout);
        return newLayout;
      });
    },
    [saveLayout]
  );

  // Painéis visíveis em ordem (ocultos excluídos)
  const order = (layout.order.length ? layout.order : defaultIds).filter(
    (id) => !(layout.hidden || []).includes(id)
  );

  return {
    order,
    hidden: layout.hidden || [],
    sizes: layout.sizes || {},
    reorder,
    toggleHidden,
    toggleSize,
    saving,
  };
}