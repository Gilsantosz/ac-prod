import { describe, expect, it } from 'vitest';
import {
  canonicalProductionStage,
  normalizeProductionName,
} from './productionStagePolicyService';

describe('productionStagePolicyService', () => {
  it('normaliza acentos e nomes de células', () => {
    expect(normalizeProductionName('  Furação  ')).toBe('furacao');
    expect(normalizeProductionName('Usinagem CNC')).toBe('usinagemcnc');
  });

  it('resolve aliases produtivos para a etapa canônica', () => {
    expect(canonicalProductionStage('Fura')).toBe('drill');
    expect(canonicalProductionStage('Furadeira')).toBe('drill');
    expect(canonicalProductionStage('Bordo')).toBe('edge');
    expect(canonicalProductionStage('Embalagem')).toBe('packaging');
  });
});
