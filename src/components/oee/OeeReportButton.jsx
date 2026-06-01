import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { exportOeeReport } from '@/lib/exportOeeReport';

export default function OeeReportButton({ overall, byCell, occurrences, meta, chartsRef, disabled }) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    if (!overall || byCell.length === 0) {
      toast.error('Sem dados para exportar.');
      return;
    }
    setLoading(true);
    try {
      await exportOeeReport({ overall, byCell, occurrences, meta, chartsEl: chartsRef?.current });
      toast.success('Relatório de OEE gerado.');
    } catch {
      toast.error('Falha ao gerar o relatório.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleExport} disabled={disabled || loading} className="gap-2 bg-white/10 border border-white/20 text-white hover:bg-white/20">
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Exportar PDF
    </Button>
  );
}