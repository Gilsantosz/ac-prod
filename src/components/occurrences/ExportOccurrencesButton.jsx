import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { exportOccurrencesPdf } from '@/lib/exportOccurrences';

export default function ExportOccurrencesButton({ occurrences, date, cell, shift, chartEl }) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    toast.loading('Gerando relatório de paradas com gráficos...', { id: 'pdf_occ' });
    
    try {
      const count = occurrences.filter((o) => {
        if (o.date !== date) return false;
        if (cell !== 'all' && o.cell !== cell) return false;
        if (shift !== 'all' && o.shift !== shift) return false;
        return true;
      }).length;
      
      const filename = `relatorio_paradas_${date}${cell !== 'all' ? `_${cell.replace(' ', '')}` : ''}${shift !== 'all' ? `_${shift.replace(' ', '')}` : ''}.pdf`;
      
      await exportOccurrencesPdf(occurrences, date, cell, shift, chartEl, filename);
      toast.success(count ? `Relatório de ${count} parada(s) gerado com sucesso!` : 'Relatório gerado com sucesso!', { id: 'pdf_occ' });
    } catch (err) {
      console.error(err);
      toast.error('Falha ao gerar relatório PDF.', { id: 'pdf_occ' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleExport} disabled={loading} className="gap-2 shrink-0">
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
      Exportar PDF
    </Button>
  );
}