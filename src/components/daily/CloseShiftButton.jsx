import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Mail, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/lib/localDb';

export default function CloseShiftButton({ date, disabled }) {
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('sendDailyClosure', { date });
      
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

      const sent = res?.data?.sent ?? 0;
      if (sent > 0) {
        if (res.data.warning) {
          toast.success(`Fechamento enviado para o e-mail do proprietário (${res.data.recipients.join(', ')}).`);
          toast.warning(res.data.warning, { duration: 8000 });
        } else {
          toast.success(`Fechamento enviado para ${sent} e-mail(s).`);
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
    <Button variant="outline" onClick={handleSend} disabled={disabled || loading} className="gap-2 bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full shadow-sm">
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
      Enviar Fechamento
    </Button>
  );
}