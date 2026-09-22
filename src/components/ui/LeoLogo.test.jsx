import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LeoLogo from './LeoLogo';

afterEach(cleanup);

describe('LeoLogo', () => {
  it('mantém o nome da empresa visível se a imagem não puder ser decodificada', () => {
    render(<LeoLogo />);
    fireEvent.error(screen.getByAltText('Leo Madeiras'));
    expect(screen.getByRole('img', { name: 'Leo Madeiras' }).textContent).toBe('Leo');
    expect(document.querySelector('img')).toBeNull();
  });
});
