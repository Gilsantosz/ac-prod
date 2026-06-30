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

  it('resolves direct email addresses and ensures it in database', async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
    const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockEq = vi.fn().mockReturnValue({ limit: mockLimit });

    vi.mocked(supabase.from).mockImplementation((table) => {
      if (table === 'report_recipients') {
        return {
          select: () => ({ eq: mockEq }),
          insert: mockInsert,
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [] }) }) }),
        };
      }
      return {};
    });

    const res = await resolveRecipientsFromPrompt('Envie o OEE para joao@empresa.com', { email: 'admin@empresa.com' });
    expect(mockInsert).toHaveBeenCalledWith({
      name: 'joao',
      email: 'joao@empresa.com',
      role_label: 'Destinatário externo/manual',
      recipient_group: 'other',
      active: true,
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
    expect(res.resolved[0].email).toBe('carlos@empresa.com');
  });
});
