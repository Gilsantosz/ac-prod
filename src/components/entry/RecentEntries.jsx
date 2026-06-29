import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { 
  Trash2, AlertTriangle, ChevronDown, Clock, Filter, 
  ShieldAlert, FileSpreadsheet, FileText,
} from 'lucide-react';
import { efficiency, isCritical, scrapRate } from '@/lib/productionMetrics';
import { useAuth } from '@/lib/AuthContext';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { exportRecentEntriesCSV, exportRecentEntriesPDF } from '@/lib/exportRecentEntries';

const PAGE_SIZE = 8;

export default function RecentEntries({ entries = [], onDelete = null, onCorrect = null, onAddOccurrence = null }) {
  const { user } = useAuth();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'today', 'my_cell', 'my_shift', 'my_lot', 'critical', 'scrap', 'downtime', 'audited'

  const userRole = user?.role || 'operator';
  const isAdmin = userRole === 'admin';

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles-roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, role');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const profileRolesMap = useMemo(() => {
    const map = {};
    for (const p of profiles) {
      map[p.id] = p.role;
    }
    return map;
  }, [profiles]);

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const filterLabels = {
    all: 'Todos',
    today: 'Hoje',
    my_cell: 'Minha Célula',
    my_lot: 'Com Lote',
    critical: 'Críticos',
    scrap: 'Com Refugo',
    downtime: 'Com Parada',
    audited: 'Auditados / Estornos',
  };

  const handleExportCSV = () => {
    exportRecentEntriesCSV(filteredEntries, filterLabels[activeFilter] || 'Todos');
  };

  const handleExportPDF = () => {
    exportRecentEntriesPDF(filteredEntries, filterLabels[activeFilter] || 'Todos');
  };

  // Aplicar filtros nos apontamentos
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      // Filtrar por status lógico (esconde corrigidos de visualização padrão dependendo do filtro)
      if (activeFilter !== 'audited' && e.approval_status && e.approval_status !== 'valid') {
        // esconde registros anulados ou corrigidos se não estiver no filtro de auditoria
        if (activeFilter !== 'all') return false; 
      }

      switch (activeFilter) {
        case 'today':
          return e.date === todayStr;
        case 'my_cell':
          return e.cell === user?.cell;
        case 'my_shift':
          return e.shift === user?.shift || e.shift === '1º Turno'; // fallback
        case 'my_lot':
          return e.lot_code && e.lot_code !== 'SEM_LOTE';
        case 'critical':
          return isCritical(e);
        case 'scrap':
          return Number(e.scrap) > 0;
        case 'downtime':
          return Number(e.downtime) > 0;
        case 'audited':
          return e.approval_status && e.approval_status !== 'valid';
        default:
          return true;
      }
    });
  }, [entries, activeFilter, todayStr, user]);

  const visible = filteredEntries.slice(0, visibleCount);
  const hasMore = visibleCount < filteredEntries.length;
  const remaining = filteredEntries.length - visibleCount;

  const showMore = () =>
    setVisibleCount((c) => Math.min(c + PAGE_SIZE, filteredEntries.length));

  // Renderizador de Status de Auditoria
  const renderAuditBadge = (status) => {
    switch (status) {
      case 'cancelled':
        return <Badge variant="destructive" className="bg-red-500/10 text-red-600 border border-red-500/20 hover:bg-red-500/10 text-[10px]">Cancelado</Badge>;
      case 'reversed':
        return <Badge className="bg-amber-500/10 text-amber-600 border border-amber-500/20 hover:bg-amber-500/10 text-[10px]">Estornado</Badge>;
      case 'corrected':
        return <Badge className="bg-sky-500/10 text-sky-600 border border-sky-500/20 hover:bg-sky-500/10 text-[10px]">Corrigido</Badge>;
      case 'pending_review':
        return <Badge className="bg-purple-500/10 text-purple-600 border border-purple-500/20 hover:bg-purple-500/10 text-[10px] animate-pulse">Sob Revisão</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card className="border-border/60 overflow-hidden bg-card">
      
      {/* ── Header ── */}
      <div className="px-5 py-4 border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-secondary/10">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-bold text-sm text-foreground">Central de Apontamentos Recentes</h3>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            Mostrando {Math.min(visibleCount, filteredEntries.length)} de {filteredEntries.length} registros
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={filteredEntries.length === 0}
            className="h-8 gap-1.5 text-xs bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-lg shadow-sm"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Exportar CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPDF}
            disabled={filteredEntries.length === 0}
            className="h-8 gap-1.5 text-xs bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-lg shadow-sm"
          >
            <FileText className="w-3.5 h-3.5" />
            Exportar PDF
          </Button>
        </div>
      </div>

      {/* ── Filtros Rápidos ── */}
      <div className="px-5 py-3 border-b border-border/50 bg-secondary/5 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mr-2 flex items-center gap-1">
          <Filter className="w-3.5 h-3.5" /> Filtrar:
        </span>
        {[
          { id: 'all', label: 'Todos' },
          { id: 'today', label: 'Hoje' },
          { id: 'my_cell', label: 'Minha Célula' },
          { id: 'my_lot', label: 'Com Lote' },
          { id: 'critical', label: 'Críticos' },
          { id: 'scrap', label: 'Com Refugo' },
          { id: 'downtime', label: 'Com Parada' },
          { id: 'audited', label: 'Auditados / Estornos' },
        ].map(filter => (
          <Button
            key={filter.id}
            variant="ghost"
            size="sm"
            onClick={() => { setActiveFilter(filter.id); setVisibleCount(PAGE_SIZE); }}
            className={`h-7 px-2.5 rounded-lg text-xs font-semibold ${
              activeFilter === filter.id 
                ? 'bg-[#2d9c4a]/15 text-[#2d9c4a] hover:bg-[#2d9c4a]/20' 
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {/* ── Tabela de registros ── */}
      <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: '420px' }}>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card border-b border-border/60">
            <TableRow>
              <TableHead className="text-xs">Data/Hora</TableHead>
              <TableHead className="text-xs">Contexto</TableHead>
              <TableHead className="text-xs">OP / Lote</TableHead>
              <TableHead className="text-xs">Produto / Etapa</TableHead>
              <TableHead className="text-right text-xs">Prod.</TableHead>
              <TableHead className="text-right text-xs">Meta</TableHead>
              <TableHead className="text-right text-xs">Efic.</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-center text-xs">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEntries.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                  Nenhum registro correspondente ao filtro ativo.
                </TableCell>
              </TableRow>
            )}

            {visible.map((e) => {
              const creatorRole = e.created_by ? profileRolesMap[e.created_by] : null;
              const isCreatedByAdminOrManager = creatorRole === 'admin' || creatorRole === 'manager';
              const cannotAlter = userRole === 'operator' && isCreatedByAdminOrManager;

              const eff = efficiency(e.produced, e.target);
              const crit = isCritical(e);
              const sRate = scrapRate(e.scrap, e.produced);
              const belowTarget = Number(e.target) > 0 && eff < 100;
              const highScrap = sRate >= 5;
              const limitedTraceability = e.traceability_status === 'limited'
                || ((!e.order_number || e.order_number === 'MANUAL') && (!e.lot_code || e.lot_code === 'SEM_LOTE'));

              return (
                <TableRow key={e.id} className={`hover:bg-secondary/15 transition-colors ${
                  e.approval_status && e.approval_status !== 'valid' ? 'opacity-60 bg-secondary/5 line-through' : ''
                }`}>
                  {/* Data / Hora */}
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {e.date} <span className="text-muted-foreground">@{e.hour}</span>
                  </TableCell>

                  {/* Contexto: Célula e Turno */}
                  <TableCell className="text-xs">
                    <span className="font-semibold text-foreground">{e.cell}</span>
                    <span className="text-muted-foreground block text-[10px]">{e.shift}</span>
                  </TableCell>

                  {/* OP / Lote */}
                  <TableCell className="text-xs font-mono">
                    {limitedTraceability ? (
                      <span className="text-amber-700 dark:text-amber-400 text-[10px] font-sans font-semibold">Rastreabilidade limitada</span>
                    ) : (
                      <><span className="text-foreground block">{e.order_number}</span><span className="text-muted-foreground text-[10px] block">{e.lot_code}</span></>
                    )}
                  </TableCell>

                  {/* Produto / Etapa */}
                  <TableCell className="text-xs truncate max-w-[140px]">
                    <span className="text-foreground font-medium block truncate" title={e.product_name}>{e.product_name || '—'}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-border font-normal mt-0.5">
                      {e.process_step || e.cell || '—'}
                    </Badge>
                  </TableCell>

                  {/* Produzido */}
                  <TableCell className="text-right tabular-nums text-xs font-bold text-foreground">
                    {e.produced}
                    {e.scrap > 0 && <span className="text-[10px] text-red-500 font-normal block">-{e.scrap} ref.</span>}
                  </TableCell>

                  {/* Meta */}
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {e.target || '—'}
                  </TableCell>

                  {/* Eficiência */}
                  <TableCell className="text-right tabular-nums text-xs">
                    <Badge className={`text-xs ${
                      eff >= 95 ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10' :
                      eff >= 70 ? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/10' :
                      'bg-red-500/10 text-red-600 hover:bg-red-500/10'
                    }`}>
                      {eff}%
                    </Badge>
                  </TableCell>

                  {/* Status / Alertas */}
                  <TableCell className="text-xs">
                    <div className="flex flex-wrap gap-1">
                      {renderAuditBadge(e.approval_status)}
                      {limitedTraceability && <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-700 dark:text-amber-400">Limitada</Badge>}
                      {crit && <Badge variant="destructive" className="text-[9px] gap-0.5 px-1 py-0 h-4"><AlertTriangle className="w-2.5 h-2.5" /> Crítico</Badge>}
                      {belowTarget && !e.approval_status && (
                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/10 dark:text-amber-400 text-[9px] font-normal border-0">
                          Meta não atingida
                        </Badge>
                      )}
                      {highScrap && !e.approval_status && (
                        <Badge className="bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-900/10 dark:text-red-400 text-[9px] font-normal border-0">
                          Refugo alto
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  {/* Ações */}
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      {/* Ocorrência */}
                      {(Number(e.scrap) > 0 || Number(e.downtime) > 0 || eff < 70) && !e.occurrence_id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onAddOccurrence?.(e)}
                          title="Registrar Ocorrência"
                          className="h-7 w-7 text-amber-500 hover:bg-amber-500/10"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                        </Button>
                      )}

                      {/* Corrigir / Auditoria */}
                      {onCorrect && (e.approval_status === 'valid' || !e.approval_status) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (cannotAlter) {
                              toast.warning('Acesso Restrito: Seu perfil operacional não permite alterar lançamentos efetuados por gestores ou administradores.');
                            } else {
                              onCorrect(e);
                            }
                          }}
                          title={cannotAlter ? 'Acesso Restrito' : 'Auditoria / Estorno'}
                          className={`h-7 w-7 ${cannotAlter ? 'text-slate-400 opacity-40 cursor-not-allowed hover:bg-transparent' : 'text-sky-500 hover:bg-sky-500/10'}`}
                        >
                          <ShieldAlert className="w-3.5 h-3.5" />
                        </Button>
                      )}

                      {/* Deletar (apenas admin) */}
                      {isAdmin && onDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(e.id)}
                          title="Deletar permanentemente"
                          className="h-7 w-7 text-red-500 hover:bg-destructive/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ── Botão "Ver mais" ── */}
      {hasMore && (
        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3 bg-secondary/10">
          <span className="text-xs text-muted-foreground">
            +{remaining} registro{remaining !== 1 ? 's' : ''} oculto{remaining !== 1 ? 's' : ''}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={showMore}
            className="gap-1.5 text-xs h-7 px-3 text-[#2d9c4a] hover:bg-[#2d9c4a]/10"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            Ver mais {Math.min(PAGE_SIZE, remaining)}
          </Button>
        </div>
      )}
    </Card>
  );
}
