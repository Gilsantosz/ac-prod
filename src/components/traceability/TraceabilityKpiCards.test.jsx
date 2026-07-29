import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TraceabilityKpiCards from './TraceabilityKpiCards';

describe('TraceabilityKpiCards', () => {
  it('exibe o volume manual como produção do turno sem alterar a contagem aprovada acumulada', () => {
    render(
      <TraceabilityKpiCards
        kpis={{
          total: 0,
          produced_this_shift: 39,
          approved: 40,
          rejected: 0,
          blocked: 0,
        }}
      />,
    );

    expect(screen.getByText('Produzido no turno')).toBeInTheDocument();
    expect(screen.getByText('39')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.queryByText('Leituras hoje')).not.toBeInTheDocument();
  });
});
