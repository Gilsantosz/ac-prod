import { describe, it, expect } from 'vitest';
import { encodeCode128, getCode128Modules, generateCode128Svg, generateCode128DataUri } from '@/lib/barcodeGenerator';

describe('barcodeGenerator — Code 128 (Subset B / Subset C)', () => {
  it('encoda código de barras alfanumérico corretamente com Start B e checksum', () => {
    const text = '09950020-REP-R01';
    const codes = encodeCode128(text);
    
    expect(codes).toBeInstanceOf(Array);
    expect(codes.length).toBeGreaterThan(5);
    expect(codes[0]).toBe(104); // START B
    expect(codes[codes.length - 1]).toBe(106); // STOP
  });

  it('gera módulos binários sem erros para qualquer string', () => {
    const modules = getCode128Modules('26072640');
    expect(typeof modules).toBe('string');
    expect(modules.length).toBeGreaterThan(20);
  });

  it('gera SVG vetorial limpo com dimensões válidas', () => {
    const svg = generateCode128Svg('09950020-REP-R01', {
      height: 40,
      showText: true
    });
    
    expect(svg).toContain('<svg');
    expect(svg).toContain('09950020-REP-R01');
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('</svg>');
  });

  it('gera Data URI para uso em imagens ou canvas', () => {
    const dataUri = generateCode128DataUri('940002');
    expect(dataUri).toMatch(/^data:image\/svg\+xml;/);
    expect(dataUri).toContain('940002');
  });
});
