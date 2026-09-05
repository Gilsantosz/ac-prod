import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UpdateKpiModal from './UpdateKpiModal';
import { toast } from 'sonner';
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
describe('atualização real de indicadores', () => {
  it('aguarda a consulta e impede duplo envio antes de anunciar sucesso', async () => {
    let finish;
    const onRefresh = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const onClose = vi.fn();
    render(<UpdateKpiModal open onClose={onClose} onRefresh={onRefresh} stats={{total:42}} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name:'Atualizar agora'}));
    expect(screen.getByRole('button', {name:'Atualizando…'})).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onRefresh).toHaveBeenCalledOnce();
  });
  it('mantém o modal aberto, mostra a falha e permite tentar novamente', async () => {
    const onClose = vi.fn(), onRefresh = vi.fn().mockRejectedValueOnce(new Error('Consulta indisponível')).mockResolvedValueOnce();
    render(<UpdateKpiModal open onClose={onClose} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', {name:'Atualizar agora'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Consulta indisponível');
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name:'Atualizar agora'}));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
