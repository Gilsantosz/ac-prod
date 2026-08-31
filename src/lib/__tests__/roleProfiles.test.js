import { describe, expect, it } from 'vitest';
import {
  canManageSystemRole,
  getRoleDefaultPermissions,
  getSystemRoleLabel,
  getSystemRoleRank,
  isReplacementAuthorityRole,
  normalizeSystemRole,
} from '@/lib/roleProfiles';

describe('roleProfiles', () => {
  it('normaliza os aliases históricos do papel', () => {
    expect(normalizeSystemRole('quality')).toBe('quality_manager');
    expect(normalizeSystemRole('leader')).toBe('supervisor');
    expect(normalizeSystemRole('user')).toBe('operator');
  });

  it('define Qualidade entre Supervisor/Líder e Gestor', () => {
    expect(getSystemRoleLabel('quality_manager')).toBe('Qualidade');
    expect(getSystemRoleRank('supervisor')).toBeLessThan(getSystemRoleRank('quality_manager'));
    expect(getSystemRoleRank('quality_manager')).toBeLessThan(getSystemRoleRank('manager'));
  });

  it.each(['quality_manager', 'supervisor', 'manager', 'admin'])('%s possui autoridade de decisão de reposição', (role) => {
    const permissions = getRoleDefaultPermissions(role);
    expect(isReplacementAuthorityRole(role)).toBe(true);
    expect(permissions.approve_replacements).toBe(true);
    expect(permissions.manage_replacements).toBe(true);
    expect(permissions.force_complete_replacements).toBe(true);
  });

  it('mantém operador sem autoridade administrativa de reposição', () => {
    const permissions = getRoleDefaultPermissions('operator');
    expect(isReplacementAuthorityRole('operator')).toBe(false);
    expect(permissions.approve_replacements).toBe(false);
    expect(permissions.force_complete_replacements).toBe(false);
  });

  it('permite Gestor criar Qualidade, mas não permite Supervisor criar papel superior', () => {
    expect(canManageSystemRole({ role: 'manager' }, 'quality_manager')).toBe(true);
    expect(canManageSystemRole({ role: 'supervisor' }, 'quality_manager')).toBe(false);
  });
});
