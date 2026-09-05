import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: db }));

const settings = (version = 1) => ({
  id: 'session', default_timeout_minutes: 30, warning_seconds: 60,
  role_timeouts: {}, cell_timeouts: {}, sectors: [], version,
});

describe('systemSettingsService', () => {
  let service;
  let readSettings;
  let readCells;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    readSettings = vi.fn().mockResolvedValue({ data: settings(), error: null });
    readCells = vi.fn().mockResolvedValue({ data: [{ id: 'cell-1', name: 'Corte', active: true }], error: null });
    db.from.mockImplementation((table) => table === 'system_settings'
      ? { select: () => ({ eq: () => ({ maybeSingle: () => ({ abortSignal: readSettings }) }) }) }
      : { select: () => ({ order: () => ({ range: (...args) => ({ abortSignal: () => readCells(...args) }) }) }) });
    db.rpc.mockReset();
    service = await import('@/lib/systemSettingsService');
  });

  afterEach(() => vi.useRealTimers());

  it('shares concurrent loads and caches policies without database calls per activity', async () => {
    const [first, second] = await Promise.all([service.loadSystemSettings(), service.loadSystemSettings()]);
    expect(first).toBe(second);
    expect(first.cell_catalog[0].name).toBe('Corte');
    await service.loadSystemSettings();
    expect(readSettings).toHaveBeenCalledTimes(1);
    expect(readCells).toHaveBeenCalledTimes(1);
  });

  it('does not invent a successful configuration when the migration is unavailable', async () => {
    readSettings.mockResolvedValue({ data: null, error: { code: '42P01', message: 'missing table' } });
    await expect(service.loadSystemSettings()).rejects.toMatchObject({ code: '42P01' });
    expect(service.getCachedSystemSettings()).toBeNull();
  });

  it('passes a version and only editable settings to the administrative RPC', async () => {
    const current = await service.loadSystemSettings();
    const listener = vi.fn();
    const unsubscribe = service.subscribeSystemSettings(listener);
    db.rpc.mockResolvedValue({ data: { ...settings(2), default_timeout_minutes: 10 } });
    await service.saveSystemSettings({ ...current, default_timeout_minutes: 10, role: 'admin' });
    const args = db.rpc.mock.calls[0][1];
    expect(args.p_expected_version).toBe(1);
    expect(args.p_settings.default_timeout_minutes).toBe(10);
    expect(args.p_settings).not.toHaveProperty('role');
    expect(args.p_settings).not.toHaveProperty('cell_catalog');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
    unsubscribe();
  });

  it('reports conflicts and leaves the confirmed cache unchanged', async () => {
    const current = await service.loadSystemSettings();
    db.rpc.mockResolvedValue({ error: { code: '40001' } });
    await expect(service.saveSystemSettings(current)).rejects.toThrow('Outro administrador');
    expect(service.getCachedSystemSettings().version).toBe(1);
  });

  it('does not let an older in-flight read overwrite a newer save', async () => {
    const current = await service.loadSystemSettings();
    let finishRead;
    readSettings.mockReturnValue(new Promise((resolve) => { finishRead = resolve; }));
    const staleRead = service.loadSystemSettings({ force: true });
    db.rpc.mockResolvedValue({ data: { ...settings(2), default_timeout_minutes: 5 } });
    await service.saveSystemSettings(current);
    finishRead({ data: settings(1) });
    expect((await staleRead).version).toBe(2);
    expect(service.getCachedSystemSettings().default_timeout_minutes).toBe(5);
  });

  it('notifies current tabs of a newer configuration without writing data remotely', async () => {
    await service.loadSystemSettings();
    const listener = vi.fn();
    const unsubscribe = service.subscribeSystemSettings(listener);
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'acprod_system_settings_v1', newValue: JSON.stringify(settings(3)),
    }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));
    expect(db.rpc).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('allows a later retry after an unresponsive network request', async () => {
    vi.useFakeTimers();
    readSettings.mockReturnValueOnce(new Promise(() => {}));
    const pending = service.loadSystemSettings();
    const failure = expect(pending).rejects.toThrow('conexão demorou');
    await vi.advanceTimersByTimeAsync(10_000);
    await failure;
    const signal = readSettings.mock.calls[0][0];
    expect(signal.aborted).toBe(true);
    expect((await service.loadSystemSettings()).version).toBe(1);
    expect(readSettings).toHaveBeenCalledTimes(2);
  });
});
