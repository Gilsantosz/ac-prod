import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Mail, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/lib/localDb';

export default function CloseShiftButton({ date, shift = [], cell = [], disabled = false }) {
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('sendDailyClosure', { date, shift, cell });
      
      if (res.error) {
        console.error('Invoke error:', res.error);
        let detailedError = '';
        try {
          const body = await res.error.context?.json();
          detailedError = body?.error;
        } catch {}
        
        toast.error(detailedError || res.error.message || 'Falha ao enviar o fechamento.');
        return;
      }

      const accepted = res?.data?.accepted ?? res?.data?.sent ?? 0;
      if (accepted > 0) {
        const recipients = Array.isArray(res.data.recipients) ? res.data.recipients.join(', ') : '';
        if (res.data.warning) {
          toast.success(`Fechamento aceito pelo provedor para ${recipients}.`);
          toast.warning(res.data.warning, { duration: 8000 });
        } else {
          toast.success(`Fechamento completo aceito pelo provedor para ${accepted} e-mail(s): ${recipients}.`, { duration: 8000 });
        }
      } else {
        toast.warning('Nenhum gestor cadastrado para receber o relatório.');
      }
    } catch (err) {
      toast.error(err.message || 'Falha ao enviar o fechamento.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleSend}
      disabled={disabled || loading}
      className="gap-2 bg-card border border-border/80 text-foreground hover:bg-secondary/50 font-bold rounded-xl h-10 px-5 shadow-sm text-xs"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
      Enviar Fechamento
    </Button>
  );
}
