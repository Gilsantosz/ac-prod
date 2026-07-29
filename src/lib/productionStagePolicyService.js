import { supabase } from '@/lib/supabaseClient';

const STAGE_ALIASES = Object.freeze({
  cut: ['cut', 'corte', 'cutting'],
  edge: ['edge', 'borda', 'bordo', 'edging'],
  drill: ['drill', 'drilling', 'fura', 'furacao', 'furadeira'],
  cnc: ['cnc', 'usinagem', 'usinagemcnc'],
  joinery: ['joinery', 'marcenaria'],
  separation: ['separation', 'separacao'],
  packaging: ['packaging', 'embalagem'],
  shipping: ['shipping', 'expedicao'],
});

export function normalizeProductionName(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function canonicalProductionStage(value) {
  const normalized = normalizeProductionName(value);
  if (!normalized) return null;

  return Object.entries(STAGE_ALIASES)
    .find(([, aliases]) => aliases.includes(normalized))?.[0] || normalized;
}

export async function fetchProductionStagePolicies() {
  const { data, error } = await supabase
    .from('production_stage_policies')
    .select('*')
    .order('display_order', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function updateProductionStagePolicy(stageCode, patch, userId = null) {
  const payload = {
    ...patch,
    updated_at: new Date().toISOString(),
    ...(userId ? { updated_by: userId } : {}),
  };

  const { data, error } = await supabase
    .from('production_stage_policies')
    .update(payload)
    .eq('stage_code', canonicalProductionStage(stageCode))
    .select('*')
    .single();

  if (error) throw error;
  return data;
}
