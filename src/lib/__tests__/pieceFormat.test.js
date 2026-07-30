import { describe, it, expect } from 'vitest';
import { formatPieceOrientingHeader } from '../pieceFormat';

describe('formatPieceOrientingHeader', () => {
  it('retorna string vazia se peça for nula ou indefinida', () => {
    expect(formatPieceOrientingHeader(null)).toBe('');
    expect(formatPieceOrientingHeader(undefined)).toBe('');
  });

  it('formata peça com dados completos e rota por array', () => {
    const piece = {
      piece_name: 'PEÇA TESTE 38',
      description: 'PTA INF ESQ 2D MARANELLO TOPO PRETO ABSOLUTO',
      width: 672,
      thickness: 18,
      length: 346.5,
      cut_width: 672,
      cut_length: 346.5,
      quantity: 1
    };
    const route = [
      { step_name: 'Corte' },
      { step_name: 'Borda' },
      { step_name: 'Usinagem' },
      { step_name: 'Marcenaria' }
    ];

    const result = formatPieceOrientingHeader(piece, route);
    expect(result).toBe(
      'PEÇA TESTE 38 - CORTE + BORDA + USINAGEM + MARCENARIA - PTA INF ESQ 2D MARANELLO TOPO PRETO ABSOLUTO - 672X18X346.5 - 672X346.5X1'
    );
  });

  it('formata peça com route_steps no próprio objeto da peça', () => {
    const piece = {
      piece_name: 'PORTA LATERAL',
      route_steps: ['cut', 'edge', 'cnc', 'joinery'],
      environment: 'COZINHA',
      color: 'BRANCO',
      width: 500,
      thickness: 15,
      height: 700
    };

    const result = formatPieceOrientingHeader(piece);
    expect(result).toBe(
      'PORTA LATERAL - CORTE + BORDA + USINAGEM + MARCENARIA - COZINHA BRANCO - 500X15X700 - 500X700X1'
    );
  });
});
