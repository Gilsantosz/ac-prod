import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveRecipientsFromPrompt } from './aiRecipientResolver';
import { supabase } from '@/lib/supabaseClient';

vi.mock('@/lib/supabaseClient', () => {
  return {
    supabase: {
      from: vi.fn(),
    },
  };
});

describe('aiRecipientResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects direct email addresses that are not registered profiles', async () => {
    const mockInsert = vi.fn();

    vi.mocked(supabase.from).mockImplementation((table) => {
      if (table === 'report_recipients') {
        return {
          select: () => ({
            ilike: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
          insert: mockInsert,
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            ilike: () => ({
              eq: () => ({
                in: () => ({
                  limit: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const res = await resolveRecipientsFromPrompt('Envie o OEE para joao@empresa.com', { email: 'admin@empresa.com' });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(res.resolved).toEqual([]);
    expect(res.notFound).toContain('joao@empresa.com');
  });

  it('resolves current signed-in user when prompt asks for sender/self', async () => {
    const res = await resolveRecipientsFromPrompt('Me envie o relatório OEE de hoje no meu e-mail', {
      id: 'profile-1',
      name: 'Gildemar',
      email: 'gildemar@empresa.com',
      role: 'manager',
      managed_cells: ['Corte'],
    });

    expect(res.resolved).toHaveLength(1);
    expect(res.resolved[0]).toMatchObject({
      id: 'profile:profile-1',
      profile_id: 'profile-1',
      source: 'profile',
      email: 'gildemar@empresa.com',
    });
  });

  it('resolves manager role for "todos os gestores"', async () => {
    vi.mocked(supabase.from).mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({
                data: [
                  { id: '1', name: 'Carlos', email: 'carlos@empresa.com', role: 'manager' },
                  { id: '2', name: 'Maria', email: 'maria@empresa.com', role: 'admin' },
                ],
              }),
            }),
          }),
        };
      }
      return {};
    });

    const res = await resolveRecipientsFromPrompt('Envie para todos os gestores', { email: 'admin@empresa.com' });
    expect(res.resolved).toHaveLength(2);
    expect(res.resolved[0].id).toBe('profile:1');
    expect(res.resolved[0].email).toBe('carlos@empresa.com');
  });
});
