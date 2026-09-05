import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { mergeDashboardLayout, useDashboardLayout } from './useDashboardLayout';
import { base44 } from '@/lib/localDb';
vi.mock('@/lib/localDb', () => ({ base44: { auth: { me: vi.fn().mockResolvedValue({}), updateMe: vi.fn() } } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
beforeEach(() => { base44.auth.me.mockResolvedValue({}); });
const ids=['insights','hourly','cellChart','shiftChart'];
describe('organização persistida dos gráficos', () => {
  it('migra o bloco antigo sem perder ordem, tamanho ou gráficos ocultos', () => {
    const layout=mergeDashboardLayout({order:['charts','dailyProduction'], hidden:['charts'],sizes:{charts:'full'}},ids);
    expect(layout.order).toEqual(['hourly','cellChart','shiftChart','insights']);
    expect(layout.hidden).toEqual(['hourly','cellChart','shiftChart']);
    expect(layout.sizes.hourly).toBe('full');
  });
  it('serializa edições rápidas para a última organização prevalecer', async () => {
    let resolve;
    base44.auth.updateMe.mockImplementationOnce(() => new Promise(r=>{resolve=r;})).mockResolvedValue({});
    const {result}=renderHook(()=>useDashboardLayout(ids));
    await waitFor(()=>expect(result.current.ready).toBe(true));
    act(()=>result.current.toggleSize('hourly'));
    act(()=>result.current.toggleHidden('cellChart'));
    expect(base44.auth.updateMe).toHaveBeenCalledTimes(1);
    await act(async()=>resolve({}));
    await waitFor(()=>expect(result.current.saving).toBe(false));
    const last=base44.auth.updateMe.mock.lastCall[0].dashboard_layout;
    expect(last.sizes.hourly).toBe('full');
    expect(last.hidden).toContain('cellChart');
  });
  it('restaura o estado salvo quando a persistência falha', async () => {
    base44.auth.updateMe.mockRejectedValueOnce(new Error('offline'));
    const {result}=renderHook(()=>useDashboardLayout(ids));
    await waitFor(()=>expect(result.current.ready).toBe(true));
    act(()=>result.current.toggleHidden('hourly'));
    await waitFor(()=>expect(result.current.hidden).toEqual([]));
  });
  it('não sobrescreve um layout que não pôde ser carregado', async () => {
    base44.auth.me.mockRejectedValueOnce(new Error('offline'));
    const {result}=renderHook(()=>useDashboardLayout(ids));
    await act(async()=>{});
    act(()=>result.current.toggleHidden('hourly'));
    expect(result.current.ready).toBe(false);
    expect(base44.auth.updateMe).not.toHaveBeenCalled();
  });
});
