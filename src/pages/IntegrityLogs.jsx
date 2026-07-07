import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { FileText, RefreshCw, Search, Calendar, User, SlidersHorizontal, Loader2, Download } from 'lucide-react';

export default function IntegrityLogs() {
  const [lotSearch, setLotSearch] = useState('');
  const [pieceSearch, setPieceSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7); // Últimos 7 dias por padrão
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  // Query - Buscar Logs com Filtros
  const { data: logs = [], isLoading: loadingLogs, refetch } = useQuery({
    queryKey: ['integrityLogsSearch', lotSearch, pieceSearch, statusFilter, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('production_collection_events')
        .select('*')
        .order('processed_at', { ascending: false })
        .limit(200);

      if (lotSearch.trim()) {
        query = query.ilike('lot_code', `%${lotSearch.trim()}%`);
      }
      if (pieceSearch.trim()) {
        query = query.ilike('piece_code', `%${pieceSearch.trim()}%`);
      }
      if (statusFilter !== 'all') {
        if (statusFilter === 'blocked') {
          query = query.eq('result_status', 'blocked');
        } else if (statusFilter === 'approved') {
          query = query.eq('result_status', 'approved');
        } else if (statusFilter === 'duplicated') {
          query = query.eq('result_status', 'duplicated');
        }
      }
      if (dateFrom) {
        query = query.gte('date', dateFrom);
      }
      if (dateTo) {
        query = query.lte('date', dateTo);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }
  });

  const handleExportCSV = () => {
    if (logs.length === 0) {
      toast.warning('Nenhum dado disponível para exportação.');
      return;
    }

    try {
      const headers = ['Data/Hora', 'Lote', 'Peça', 'Célula', 'Operador', 'Turno', 'Resultado', 'Mensagem'];
      const csvRows = [
        headers.join(','),
        ...logs.map(log => [
          new Date(log.processed_at || log.created_at).toLocaleString('pt-BR'),
          log.lot_code || '',
          log.piece_code || '',
          log.cell_name || '',
          log.operator_name || '',
          log.shift || '',
          log.result_status || log.status || '',
          `"${(log.error_message || 'OK').replace(/"/g, '""')}"`
        ].join(','))
      ];

      const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csvRows.join('\n'));
      const link = document.createElement('a');
      link.setAttribute('href', csvContent);
      link.setAttribute('download', `auditoria_integridade_lote_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Logs exportados com sucesso!');
    } catch (_) {
      toast.error('Erro ao exportar logs para CSV.');
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <PageHeader 
        title="Logs de Integridade e Rastreabilidade" 
        subtitle="Auditoria e histórico completo de leituras, validações, bloqueios e liberações de peças." 
        icon={FileText} 
      />

      {/* Painel de Filtros Avançados */}
      <Card className="p-5 border-border/60 shadow-sm space-y-4 bg-card">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground pb-2 border-b border-border/40">
          <SlidersHorizontal className="w-4 h-4 text-primary" />
          Filtros de Auditoria
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
          <div className="space-y-1">
            <Label className="text-xs font-bold text-muted-foreground uppercase">Código do Lote</Label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
              <Input 
                value={lotSearch}
                onChange={(e) => setLotSearch(e.target.value)}
                placeholder="Ex: LOT-001" 
                className="pl-9 h-10 rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold text-muted-foreground uppercase">Código da Peça</Label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
              <Input 
                value={pieceSearch}
                onChange={(e) => setPieceSearch(e.target.value)}
                placeholder="Ex: PC-..." 
                className="pl-9 h-10 rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold text-muted-foreground uppercase">Validação</Label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-medium"
            >
              <option value="all">Todos os resultados</option>
              <option value="approved">Aprovados</option>
              <option value="blocked">Bloqueados / Erro</option>
              <option value="duplicated">Duplicados / Atenção</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold text-muted-foreground uppercase">Data Inicial</Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
              <Input 
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="pl-9 h-10 rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold text-muted-foreground uppercase">Data Final</Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
              <Input 
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="pl-9 h-10 rounded-xl"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-border/40">
          <Button onClick={handleExportCSV} variant="outline" size="sm" className="h-9 rounded-xl gap-1.5 font-medium border-border/60">
            <Download className="w-4 h-4" /> Exportar CSV
          </Button>
          <Button onClick={() => refetch()} variant="outline" size="sm" className="h-9 rounded-xl gap-1.5 font-medium border-border/60">
            <RefreshCw className="w-4 h-4" /> Recarregar Logs
          </Button>
        </div>
      </Card>

      {/* Tabela de Logs */}
      <Card className="p-6 border-border/60 shadow-sm space-y-4 bg-card">
        {loadingLogs ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : logs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-12 text-center">Nenhum evento registrado com esses filtros.</p>
        ) : (
          <div className="border border-border/40 rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Data/Hora</TableHead>
                  <TableHead className="text-xs">Lote</TableHead>
                  <TableHead className="text-xs">Peça</TableHead>
                  <TableHead className="text-xs">Célula</TableHead>
                  <TableHead className="text-xs">Operador</TableHead>
                  <TableHead className="text-xs">Turno</TableHead>
                  <TableHead className="text-xs">Ação</TableHead>
                  <TableHead className="text-xs">Validação</TableHead>
                  <TableHead className="text-xs">Log de Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const isError = log.result_status === 'blocked' || log.status === 'ignored';
                  const isWarning = log.result_status === 'duplicated';
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs font-semibold">{new Date(log.processed_at || log.created_at).toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-xs font-bold text-foreground">{log.lot_code || 'LOTE-N/A'}</TableCell>
                      <TableCell className="font-mono text-xs font-bold">{log.piece_code || log.raw_value}</TableCell>
                      <TableCell className="text-xs font-medium">{log.cell_name}</TableCell>
                      <TableCell className="text-xs">{log.operator_name || 'Operador'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{log.shift}</TableCell>
                      <TableCell className="text-xs capitalize">{log.reader_type}</TableCell>
                      <TableCell className="text-xs">
                        <Badge 
                          variant={isError ? "destructive" : isWarning ? "outline" : "secondary"} 
                          className={`text-[10px] py-0 ${isWarning ? 'border-amber-500/20 text-amber-600 bg-amber-500/5' : ''}`}
                        >
                          {log.result_status || log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-sm truncate" title={log.error_message || 'OK'}>
                        {log.error_message || 'Sucesso'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
