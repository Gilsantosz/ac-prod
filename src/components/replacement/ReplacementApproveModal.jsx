import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { approveReplacement } from '@/lib/replacementApprovalService';
import { formatStageName } from '@/lib/replacementService';

/**
 * A aprovação é uma autorização de produção, não uma baixa produtiva.
 * Por isso a ação é direta: não solicita senha, justificativa ou células.
 */
export default function ReplacementApproveModal({
  open = false,
  onOpenChange = null,
  orderId = null,
  onApproved = null,
}) {
  const startedOrderRef = useRef(null);
  const callbacksRef = useRef({ onOpenChange, onApproved });

  useEffect(() => {
    callbacksRef.current = { onOpenChange, onApproved };
  }, [onOpenChange, onApproved]);

  useEffect(() => {
    if (!open || !orderId) {
      startedOrderRef.current = null;
      return undefined;
    }
    if (startedOrderRef.current === orderId) return undefined;

    startedOrderRef.current = orderId;
    let cancelled = false;
    const toastId = toast.loading('Aprovando reposição e enviando a peça substituta para a fila produtiva...');

    approveReplacement(orderId)
      .then((result) => {
        if (cancelled) return;
        const nextStage = result?.next_step_label || (result?.next_step ? formatStageName(result.next_step) : null);
        toast.success(
          nextStage
            ? `Reposição aprovada. A peça está disponível no posto de ${nextStage}.`
            : 'Reposição aprovada e enviada ao posto produtivo correspondente.',
          { id: toastId },
        );
        callbacksRef.current.onApproved?.(result);
        callbacksRef.current.onOpenChange?.(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Erro ao aprovar reposição:', error);
        toast.error(error.message || 'Falha ao aprovar a reposição.', { id: toastId });
        callbacksRef.current.onOpenChange?.(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  return null;
}
