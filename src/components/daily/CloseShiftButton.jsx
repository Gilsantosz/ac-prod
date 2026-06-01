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
      const sent = res?.data?.sent ?? 0;
      if (sent > 0) {
        toast.success(`Fechamento enviado para ${sent} e-mail(s).`);
      } else {
        toast.warning('Nenhum gestor cadastrado para receber o relatório.');
      }
    } catch {
      toast.error('Falha ao enviar o fechamento.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleSend} disabled={disabled || loading} className="gap-2">
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
      Enviar Fechamento
    </Button>
  );
}