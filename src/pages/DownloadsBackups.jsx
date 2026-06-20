import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  HardDrive, Download, RefreshCw, FileText, FileJson, Archive,
  Shield, Clock, CheckCircle, XCircle, Calendar, Database,
  AlertCircle, Eye, Folder, FilePlus, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const FILE_TYPE_INFO = {
  xml:  { icon: FileText,  label: 'XML',  color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  json: { icon: FileJson,  label: 'JSON', color: 'text-blue-600',   bg: 'bg-blue-100 dark:bg-blue-900/30' },
  pdf:  { icon: FileText,  label: 'PDF',  color: 'text-red-600',    bg: 'bg-red-100 dark:bg-red-900/30' },
  xlsx: { icon: FileText,  label: 'XLSX', color: 'text-green-600',  bg: 'bg-green-100 dark:bg-green-900/30' },
  zip:  { icon: Archive,   label: 'ZIP',  color: 'text-purple-600', bg: 'bg-purple-100 dark:bg-purple-900/30' },
  log:  { icon: Shield,    label: 'LOG',  color: 'text-slate-600',  bg: 'bg-slate-100 dark:bg-slate-800' },
};

export default function DownloadsBackups() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [generating, setGenerating] = useState(false);

  const { data: backupFiles = [], isLoading, refetch } = useQuery({
    queryKey: ['backup-files', search, typeFilter],
    queryFn: async () => {
      let query = supabase
        .from('backup_files')
        .select(`
          *,
          production_orders (order_code, customer_name),
          production_lots (lot_code)
        `)
        .order('generated_at', { ascending: false })
        .limit(100);

      if (typeFilter) query = query.eq('file_type', typeFilter);
      if (search) {
        query = query.or(
          `file_name.ilike.%${search}%,production_orders.order_code.ilike.%${search}%,production_orders.customer_name.ilike.%${search}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    initialData: [],
  });

  const { data: policies = [] } = useQuery({
    queryKey: ['backup-policies'],
    queryFn: () => supabase.from('backup_policies').select('*').order('created_at').then(r => r.data || []),
    initialData: [],
  });

  // ─── Download de arquivo ──────────────────────────────────────
  const downloadFile = async (file) => {
    try {
      const { data, error } = await supabase.storage
        .from('productive-backups')
        .download(file.storage_path);

      if (error) throw error;

      await auditLog(AUDIT_ACTIONS.BACKUP_DOWNLOAD, 'backup_file', file.id, {
        fileName: file.file_name, path: file.storage_path,
      });

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.file_name;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`📥 Download iniciado: ${file.file_name}`);
    } catch (e) {
      toast.error(`Falha no download: ${e.message}`);
    }
  };

  // ─── Gerar backup manual de todas as OPs ─────────────────────
  const generateFullBackup = async () => {
    setGenerating(true);
    try {
      const resp = await supabase.functions.invoke('generate-productive-backup', {
        body: { type: 'full_snapshot', requestedBy: 'manual' },
      });
      if (resp.data?.success) {
        toast.success('✅ Backup completo gerado com sucesso!');
        refetch();
      } else {
        throw new Error(resp.data?.error || 'Falha ao gerar backup');
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGenerating(false);
    }
  };

  // Stats
  const totalSize = backupFiles.reduce((a, f) => a + (f.file_size || 0), 0);
  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/(1024*1024)).toFixed(1)} MB`;
  };

  const getExpiredInDays = (expiresAt) => {
    if (!expiresAt) return null;
    const diff = new Date(expiresAt) - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5 sm:space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Downloads & Backups"
          subtitle="Gerencie os backups produtivos com retenção de 4 anos. Todos os XMLs, JSONs e snapshots das ordens."
          icon={HardDrive}
        />
        <Button
          className="gap-2 bg-[#2d9c4a] hover:bg-[#25813d] text-white"
          onClick={generateFullBackup}
          disabled={generating}
        >
          {generating
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <Database className="w-4 h-4" />
          }
          Gerar Backup Agora
        </Button>
      </div>

      {/* ── Stats de Armazenamento ────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={HardDrive}   label="Total Arquivos" value={backupFiles.length} />
        <StatCard icon={Archive}     label="Espaço Usado"   value={formatSize(totalSize)} />
        <StatCard icon={CheckCircle} label="Disponíveis"    value={backupFiles.filter(f => f.status === 'available').length} accent="green" />
        <StatCard icon={Calendar}    label="Retenção"       value="4 anos" accent="blue" />
      </div>

      <Tabs defaultValue="files" className="space-y-5">
        <TabsList className="bg-card border border-border/60">
          <TabsTrigger value="files" className="gap-2">
            <HardDrive className="w-4 h-4" /> Arquivos
          </TabsTrigger>
          <TabsTrigger value="policies" className="gap-2">
            <Shield className="w-4 h-4" /> Políticas
          </TabsTrigger>
        </TabsList>

        {/* ── Aba: Arquivos ───────────────────────────────────── */}
        <TabsContent value="files" className="space-y-4">
          {/* Filtros */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por arquivo, pedido, cliente…"
                className="w-full pl-3 pr-3 h-9 rounded-lg border border-input bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="h-9 px-3 rounded-lg border border-input bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Todos os tipos</option>
              {Object.entries(FILE_TYPE_INFO).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          {/* Lista de arquivos */}
          <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center gap-3 py-12 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin" /> Carregando arquivos…
              </div>
            ) : backupFiles.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <HardDrive className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p>Nenhum arquivo de backup encontrado</p>
                <p className="text-xs mt-1">Os backups são gerados automaticamente ao importar ordens do Promob</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/30 border-b border-border/60">
                    <tr>
                      {['Arquivo', 'Pedido', 'Data', 'Tamanho', 'Expira', 'Status', ''].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {backupFiles.map(file => {
                      const typeInfo = FILE_TYPE_INFO[file.file_type] || FILE_TYPE_INFO.json;
                      const TypeIcon = typeInfo.icon;
                      const daysLeft = getExpiredInDays(file.expires_at);

                      return (
                        <tr key={file.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', typeInfo.bg)}>
                                <TypeIcon className={cn('w-3.5 h-3.5', typeInfo.color)} />
                              </div>
                              <div>
                                <p className="text-xs font-medium text-foreground">{file.file_name}</p>
                                {file.production_lots && (
                                  <p className="text-[10px] text-muted-foreground">{file.production_lots.lot_code}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {file.production_orders?.order_code || '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {file.generated_at ? new Date(file.generated_at).toLocaleString('pt-BR') : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {formatSize(file.file_size)}
                          </td>
                          <td className="px-4 py-3">
                            {daysLeft !== null && (
                              <span className={cn(
                                'text-xs px-2 py-0.5 rounded-full',
                                daysLeft > 365 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30'
                                  : daysLeft > 30 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30'
                                  : 'bg-red-100 text-red-700 dark:bg-red-900/30'
                              )}>
                                {daysLeft > 0
                                  ? `${daysLeft} dias`
                                  : 'Expirado'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={file.status === 'available' ? 'outline' : 'secondary'} className="text-[10px]">
                              {file.status === 'available' ? '✓ Disponível'
                               : file.status === 'expired' ? 'Expirado'
                               : file.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            {file.status === 'available' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => downloadFile(file)}
                              >
                                <Download className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Aba: Políticas ──────────────────────────────────── */}
        <TabsContent value="policies" className="space-y-4">
          {policies.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
              <Shield className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p>Nenhuma política de backup configurada</p>
            </div>
          ) : (
            <div className="space-y-3">
              {policies.map(policy => (
                <div key={policy.id} className="bg-card border border-border/60 rounded-2xl p-5 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-foreground">{policy.name}</h4>
                      <p className="text-xs text-muted-foreground">{policy.backup_type} · {policy.frequency}</p>
                    </div>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full',
                      policy.enabled
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30'
                        : 'bg-muted text-muted-foreground'
                    )}>
                      {policy.enabled ? '● Ativo' : '○ Inativo'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>Retenção: <strong>{policy.retention_years} anos</strong></span>
                    <span>Bucket: <strong>{policy.storage_bucket}</strong></span>
                    <span>XML: {policy.include_xml ? '✓' : '✗'}</span>
                    <span>JSON: {policy.include_json ? '✓' : '✗'}</span>
                    <span>Logs: {policy.include_logs ? '✓' : '✗'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }) {
  const colors = {
    green: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40',
    blue:  'text-blue-600 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800/40',
    default: 'text-[#2d9c4a] bg-card border-border/60',
  };
  return (
    <div className={cn('rounded-2xl p-4 border flex items-center gap-3', colors[accent] || colors.default)}>
      <Icon className="w-5 h-5 shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground leading-none">{label}</p>
        <p className="text-lg font-bold mt-0.5">{value ?? 0}</p>
      </div>
    </div>
  );
}
