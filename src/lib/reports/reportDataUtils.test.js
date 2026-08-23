import { describe, expect, it } from 'vitest';
import {
  buildRawCsv,
  buildReportFilename,
  formatDatePtBr,
  sanitizeSpreadsheetText,
} from './reportDataUtils';

describe('utilitários de dados de relatórios', () => {
  it('gera CSV bruto com escaping, BOM e sem cabeçalho institucional', () => {
    const csv = buildRawCsv({
      columns: [{ key: 'name', label: 'Nome' }, { key: 'notes', label: 'Observações' }],
      rows: [{ name: 'Célula A', notes: 'texto; com "aspas"\ne quebra' }],
    });
    expect(csv).toBe('\uFEFFNome;Observações\r\nCélula A;"texto; com ""aspas""\ne quebra"');
    expect(csv).not.toContain('Logomarca');
    expect(csv).not.toContain('Sistema;');
  });

  it.each(['=2+2', '+SUM(A1:A2)', '-cmd', '@IMPORT'])('neutraliza CSV injection em %s', (value) => {
    const csv = buildRawCsv({ columns: [{ key: 'value', label: 'Valor' }], rows: [{ value }] });
    expect(csv).toContain(`'${value}`);
  });

  it('preserva números negativos reais e neutraliza texto com sinal de fórmula', () => {
    expect(sanitizeSpreadsheetText(-12)).toBe(-12);
    expect(sanitizeSpreadsheetText('-12')).toBe("'-12");
    const csv = buildRawCsv({ columns: [{ key: 'value', label: 'Valor' }], rows: [{ value: -12 }] });
    expect(csv).toContain('\r\n-12');
  });

  it('formata datas locais sem deslocamento UTC e padroniza nomes de arquivos', () => {
    expect(formatDatePtBr('2026-08-01')).toBe('01/08/2026');
    expect(buildReportFilename({ id: 'produção', period: { from: '2026-08-01', to: '2026-08-31' } }, 'xlsx'))
      .toBe('leo-flow-relatorio-producao-2026-08-01-2026-08-31.xlsx');
    expect(buildReportFilename({ id: 'produção', period: { from: '2026-08-01', to: '2026-08-31' } }, 'csv'))
      .toBe('leo-flow-dados-producao-2026-08-01-2026-08-31.csv');
  });
});

