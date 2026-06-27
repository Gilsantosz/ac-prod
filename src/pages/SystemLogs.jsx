import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Shield, RefreshCw, Search, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildBrandedCsv, downloadBlob } from '@/lib/reportBranding';

const ACTION_LABELS = {
  login:              { label: 'Login',             color: 'text-blue-600',   bg: 'bg-blue-100 dark:bg-blue-900/30' },
  logout:             { label: 'Logout',            color: 'text-slate-600',  bg: 'bg-slate-100 dark:bg-slate-800' },
  login_failed:       { label: 'Login Falhou',      color: 'text-red-600',    bg: 'bg-red-100 dark:bg-red-900/30' },
  promob_xml_import:  { label: 'Import XML',        color: 'text-green-600',  bg: 'bg-green-100 dark:bg-green-900/30' },
  promob_api_sync:    { label: 'Sync API',          color: 'text-teal-600',   bg: 'bg-teal-100 dark:bg-teal-900/30' },
  production_create:  { label: 'Produção',          color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  lot_update:         { label: 'Lote',              color: 'text-indigo-600', bg: 'bg-indigo-100 dark:bg-indigo-900/30' },
  step_finish:        { label: 'Etapa Concluída',   color: 'text-emerald-600',bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
  package_close:      { label: 'Embalagem',         color: 'text-violet-600', bg: 'bg-violet-100 dark:bg-violet-900/30' },
  shipment_dispatch:  { label: 'Expedição',         color: 'text-purple-600', bg: 'bg-purple-100 dark:bg-purple-900/30' },
  report_export:      { label: 'Relatório',         color: 'text-amber-600',  bg: 'bg-amber-100 dark:bg-amber-900/30' },
  backup_download:    { label: 'Backup',            color: 'text-cyan-600',   bg: 'bg-cyan-100 dark:bg-cyan-900/30' },
  google_drive_archive_sync: { label: 'Arquivo Drive', color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
  user_update:        { label: 'Usuário',           color: 'text-pink-600',   bg: 'bg-pink-100 dark:bg-pink-900/30' },
  permission_change:  { label: 'Permissão',         color: 'text-red-600',    bg: 'bg-red-100 dark:bg-red-900/30' },
  api_config_change:  { label: 'Config. API',       color: 'text-amber-600',  bg: 'bg-amber-100 dark:bg-amber-900/30' },
};

export default function SystemLogs() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [successFilter, setSuccessFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data: logs = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['system-audit-logs', search, actionFilter, successFilter, dateFrom, page],
    queryFn: async () => {
      let query = supabase
        .from('system_audit_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (actionFilter) query = query.eq('action', actionFilter);
      if (successFilter !== '') query = query.eq('success', successFilter === 'true');
      if (dateFrom) query = query.gte('created_at', new Date(dateFrom).toISOString());
      if (search) {
        query = query.or(
          `user_email.ilike.%${search}%,user_name.ilike.%${search}%,entity_id.ilike.%${search}%,entity_label.ilike.%${search}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    initialData: [],
    keepPreviousData: true,
  });

  const exportLogs = async () => {
    const columns = [
      { key: 'date', label: 'Data/Hora' },
      { key: 'user', label: 'Usuario' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role' },
      { key: 'action', label: 'Acao' },
      { key: 'entity', label: 'Entidade' },
      { key: 'id', label: 'ID' },
      { key: 'success', label: 'Sucesso' },
      { key: 'page', label: 'Pagina' },
    ];
    const rows = logs.map(l => [
      new Date(l.created_at).toLocaleString('pt-BR'), l.user_name || '', l.user_email || '', l.user_role || '',
      l.action, l.entity || '', l.entity_id || '', l.success ? 'Sim' : 'Nao', l.page || '',
    ]).map((values) => Object.fromEntries(columns.map((column, index) => [column.key, values[index]])));
    const csv = buildBrandedCsv({
      title: 'Logs do Sistema',
      subtitle: 'Historico de auditoria e rastreabilidade',
      summary: [
        { label: 'Registros exportados', value: logs.length },
        { label: 'Filtro de acao', value: actionFilter || 'Todas' },
        { label: 'Filtro de sucesso', value: successFilter === '' ? 'Todos' : successFilter === 'true' ? 'Sim' : 'Nao' },
      ],
      columns,
      rows,
    });
    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      `logs-sistema-${new Date().toISOString().split('T')[0]}.csv`
    );
  };

  const actionInfo = (action) => ACTION_LABELS[action] || { label: action, color: 'text-muted-foreground', bg: 'bg-secondary/60' };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5 sm:space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Logs do Sistema"
          subtitle="Histórico de auditoria completo — todas as ações registradas para rastreabilidade e conformidade."
          icon={Shield}
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} /> Atualizar
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={exportLogs}>
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </Button>
        </div>
      </div>

      {/* ── Filtros ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Buscar por usuário, ID…"
            className="w-full pl-9 pr-3 h-9 rounded-lg border border-input bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setPage(0); }}
          className="h-9 px-3 rounded-lg border border-input bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Todas as ações</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          value={successFilter}
          onChange={e => { setSuccessFilter(e.target.value); setPage(0); }}
          className="h-9 px-3 rounded-lg border border-input bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Sucesso e falhas</option>
          <option value="true">✓ Sucesso</option>
          <option value="false">✗ Falhas</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setPage(0); }}
          className="h-9 px-3 rounded-lg border border-input bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* ── Tabela de Logs ─────────────────────────────────────── */}
      <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin" /> Carregando logs…
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Shield className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p>Nenhum log encontrado</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 border-b border-border/60">
                <tr>
                  {['Data/Hora', 'Usuário', 'Ação', 'Entidade', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {logs.map(log => {
                  const info = actionInfo(log.action);
                  const isExpanded = expandedId === log.id;
                  return (
                    <>
                      <tr
                        key={log.id}
                        className="hover:bg-secondary/20 transition-colors cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(log.created_at).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground text-xs">{log.user_name || '—'}</p>
                          <p className="text-[10px] text-muted-foreground">{log.user_email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'text-xs font-medium px-2 py-0.5 rounded-full',
                            info.bg, info.color
                          )}>
                            {info.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs text-foreground">{log.entity || '—'}</p>
                          {log.entity_label && (
                            <p className="text-[10px] text-muted-foreground">{log.entity_label}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {log.success
                            ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                            : <XCircle className="w-4 h-4 text-red-500" />
                          }
                        </td>
                        <td className="px-4 py-3">
                          {isExpanded
                            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                            : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          }
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${log.id}-details`} className="bg-secondary/10">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                              <div className="space-y-1.5">
                                {log.page && <DetailRow label="Página" value={log.page} />}
                                {log.ip_address && <DetailRow label="IP" value={log.ip_address} />}
                                {log.device_id && <DetailRow label="Dispositivo" value={log.device_id} />}
                                {log.error_message && <DetailRow label="Erro" value={log.error_message} error />}
                              </div>
                              <div className="space-y-1.5">
                                {log.old_value && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Valor anterior:</p>
                                    <pre className="text-[10px] bg-secondary/60 p-2 rounded-lg overflow-auto max-h-32">
                                      {JSON.stringify(log.old_value, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {log.new_value && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Novo valor:</p>
                                    <pre className="text-[10px] bg-secondary/60 p-2 rounded-lg overflow-auto max-h-32">
                                      {JSON.stringify(log.new_value, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Paginação */}
        <div className="px-4 py-3 border-t border-border/60 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Mostrando {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + logs.length}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0}>
              Anterior
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPage(p => p+1)} disabled={logs.length < PAGE_SIZE}>
              Próxima
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, error }) {
  return (
    <div className="flex gap-2">
      <span className="font-medium text-muted-foreground shrink-0">{label}:</span>
      <span className={error ? 'text-red-600' : 'text-foreground'}>{value}</span>
    </div>
  );
}
