import { useState, useEffect } from 'react';
import {
  History, Search, Printer, FileText
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getAllPrintAndExportHistory } from '@/lib/replacementLabelService';

export default function ReplacementHistoryModal({
  open,
  onOpenChange
}) {
  const [historyType, setHistoryType] = useState('all'); // 'all' | 'labels' | 'reports'
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState({ labelPrints: [], reportExports: [] });

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const res = await getAllPrintAndExportHistory({
        type: historyType,
        search: search.trim() || null
      });
      setData(res);
    } catch (err) {
      console.error('Erro ao carregar histórico de auditoria:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadHistory();
    }
  }, [open, historyType, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl rounded-3xl p-0 overflow-hidden border-border bg-card shadow-2xl">
        <DialogHeader className="p-4 md:p-6 border-b border-border/60 bg-muted/30">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg md:text-xl font-black text-foreground flex items-center gap-2">
              <History className="w-5 h-5 text-amber-500" />
              Histórico de Impressões & Exportações Auditáveis
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Registro transacional de vias de etiquetas térmicas impressas e relatórios PDF gerados no sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 md:p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Filtros e Busca */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex p-1 bg-secondary/50 rounded-xl border border-border/40 text-xs font-bold w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setHistoryType('all')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${historyType === 'all' ? 'bg-background shadow font-extrabold text-foreground' : 'text-muted-foreground'}`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setHistoryType('labels')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${historyType === 'labels' ? 'bg-background shadow font-extrabold text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
              >
                Etiquetas Impressas
              </button>
              <button
                type="button"
                onClick={() => setHistoryType('reports')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${historyType === 'reports' ? 'bg-background shadow font-extrabold text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}
              >
                Relatórios PDF Exportados
              </button>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por motivo, usuário, código..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs rounded-xl"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              Carregando histórico de auditoria...
            </div>
          ) : (
            <div className="space-y-4">
              {/* Tabela de Impressão de Etiquetas */}
              {(historyType === 'all' || historyType === 'labels') && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1.5">
                    <Printer className="w-4 h-4 text-amber-500" />
                    Impressões de Etiquetas ({data.labelPrints.length})
                  </h4>

                  {data.labelPrints.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 italic">Nenhum registro de impressão de etiqueta localizado.</p>
                  ) : (
                    <div className="border border-border/60 rounded-2xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-secondary/40 text-[11px] font-bold text-muted-foreground border-b border-border/40">
                          <tr>
                            <th className="p-3">Código Reposição</th>
                            <th className="p-3">Via / Sequência</th>
                            <th className="p-3">Motivo Reimpressão</th>
                            <th className="p-3">Impressora</th>
                            <th className="p-3">Usuário</th>
                            <th className="p-3">Data / Hora</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {data.labelPrints.map((item) => (
                            <tr key={item.id} className="hover:bg-muted/20">
                              <td className="p-3 font-bold text-foreground">{item.replacement_order?.replacement_code || 'REP-ORD'}</td>
                              <td className="p-3">
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${item.is_reprint ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'}`}>
                                  {item.copy_number === 1 ? '1ª VIA' : `${item.copy_number}ª VIA`}
                                </span>
                              </td>
                              <td className="p-3 text-muted-foreground">{item.reprint_reason || '1ª Impressão de Produção'}</td>
                              <td className="p-3 text-muted-foreground">{item.printer_name}</td>
                              <td className="p-3 font-semibold">{item.printed_by_name || 'Operador MES'}</td>
                              <td className="p-3 text-muted-foreground">
                                {item.printed_at ? format(new Date(item.printed_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Tabela de Exportação de Relatórios PDF */}
              {(historyType === 'all' || historyType === 'reports') && (
                <div className="space-y-2 pt-3">
                  <h4 className="text-xs font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-blue-500" />
                    Exportações de Relatórios PDF ({data.reportExports.length})
                  </h4>

                  {data.reportExports.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 italic">Nenhuma exportação de relatório PDF registrada.</p>
                  ) : (
                    <div className="border border-border/60 rounded-2xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-secondary/40 text-[11px] font-bold text-muted-foreground border-b border-border/40">
                          <tr>
                            <th className="p-3">Código do Relatório</th>
                            <th className="p-3">Tipo Escopo</th>
                            <th className="p-3">Usuário Emissor</th>
                            <th className="p-3">Data / Hora</th>
                            <th className="p-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {data.reportExports.map((rep) => (
                            <tr key={rep.id} className="hover:bg-muted/20">
                              <td className="p-3 font-bold text-blue-600 dark:text-blue-400">{rep.report_code}</td>
                              <td className="p-3 capitalize">{rep.report_type}</td>
                              <td className="p-3 font-semibold">{rep.generated_by_name || 'Operador MES'}</td>
                              <td className="p-3 text-muted-foreground">
                                {rep.generated_at ? format(new Date(rep.generated_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '—'}
                              </td>
                              <td className="p-3">
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                  Gerado / Auditado
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="p-4 md:p-6 border-t border-border/60 bg-muted/20">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-xl text-xs font-bold"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
