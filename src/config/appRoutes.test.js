import { describe, expect, it } from 'vitest';
import {
  canUserEditRoute,
  canUserViewRoute,
  getRouteAccess,
} from './appRoutes';
import { normalizePagePermissions } from '@/components/users/PageAccessMatrix';

describe('controle granular de acesso às páginas', () => {
  it('permite visualizar sem editar quando somente a permissão de consulta está ativa', () => {
    const user = {
      role: 'viewer',
      permissions: {
        view_packaging: true,
        manage_packaging: false,
      },
    };

    expect(canUserViewRoute(user, '/embalagem')).toBe(true);
    expect(canUserEditRoute(user, '/embalagem')).toBe(false);
  });

  it('preserva compatibilidade com a permissão operacional antiga', () => {
    const user = {
      role: 'operator',
      permissions: {
        traceability_collect: true,
      },
    };

    expect(canUserViewRoute(user, '/coleta')).toBe(true);
    expect(canUserEditRoute(user, '/coleta')).toBe(true);
  });

  it('reconhece aliases e subpáginas usando a rota protegida principal', () => {
    expect(getRouteAccess('/coleta-codigo-rfid').path).toBe('/coleta');
    expect(getRouteAccess('/pcp/configuracoes').path).toBe('/pcp');
  });

  it('habilitar edição também habilita visualização da página', () => {
    const permissions = normalizePagePermissions({
      view_users: false,
      manage_users: true,
    }, 'manager');

    expect(permissions.manage_users).toBe(true);
    expect(permissions.view_users).toBe(true);
  });

  it('mantém páginas administrativas restritas a administradores', () => {
    const manager = {
      role: 'manager',
      permissions: {
        view_audit_logs: true,
      },
    };

    expect(canUserViewRoute(manager, '/logs-sistema')).toBe(false);
    expect(canUserViewRoute({ role: 'admin', permissions: {} }, '/logs-sistema')).toBe(true);
  });
});
