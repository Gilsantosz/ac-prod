import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CollectionReadItem from '../CollectionReadItem';

describe('HistoryModal & Button Integrity — Proteção contra submissão indevida e colisão de foco', () => {
  it('garante que todos os botões de ação em CollectionReadItem possuem type="button"', () => {
    const mockRead = {
      id: 'read-01',
      piece_id: 'piece-01',
      event_status: 'approved',
      raw_value: 'PCP-TEST-001',
      created_at: new Date().toISOString(),
      cell_name: 'Corte',
      machine_name: 'Seccionadora 01',
    };

    render(
      <CollectionReadItem
        read={mockRead}
        isSelected={false}
        onSelect={vi.fn()}
        onReject={vi.fn()}
        onCreateOccurrence={vi.fn()}
        onOpenTraceability={vi.fn()}
        canReject={true}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });
  });
});
