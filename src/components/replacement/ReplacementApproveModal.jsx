import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { approveReplacementWithCells } from '@/lib/replacementApprovalService';
import { formatStageName } from '@/lib/replacementService';

/**
 * Mantém a assinatura histórica do componente para não quebrar a página de gestão,
 * mas executa a aprovação de forma direta, sem modal, justificativa ou baixa automática.
 */
export default function ReplacementApproveModal({
  open = false,
  onOpenChange = null,
  orderId = null,
  onApproved = null,
}) {
  const startedOrderRef = useRef(null);

  useEffect(() => {
    if (!open || !orderId) {
      startedOrderRef.current = null;
      return undefined;
    }
    if (startedOrderRef.current === orderId) return undefined;
    startedOrderRef.current = orderId;
    let active = true;
    const toastId = toast.loading('Aprovando reposição e enviando para a fila produtiva...');

    approveReplacementWithCells(orderId, {
      priority: null,
      notes: '',
      selectedCells: [],
    })
      .then((result) => {
        if (!active) return;
        const nextStage = result?.next_step ? formatStageName(result.next_step) : null;
        toast.success(
          nextStage
            ? `Reposição aprovada. A peça substituta já está disponível no posto de ${nextStage}.`
            : 'Reposição aprovada e enviada ao posto produtivo correspondente.',
          { id: toastId },
        );
        onApproved?.(result);
        onOpenChange?.(false);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Erro ao aprovar reposição:', error);
        toast.error(error.message || 'Falha ao aprovar a reposição.', { id: toastId });
        onOpenChange?.(false);
      });

    return () => {
      active = false;
    };
  }, [open, orderId, onApproved, onOpenChange]);

  return null;
}
