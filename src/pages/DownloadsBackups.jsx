import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';
import { useAuth } from '@/lib/AuthContext';
import {
  fetchGoogleDriveArchiveStatus,
  saveGoogleDriveArchiveSettings,
  syncGoogleDriveArchive,
} from '@/lib/googleDriveArchiveService';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  HardDrive, Download, RefreshCw, FileText, FileJson, Archive,
  Shield, CheckCircle, Database, Cloud, CloudUpload,
  ExternalLink, Save, AlertOctagon
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
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [generating, setGenerating] = useState(false);
  const [driveEnabled, setDriveEnabled] = useState(false);
  const [driveFolderId, setDriveFolderId] = useState('');
  const [savingDrive, setSavingDrive] = useState(false);
  const [syncingDrive, setSyncingDrive] = useState(false);
  const [archivingDrive, setArchivingDrive] = useState(false);
  const requestedTab = searchParams.get('tab');
  const activeTab = ['files', 'policies', 'drive'].includes(requestedTab) ? requestedTab : 'files';
  const isAdmin = user?.role === 'admin';

  // Estados para zerar o sistema
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);

  const handleResetSystemData = async () => {
    if (confirmText !== 'ZERAR') {
      toast.error('Digite ZERAR para confirmar a exclusão.');
      return;
    }
    setResetting(true);
    try {
      const { data, error } = await supabase.rpc('reset_production_data');
      if (error) throw error;
      if (data?.success) {
        toast.success(data.message || 'Sistema de peças zerado com sucesso.');
        setResetDialogOpen(false);
        setConfirmText('');
        refetch();
        refetchDriveStatus();
      } else {
        throw new Error(data?.error || 'Falha ao zerar dados de produção.');
      }
    } catch (e) {
      toast.error(`Erro ao zerar: ${e.message}`);
    } finally {
      setResetting(false);
    }
  };

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

  const { data: driveStatus, refetch: refetchDriveStatus } = useQuery({
    queryKey: ['google-drive-archive-status'],
    queryFn: fetchGoogleDriveArchiveStatus,
    initialData: { setting: {}, totals: { total: 0, pending: 0, synced: 0, archived: 0, error: 0, available: 0 }, latestFiles: [] },
    retry: false,
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
        refetchDriveStatus();
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

  const handleTabChange = (value) => {
    setSearchParams(value === 'files' ? {} : { tab: value }, { replace: true });
  };

  const saveDriveSettings = async () => {
    if (!isAdmin) {
      toast.error('Apenas administradores podem alterar a integração Google Drive.');
      return;
    }
    setSavingDrive(true);
    try {
      const saved = await saveGoogleDriveArchiveSettings({
        enabled: driveEnabled,
        driveFolderId: driveFolderId.trim(),
      });
      setDriveEnabled(saved.enabled === true);
      setDriveFolderId(saved.drive_folder_id || saved.folder_path || '');
      toast.success('Configuração do Google Drive salva.');
      refetchDriveStatus();
    } catch (error) {
      toast.error(`Falha ao salvar Drive: ${error.message}`);
    } finally {
      setSavingDrive(false);
    }
  };

  const runDriveSync = async (archiveLocal = false) => {
    if (!driveStatus.setting?.enabled) {
      toast.error('Ative o Google Drive antes de sincronizar.');
      return;
    }
    if (archiveLocal) setArchivingDrive(true);
    else setSyncingDrive(true);
    try {
      const result = await syncGoogleDriveArchive({ archiveLocal, limit: 50 });
      toast.success(result.message || 'Google Drive atualizado.');
      refetch();
      refetchDriveStatus();
    } catch (error) {
      toast.error(`Falha no Google Drive: ${error.message}`);
    } finally {
      setSyncingDrive(false);
      setArchivingDrive(false);
    }
  };

  const openExternalFile = (url) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const driveBadge = (file) => {
    if (file.external_sync_status === 'error') return { label: 'Erro Drive', className: 'border-red-300 text-red-700 dark:text-red-400' };
    if (file.status === 'archived') return { label: 'Arquivado Drive', className: 'border-emerald-300 text-emerald-700 dark:text-emerald-400' };
    if (file.external_storage_provider === 'google_drive') return { label: 'No Drive', className: 'border-blue-300 text-blue-700 dark:text-blue-400' };
    return { label: 'Local', className: 'border-muted-foreground/30 text-muted-foreground' };
  };

  useEffect(() => {
    const setting = driveStatus.setting || {};
    setDriveEnabled(setting.enabled === true);
    setDriveFolderId(setting.drive_folder_id || setting.folder_path || '');
  }, [driveStatus.setting]);

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
        <StatCard icon={Cloud}        label="Google Drive"   value={driveStatus.totals.synced + driveStatus.totals.archived} accent="blue" />
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-5">
        <TabsList className="bg-card border border-border/60">
          <TabsTrigger value="files" className="gap-2">
            <HardDrive className="w-4 h-4" /> Arquivos
          </TabsTrigger>
          <TabsTrigger value="policies" className="gap-2">
            <Shield className="w-4 h-4" /> Políticas
          </TabsTrigger>
          <TabsTrigger value="drive" className="gap-2">
            <Cloud className="w-4 h-4" /> Google Drive
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
                      {['Arquivo', 'Pedido', 'Data', 'Tamanho', 'Expira', 'Status', 'Drive', ''].map(h => (
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
                               : file.status === 'archived' ? 'Arquivado'
                               : file.status === 'expired' ? 'Expirado'
                               : file.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={cn('text-[10px]', driveBadge(file).className)}>
                              {driveBadge(file).label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {file.status === 'available' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  onClick={() => downloadFile(file)}
                                  title="Baixar arquivo local"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {file.external_web_url && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  onClick={() => openExternalFile(file.external_web_url)}
                                  title="Abrir no Google Drive"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
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

        {/* ── Aba: Google Drive ─────────────────────────────────── */}
        <TabsContent value="drive" className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-5">
            <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <Cloud className="w-5 h-5 text-[#2d9c4a]" /> Arquivo Google Drive
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Envie backups e ordens de produção para uma pasta do Drive. A credencial fica protegida na função do Supabase.
                  </p>
                </div>
                <Badge variant="outline" className={cn(
                  'shrink-0',
                  driveStatus.setting?.enabled
                    ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400'
                    : 'border-muted-foreground/30 text-muted-foreground'
                )}>
                  {driveStatus.setting?.enabled ? 'Ativo' : 'Inativo'}
                </Badge>
              </div>

              <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Pasta no Google Drive
                  </label>
                  <input
                    value={driveFolderId}
                    onChange={(event) => setDriveFolderId(event.target.value)}
                    placeholder="ID, link ou Backups AC.Prod/Ordens de Produção"
                    disabled={!isAdmin}
                    className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                  />
                  <p className="text-xs text-muted-foreground">
                    Aceita ID, link da pasta ou caminho. Se for caminho, a pasta será criada no Drive.
                  </p>
                </div>
                <Button
                  variant={driveEnabled ? 'default' : 'outline'}
                  onClick={() => setDriveEnabled((current) => !current)}
                  disabled={!isAdmin}
                  className={cn(driveEnabled && 'bg-[#2d9c4a] hover:bg-[#25813d] text-white')}
                >
                  {driveEnabled ? 'Ativo' : 'Ativar'}
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={saveDriveSettings} disabled={!isAdmin || savingDrive} className="gap-2 bg-[#2d9c4a] hover:bg-[#25813d] text-white">
                  {savingDrive ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar Configuração
                </Button>
                <Button variant="outline" onClick={() => runDriveSync(false)} disabled={!isAdmin || syncingDrive || archivingDrive} className="gap-2">
                  {syncingDrive ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
                  Sincronizar Pendentes
                </Button>
                <Button variant="outline" onClick={() => runDriveSync(true)} disabled={!isAdmin || syncingDrive || archivingDrive} className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20">
                  {archivingDrive ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                  Arquivar Local Após Drive
                </Button>
              </div>

              {!isAdmin && (
                <p className="text-xs text-muted-foreground">
                  Somente administradores podem alterar ou executar o arquivamento externo.
                </p>
              )}
              {driveStatus.setting?.last_sync_error && (
                <div className="text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/60 rounded-lg p-3">
                  Última falha: {driveStatus.setting.last_sync_error}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={HardDrive} label="Arquivos locais" value={driveStatus.totals.available} />
              <StatCard icon={Cloud} label="Sincronizados" value={driveStatus.totals.synced} accent="blue" />
              <StatCard icon={Archive} label="Arquivados" value={driveStatus.totals.archived} accent="green" />
              <StatCard icon={Shield} label="Pendentes" value={driveStatus.totals.pending} />
            </div>
          </div>

          <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between gap-3">
              <h4 className="font-semibold text-sm text-foreground">Últimos arquivos rastreados</h4>
              {driveStatus.setting?.last_sync_at && (
                <span className="text-xs text-muted-foreground">
                  Última sincronização: {new Date(driveStatus.setting.last_sync_at).toLocaleString('pt-BR')}
                </span>
              )}
            </div>
            {driveStatus.latestFiles.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                Nenhum backup encontrado para sincronizar.
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {driveStatus.latestFiles.map((file) => {
                  const badge = driveBadge(file);
                  return (
                    <div key={file.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{file.external_storage_path || file.storage_path}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={cn('text-[10px]', badge.className)}>{badge.label}</Badge>
                        {file.external_web_url && (
                          <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => openExternalFile(file.external_web_url)}>
                            <ExternalLink className="w-3.5 h-3.5" /> Abrir
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
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

      {/* ── Danger Zone / Zerar Sistema (Apenas Admin) ──────────────── */}
      {isAdmin && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/60 rounded-2xl p-5 space-y-3">
          <h3 className="font-bold text-red-700 dark:text-red-400 flex items-center gap-2">
            <AlertOctagon className="w-5 h-5 text-red-600" /> Zona de Perigo (Ações Administrativas)
          </h3>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-foreground">Zerar registro de peças e produção</p>
              <p className="text-xs text-muted-foreground mt-1">
                Apaga permanentemente todas as OPs (Ordens de Produção), lotes, itens de lote, tags vinculadas, histórico de leituras/coletas, ocorrências registradas e arquivos de backup do Storage. 
                Os perfis de usuários, logins dos operadores, histórico de acessos e cadastro de células serão **preservados intactos**. Esta ação não pode ser desfeita.
              </p>
            </div>
            <Button
              variant="destructive"
              className="shrink-0 gap-2 font-semibold"
              onClick={() => setResetDialogOpen(true)}
            >
              Zerar Registro de Peças
            </Button>
          </div>
        </div>
      )}

      {/* Dialog de Confirmação de Reset */}
      <Dialog open={resetDialogOpen} onOpenChange={(open) => { if (!open) setConfirmText(''); setResetDialogOpen(open); }}>
        <DialogContent className="sm:max-w-[480px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-red-600">
              <AlertOctagon className="w-5 h-5" /> Confirmar reinicialização de dados?
            </DialogTitle>
            <DialogDescription className="text-xs">
              Esta ação removerá de forma imutável e irreversível todos os dados de peças, OPs, leituras, eventos de fila e recontagens do banco de dados. Os cadastros de usuários, operadores e células não serão afetados.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="confirm-reset-text" className="text-xs font-bold text-muted-foreground">
                Para prosseguir, digite <span className="font-mono text-red-600 select-all font-bold">ZERAR</span> no campo abaixo:
              </Label>
              <Input
                id="confirm-reset-text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Digite ZERAR"
                autoComplete="off"
                className="h-11 rounded-xl text-center font-bold tracking-widest"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setResetDialogOpen(false)}
              disabled={resetting}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleResetSystemData}
              disabled={resetting || confirmText !== 'ZERAR'}
              className="text-xs font-semibold gap-1.5"
            >
              {resetting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
              {resetting ? 'Limpando dados...' : 'Sim, Apagar Tudo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
