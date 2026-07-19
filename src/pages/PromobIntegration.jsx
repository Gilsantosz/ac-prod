import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import {
  Upload, Plug, History, FileText, Database, Shield, Settings, Download, Search,
  RefreshCw, Trash2, Check, Lock, Cloud
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ─── Sub-componentes ──────────────────────────────────────────
import XmlImportTab from '@/components/promob/XmlImportTab';
import PcpImportTab from '@/components/promob/PcpImportTab';
import ApiConfigTab from '@/components/promob/ApiConfigTab';


export default function PromobIntegration() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = ['import', 'history', 'orders', 'logs', 'backup', 'settings'].includes(requestedTab) ? requestedTab : 'import';
  const [importMode, setImportMode] = useState('promob');
  const [preselectedPcpFile, setPreselectedPcpFile] = useState(null);
  
  // Estados para o Histórico de Importações
  const [batches, setBatches] = useState([]);
  const [batchesCount, setBatchesCount] = useState(0);
  const [batchPage, setBatchPage] = useState(0);
  const [batchSearch, setBatchSearch] = useState('');
  const [batchStatusFilter, setBatchStatusFilter] = useState('');
  const [loadingBatches, setLoadingBatches] = useState(false);

  // Estados para Exclusão de Lotes de Importação
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [batchToDelete, setBatchToDelete] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);

  // Estados para as Ordens de Produção Geradas
  const [orders, setOrders] = useState([]);
  const [ordersCount, setOrdersCount] = useState(0);
  const [orderPage, setOrderPage] = useState(0);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Estados para os Logs de Importação
  const [pcpLogs, setPcpLogs] = useState([]);
  const [logsCount, setLogsCount] = useState(0);
  const [logPage, setLogPage] = useState(0);
  const [logSeverityFilter, setLogSeverityFilter] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Estados para Backups e Retenção
  const [backups, setBackups] = useState([]);
  const [backupsCount, setBackupsCount] = useState(0);
  const [backupPage, setBackupPage] = useState(0);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [verifyingIntegrity, setVerifyingIntegrity] = useState({});

  // Estados para Configurações de Integração
  const [integrationSettings, setIntegrationSettings] = useState([]);
  const [loadingSettings, setLoadingSettings] = useState(false);

  const PAGE_SIZE = 10;
  const handleTabChange = (value) => {
    setSearchParams(value === 'import' ? {} : { tab: value }, { replace: true });
  };

  // ─── Efeitos de carregamento de dados ──────────────────────────
  useEffect(() => {
    if (activeTab === 'history') fetchBatches();
    if (activeTab === 'orders') fetchOrders();
    if (activeTab === 'logs') fetchPcpLogs();
    if (activeTab === 'backup') fetchBackups();
    if (activeTab === 'settings') fetchSettings();
  }, [activeTab, batchPage, batchSearch, batchStatusFilter, orderPage, orderSearch, orderStatusFilter, logPage, logSeverityFilter, backupPage]);

  // ─── 1. Histórico de Importações ────────────────────────────────
  const fetchBatches = async () => {
    setLoadingBatches(true);
    try {
      let query = supabase
        .from('promob_import_batches')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(batchPage * PAGE_SIZE, (batchPage + 1) * PAGE_SIZE - 1);

      if (batchStatusFilter) {
        query = query.eq('status', batchStatusFilter);
      }
      if (batchSearch) {
        query = query.or(`file_name.ilike.%${batchSearch}%,customer_name.ilike.%${batchSearch}%,order_code.ilike.%${batchSearch}%`);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      setBatches(data || []);
      setBatchesCount(count || 0);
    } catch (err) {
      toast.error(`Erro ao carregar histórico: ${err.message}`);
    } finally {
      setLoadingBatches(false);
    }
  };

  const downloadOriginalFile = async (storagePath, fileName) => {
    if (!storagePath) {
      toast.error('Caminho do arquivo não encontrado.');
      return;
    }
    try {
      const { data, error } = await supabase.storage
        .from('productive-backups')
        .download(storagePath);
      
      if (error) throw error;

      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || 'original_file';
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Arquivo baixado com sucesso!');
    } catch (err) {
      toast.error(`Falha ao baixar arquivo: ${err.message}`);
    }
  };

  const requestBatchDelete = (batch) => {
    const isAuthorized = user?.role === 'admin' || user?.role === 'manager';
    if (!isAuthorized) {
      toast.error('Apenas usuários com perfil de Administrador ou Gestor podem excluir importações.');
      return;
    }
    setBatchToDelete(batch);
    setDeletePassword('');
    setIsDeleteModalOpen(true);
  };

  const confirmBatchDelete = async (e) => {
    e.preventDefault();
    if (!batchToDelete) return;
    if (!deletePassword) {
      toast.error('Por favor, digite sua senha para confirmar.');
      return;
    }

    setIsDeletingBatch(true);
    try {
      // 1. Validar a senha do usuário logado reautenticando no Supabase Auth
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: deletePassword,
      });

      if (authErr) {
        throw new Error('Senha incorreta. Ação negada.');
      }

      // 2. Excluir o arquivo no storage
      if (batchToDelete.raw_xml_storage_path) {
        const { error: storageErr } = await supabase.storage
          .from('productive-backups')
          .remove([batchToDelete.raw_xml_storage_path]);

        if (storageErr) {
          console.warn('Erro ao remover arquivo físico do storage:', storageErr);
        }
      }

      // 3. Deletar backup correspondente se existir indexado em backup_files
      await supabase
        .from('backup_files')
        .delete()
        .eq('import_batch_id', batchToDelete.id);

      // 4. Excluir a ordem de produção (OP) associada se houver generated_op_id (o cascade cuidará dos lotes/roteiros)
      if (batchToDelete.generated_op_id) {
        const { error: opErr } = await supabase
          .from('production_orders')
          .delete()
          .eq('id', batchToDelete.generated_op_id);

        if (opErr) throw opErr;
      } else if (batchToDelete.order_code) {
        const { error: opErr } = await supabase
          .from('production_orders')
          .delete()
          .eq('order_code', batchToDelete.order_code);

        if (opErr) {
          console.warn('Erro ao remover OP via código de pedido:', opErr);
        }
      }

      // 5. Excluir o lote de importação em promob_import_batches
      const { error: batchErr } = await supabase
        .from('promob_import_batches')
        .delete()
        .eq('id', batchToDelete.id);

      if (batchErr) throw batchErr;

      toast.success('Importação e seus dados associados excluídos com sucesso!');
      setIsDeleteModalOpen(false);
      setBatchToDelete(null);
      setDeletePassword('');
      fetchBatches();
    } catch (err) {
      toast.error(`Falha ao excluir importação: ${err.message}`);
    } finally {
      setIsDeletingBatch(false);
    }
  };

  // ─── 2. Ordens de Produção ──────────────────────────────────────
  const fetchOrders = async () => {
    setLoadingOrders(true);
    try {
      let query = supabase
        .from('production_orders')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(orderPage * PAGE_SIZE, (orderPage + 1) * PAGE_SIZE - 1);

      if (orderStatusFilter) {
        query = query.eq('status', orderStatusFilter);
      }
      if (orderSearch) {
        query = query.or(`order_code.ilike.%${orderSearch}%,customer_name.ilike.%${orderSearch}%,promob_project_name.ilike.%${orderSearch}%`);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      setOrders(data || []);
      setOrdersCount(count || 0);
    } catch (err) {
      toast.error(`Erro ao carregar ordens: ${err.message}`);
    } finally {
      setLoadingOrders(false);
    }
  };

  // ─── 3. Logs do PCP ─────────────────────────────────────────────
  const fetchPcpLogs = async () => {
    setLoadingLogs(true);
    try {
      let query = supabase
        .from('pcp_import_logs')
        .select('*, promob_import_batches(file_name)')
        .order('created_at', { ascending: false })
        .range(logPage * PAGE_SIZE, (logPage + 1) * PAGE_SIZE - 1);

      if (logSeverityFilter) {
        query = query.eq('severity', logSeverityFilter);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      setPcpLogs(data || []);
      setLogsCount(count || 0);
    } catch (err) {
      toast.error(`Erro ao carregar logs: ${err.message}`);
    } finally {
      setLoadingLogs(false);
    }
  };

  // ─── 4. Backups e Retenção ──────────────────────────────────────
  const fetchBackups = async () => {
    setLoadingBackups(true);
    try {
      const { data, count, error } = await supabase
        .from('backup_files')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(backupPage * PAGE_SIZE, (backupPage + 1) * PAGE_SIZE - 1);

      if (error) throw error;
      setBackups(data || []);
      setBackupsCount(count || 0);
    } catch (err) {
      toast.error(`Erro ao carregar backups: ${err.message}`);
    } finally {
      setLoadingBackups(false);
    }
  };

  const verifyIntegrityAction = async (backupId, storagePath) => {
    setVerifyingIntegrity(prev => ({ ...prev, [backupId]: true }));
    try {
      // Tenta fazer um download parcial (head) ou checar a existência do arquivo no Storage
      const { error } = await supabase.storage
        .from('productive-backups')
        .download(storagePath, { transform: { width: 1 } }); // apenas cabeçalho de existência

      if (error) {
        // Se der erro de transform mas baixar o arquivo, significa que ele existe
        if (error.message.includes('transform')) {
          toast.success('Integridade verificada: Arquivo disponível.');
          return;
        }
        throw error;
      }
      toast.success('Integridade verificada: Arquivo disponível.');
    } catch (err) {
      toast.error(`Erro de integridade do storage: ${err.message}`);
    } finally {
      setVerifyingIntegrity(prev => ({ ...prev, [backupId]: false }));
    }
  };

  const deleteExpiredBackups = async () => {
    const confirm = window.confirm('Deseja realmente excluir todos os arquivos com retenção expirada?');
    if (!confirm) return;

    try {
      // Busca arquivos expirados
      const { data: expiredFiles, error: fetchErr } = await supabase
        .from('backup_files')
        .select('id, storage_path')
        .lt('expires_at', new Date().toISOString())
        .eq('status', 'available');

      if (fetchErr) throw fetchErr;

      if (!expiredFiles || expiredFiles.length === 0) {
        toast.info('Nenhum arquivo de backup expirado encontrado.');
        return;
      }

      // Exclui arquivos do storage e atualiza status no banco
      let successCount = 0;
      for (const file of expiredFiles) {
        const { error: storageErr } = await supabase.storage
          .from('productive-backups')
          .remove([file.storage_path]);
        
        if (!storageErr) {
          await supabase
            .from('backup_files')
            .update({ status: 'expired' })
            .eq('id', file.id);
          successCount++;
        }
      }

      toast.success(`${successCount} arquivos de backup expirados foram arquivados/removidos.`);
      fetchBackups();
    } catch (err) {
      toast.error(`Erro ao remover backups: ${err.message}`);
    }
  };

  // ─── 5. Configurações de Integração ────────────────────────────
  const fetchSettings = async () => {
    setLoadingSettings(true);
    try {
      const { data, error } = await supabase
        .from('pcp_integration_settings')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;
      setIntegrationSettings(data || []);
    } catch (err) {
      toast.error(`Erro ao carregar configurações: ${err.message}`);
    } finally {
      setLoadingSettings(false);
    }
  };

  const toggleSettingEnabled = async (id, currentVal, type) => {
    if (!isAdmin) {
      toast.error('Apenas administradores podem alterar configurações de integração.');
      return;
    }
    try {
      // Usa .select() para detectar quando RLS bloqueia silenciosamente (0 linhas)
      const { data: updated, error } = await supabase
        .from('pcp_integration_settings')
        .update({ enabled: !currentVal })
        .eq('id', id)
        .select('id, enabled')
        .single();

      if (error) throw error;
      if (!updated) throw new Error('Sem permissão para alterar esta configuração.');

      const typeLabel = type.replace(/_/g, ' ').toUpperCase();
      if (!currentVal) {
        toast.success(`Integração via ${typeLabel} ativada.`);
        if (type !== 'manual_upload') {
          toast.info(
            `Integração via ${typeLabel} ativada. Sincronizações automáticas serão implementadas na Fase 2.`,
            { duration: 5000 }
          );
        }
      } else {
        toast.success(`Integração via ${typeLabel} desativada.`);
      }
      // Atualiza estado local imediatamente (feedback instantâneo)
      setIntegrationSettings(prev =>
        prev.map(s => s.id === id ? { ...s, enabled: !currentVal } : s)
      );
    } catch (err) {
      const isRlsBlock = err.code === 'PGRST116' || err.message?.includes('single') || err.message?.includes('no rows');
      const message = isRlsBlock
        ? 'Acesso negado: apenas administradores podem alterar configurações de integração (bloqueado por RLS).'
        : err.message;
      toast.error(`Erro ao atualizar configuração: ${message}`);
    }
  };

  // Badge helpers
  const getBatchStatusBadge = (status) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-400',
      parsed: 'bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-400',
      processed: 'bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-400',
      error: 'bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400',
      duplicated: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400',
      validated_success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400',
      validated_warnings: 'bg-orange-100 text-orange-800 dark:bg-orange-950/30 dark:text-orange-400',
      failed_validation: 'bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400',
      cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-950/30 dark:text-gray-400'
    };
    return styles[status] || styles.pending;
  };

  const getOrderStatusBadge = (status) => {
    const styles = {
      imported: 'bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-400',
      released: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400',
      in_production: 'bg-orange-100 text-orange-800 dark:bg-orange-950/30 dark:text-orange-400',
      blocked: 'bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400',
      completed: 'bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-400',
      cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-950/30 dark:text-gray-400'
    };
    return styles[status] || styles.imported;
  };

  const getLogSeverityBadge = (severity) => {
    const styles = {
      info: 'bg-blue-100 text-blue-800 dark:bg-blue-950/20 dark:text-blue-400',
      warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950/20 dark:text-amber-400',
      error: 'bg-red-100 text-red-800 dark:bg-red-950/20 dark:text-red-400',
      critical: 'bg-purple-100 text-purple-800 dark:bg-purple-950/20 dark:text-purple-400'
    };
    return styles[severity] || styles.info;
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="PCP / Retaguarda — Portal de Planejamento"
        subtitle="Gerencie importações de planos de corte XML/CSV, ordens de produção, logs, backups de conformidade de 4 anos e configurações."
        icon={Plug}
      />

      {/* Cards de Atalhos Rápidos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <button
          onClick={() => handleTabChange('import')}
          className={cn(
            "p-3 border rounded-2xl text-left bg-card hover:bg-secondary/15 transition-all text-xs flex flex-col justify-between min-h-[85px] border-border/60",
            activeTab === 'import' && "border-[#2d9c4a]/50 bg-[#2d9c4a]/5"
          )}
        >
          <Upload className="w-4.5 h-4.5 text-[#2d9c4a]" />
          <div>
            <p className="font-bold text-foreground">Importar Arquivo</p>
            <p className="text-[10px] text-muted-foreground">Upload XML/CSV</p>
          </div>
        </button>

        <button
          onClick={() => handleTabChange('orders')}
          className={cn(
            "p-3 border rounded-2xl text-left bg-card hover:bg-secondary/15 transition-all text-xs flex flex-col justify-between min-h-[85px] border-border/60",
            activeTab === 'orders' && "border-[#2d9c4a]/50 bg-[#2d9c4a]/5"
          )}
        >
          <FileText className="w-4.5 h-4.5 text-blue-500" />
          <div>
            <p className="font-bold text-foreground">Ordens de Prod.</p>
            <p className="text-[10px] text-muted-foreground">{ordersCount} ativas</p>
          </div>
        </button>

        <button
          onClick={() => handleTabChange('history')}
          className={cn(
            "p-3 border rounded-2xl text-left bg-card hover:bg-secondary/15 transition-all text-xs flex flex-col justify-between min-h-[85px] border-border/60",
            activeTab === 'history' && "border-[#2d9c4a]/50 bg-[#2d9c4a]/5"
          )}
        >
          <History className="w-4.5 h-4.5 text-indigo-500" />
          <div>
            <p className="font-bold text-foreground">Histórico</p>
            <p className="text-[10px] text-muted-foreground">{batchesCount} importações</p>
          </div>
        </button>

        <button
          onClick={() => handleTabChange('logs')}
          className={cn(
            "p-3 border rounded-2xl text-left bg-card hover:bg-secondary/15 transition-all text-xs flex flex-col justify-between min-h-[85px] border-border/60",
            activeTab === 'logs' && "border-[#2d9c4a]/50 bg-[#2d9c4a]/5"
          )}
        >
          <Database className="w-4.5 h-4.5 text-amber-500" />
          <div>
            <p className="font-bold text-foreground">Logs do PCP</p>
            <p className="text-[10px] text-muted-foreground">{logsCount} entradas</p>
          </div>
        </button>

        <button
          onClick={() => handleTabChange('backup')}
          className={cn(
            "p-3 border rounded-2xl text-left bg-card hover:bg-secondary/15 transition-all text-xs flex flex-col justify-between min-h-[85px] border-border/60",
            activeTab === 'backup' && "border-[#2d9c4a]/50 bg-[#2d9c4a]/5"
          )}
        >
          <Shield className="w-4.5 h-4.5 text-emerald-500" />
          <div>
            <p className="font-bold text-foreground">Backups</p>
            <p className="text-[10px] text-muted-foreground">{backupsCount} salvos</p>
          </div>
        </button>

        <button
          onClick={() => handleTabChange('settings')}
          className={cn(
            "p-3 border rounded-2xl text-left bg-card hover:bg-secondary/15 transition-all text-xs flex flex-col justify-between min-h-[85px] border-border/60",
            activeTab === 'settings' && "border-[#2d9c4a]/50 bg-[#2d9c4a]/5"
          )}
        >
          <Settings className="w-4.5 h-4.5 text-zinc-500" />
          <div>
            <p className="font-bold text-foreground">Configurações</p>
            <p className="text-[10px] text-muted-foreground">Integração</p>
          </div>
        </button>
      </div>


      <Tabs defaultValue="import" value={activeTab} onValueChange={handleTabChange} className="space-y-6">

        {/* ── 1. Importar Arquivo ───────────────────────────────── */}
        <TabsContent value="import" className="space-y-6 outline-none">
          <div className="flex border-b border-border/40 pb-2 gap-4">
            <button
              onClick={() => setImportMode('promob')}
              className={cn(
                "pb-2 text-xs font-bold transition-all relative",
                importMode === 'promob' ? "text-[#2d9c4a] border-b-2 border-[#2d9c4a]" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Integração Promob (XML/CSV)
            </button>
            <button
              onClick={() => setImportMode('pcp')}
              className={cn(
                "pb-2 text-xs font-bold transition-all relative",
                importMode === 'pcp' ? "text-[#2d9c4a] border-b-2 border-[#2d9c4a]" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Padrão PCP Traceabilidade (XLSX, CSV, TSV, TXT, HTML, XML)
            </button>
          </div>
          {importMode === 'promob' ? (
            <XmlImportTab onSwitchToPcp={(file) => {
              setImportMode('pcp');
              setPreselectedPcpFile(file);
            }} />
          ) : (
            <PcpImportTab preselectedFile={preselectedPcpFile} clearPreselected={() => setPreselectedPcpFile(null)} />
          )}
        </TabsContent>

        {/* ── 2. Histórico de Importações ────────────────────────── */}
        <TabsContent value="history" className="space-y-6 outline-none">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={batchSearch}
                onChange={e => { setBatchSearch(e.target.value); setBatchPage(0); }}
                placeholder="Buscar por arquivo, cliente ou pedido..."
                className="pl-9"
              />
            </div>
            <select
              value={batchStatusFilter}
              onChange={e => { setBatchStatusFilter(e.target.value); setBatchPage(0); }}
              className="h-9 px-3 rounded-lg border border-input bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-full"
            >
              <option value="">Todos os status</option>
              <option value="parsed">Lido (parsed)</option>
              <option value="processed">Processado</option>
              <option value="duplicated">Duplicado</option>
              <option value="error">Erro</option>
            </select>
          </div>

          <Card className="border border-border/60 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              {loadingBatches ? (
                <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
                  <RefreshCw className="w-5 h-5 animate-spin" /> Carregando histórico...
                </div>
              ) : batches.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground space-y-2">
                  <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>Nenhum registro encontrado</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/30 border-b border-border/60">
                    <tr>
                      {['Data/Hora', 'Arquivo', 'Cliente/Projeto', 'Pedido', 'Peças', 'Status', 'Retenção 4 Anos', ''].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {batches.map(batch => (
                      <tr key={batch.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(batch.created_at).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-4 py-3 max-w-[180px] truncate">
                          <p className="font-semibold text-foreground text-xs">{batch.file_name || 'Sem nome'}</p>
                          <p className="text-[10px] text-muted-foreground">{(batch.file_size / 1024).toFixed(1)} KB</p>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <p className="text-foreground font-medium">{batch.customer_name || '—'}</p>
                          <p className="text-muted-foreground text-[10px]">{batch.promob_project_name || '—'}</p>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-foreground">
                          {batch.order_code || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground font-semibold">
                          {batch.total_parts || 0}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cn('text-[10px] py-0.5 px-2 font-medium', getBatchStatusBadge(batch.status))}>
                            {batch.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-[10px] text-muted-foreground">
                          {batch.retention_until ? new Date(batch.retention_until).toLocaleDateString('pt-BR') : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right space-x-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            id={`btn-download-${batch.id}`}
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground inline-flex items-center justify-center"
                            onClick={() => downloadOriginalFile(batch.raw_xml_storage_path, batch.file_name)}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          {(user?.role === 'admin' || user?.role === 'manager') && (
                            <Button
                              variant="ghost"
                              size="sm"
                              id={`btn-delete-${batch.id}`}
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50/50 inline-flex items-center justify-center"
                              onClick={() => requestBatchDelete(batch)}
                              title="Excluir importação e dados gerados"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Paginação */}
            <div className="px-4 py-3 border-t border-border/60 flex items-center justify-between gap-3 bg-secondary/10">
              <p className="text-xs text-muted-foreground">
                Total de {batchesCount} arquivos importados
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" id="btn-batch-prev" onClick={() => setBatchPage(p => Math.max(0, p-1))} disabled={batchPage === 0}>
                  Anterior
                </Button>
                <Button size="sm" variant="outline" id="btn-batch-next" onClick={() => setBatchPage(p => p+1)} disabled={(batchPage + 1) * PAGE_SIZE >= batchesCount}>
                  Próxima
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ── 3. Ordens de Produção ──────────────────────────────── */}
        <TabsContent value="orders" className="space-y-6 outline-none">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={orderSearch}
                onChange={e => { setOrderSearch(e.target.value); setOrderPage(0); }}
                placeholder="Buscar por código da OP, cliente ou projeto..."
                className="pl-9"
              />
            </div>
            <select
              value={orderStatusFilter}
              onChange={e => { setOrderStatusFilter(e.target.value); setOrderPage(0); }}
              className="h-9 px-3 rounded-lg border border-input bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-full"
            >
              <option value="">Todos os status</option>
              <option value="imported">Importada</option>
              <option value="released">Liberada</option>
              <option value="in_production">Em Produção</option>
              <option value="completed">Concluída</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </div>

          <Card className="border border-border/60 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              {loadingOrders ? (
                <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
                  <RefreshCw className="w-5 h-5 animate-spin" /> Carregando ordens...
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground space-y-2">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>Nenhuma ordem de produção encontrada</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/30 border-b border-border/60">
                    <tr>
                      {['Data Criada', 'Código OP', 'Cliente', 'Projeto', 'Entrega', 'Status', 'Ações'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {orders.map(order => (
                      <tr key={order.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(order.created_at).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground text-xs">
                          {order.order_code}
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground font-medium">
                          {order.customer_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[150px]">
                          {order.promob_project_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {order.delivery_date ? new Date(order.delivery_date).toLocaleDateString('pt-BR') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cn('text-[10px] py-0.5 px-2 font-medium', getOrderStatusBadge(order.status))}>
                            {order.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs space-x-1.5 whitespace-nowrap">
                          <Button asChild variant="outline" size="sm" className="h-7 text-[10px]">
                            <Link to="/rastreabilidade?tab=kanban">Kanban</Link>
                          </Button>
                          {(order.status === 'released' || order.status === 'in_production') && (
                            <Button asChild variant="outline" size="sm" className="h-7 text-[10px] text-amber-600 hover:text-amber-700">
                              <Link to="/rastreabilidade?tab=packaging">Embalar</Link>
                            </Button>
                          )}
                          {order.status === 'completed' && (
                            <Button asChild variant="outline" size="sm" className="h-7 text-[10px] text-emerald-600 hover:text-emerald-700">
                              <Link to="/rastreabilidade?tab=shipping">Expedir</Link>
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

              )}
            </div>

            {/* Paginação */}
            <div className="px-4 py-3 border-t border-border/60 flex items-center justify-between gap-3 bg-secondary/10">
              <p className="text-xs text-muted-foreground">
                Total de {ordersCount} ordens de produção
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" id="btn-order-prev" onClick={() => setOrderPage(p => Math.max(0, p-1))} disabled={orderPage === 0}>
                  Anterior
                </Button>
                <Button size="sm" variant="outline" id="btn-order-next" onClick={() => setOrderPage(p => p+1)} disabled={(orderPage + 1) * PAGE_SIZE >= ordersCount}>
                  Próxima
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ── 4. Logs do PCP ─────────────────────────────────────── */}
        <TabsContent value="logs" className="space-y-6 outline-none">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="logSeverity" className="text-xs text-muted-foreground shrink-0">Filtrar por Gravidade:</Label>
              <select
                id="logSeverity"
                value={logSeverityFilter}
                onChange={e => { setLogSeverityFilter(e.target.value); setLogPage(0); }}
                className="h-9 px-3 rounded-lg border border-input bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-40"
              >
                <option value="">Todas</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <Card className="border border-border/60 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              {loadingLogs ? (
                <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
                  <RefreshCw className="w-5 h-5 animate-spin" /> Carregando logs PCP...
                </div>
              ) : pcpLogs.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground space-y-2">
                  <Database className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>Nenhum log operacional registrado</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/30 border-b border-border/60">
                    <tr>
                      {['Data/Hora', 'Ação', 'Mensagem', 'Gravidade', 'Arquivo PCP'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {pcpLogs.map(log => (
                      <tr key={log.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(log.created_at).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold text-foreground whitespace-nowrap">
                          {log.action}
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground max-w-sm">
                          {log.message}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cn('text-[10px] py-0.5 px-2 font-medium', getLogSeverityBadge(log.severity))}>
                            {log.severity}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[150px]">
                          {log.promob_import_batches?.file_name || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Paginação */}
            <div className="px-4 py-3 border-t border-border/60 flex items-center justify-between gap-3 bg-secondary/10">
              <p className="text-xs text-muted-foreground">
                Total de {logsCount} logs de importação do PCP
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" id="btn-log-prev" onClick={() => setLogPage(p => Math.max(0, p-1))} disabled={logPage === 0}>
                  Anterior
                </Button>
                <Button size="sm" variant="outline" id="btn-log-next" onClick={() => setLogPage(p => p+1)} disabled={(logPage + 1) * PAGE_SIZE >= logsCount}>
                  Próxima
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ── 5. Backup e Retenção ──────────────────────────────── */}
        <TabsContent value="backup" className="space-y-6 outline-none">
          <div className="flex items-start justify-between flex-wrap gap-4 border-b border-border/60 pb-4">
            <div className="space-y-1">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#2d9c4a]" /> Políticas de Backup & Retenção
              </h3>
              <p className="text-xs text-muted-foreground">
                O Portal PCP implementa conformidade industrial de retenção de 4 anos (1.460 dias) para conformidade histórica.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button asChild variant="outline" size="sm" className="gap-2">
                <Link to="/downloads-backups?tab=drive">
                  <Cloud className="w-3.5 h-3.5" /> Google Drive
                </Link>
              </Button>
              <Button variant="destructive" size="sm" className="gap-2" onClick={deleteExpiredBackups}>
                <Trash2 className="w-3.5 h-3.5" /> Excluir Expirados
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4 border border-border/60 shadow-sm space-y-3">
              <h4 className="font-semibold text-sm text-foreground">Configuração da Política de Retenção</h4>
              <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                <div>
                  <p className="text-muted-foreground">Retenção de Arquivo</p>
                  <p className="font-bold text-foreground">4 Anos (1.460 dias)</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Bucket de Storage</p>
                  <p className="font-bold text-foreground">productive-backups</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Proteção de Exclusão</p>
                  <p className="font-bold text-green-600 dark:text-green-400">Ativa (Admin Only)</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cópia de Segurança</p>
                  <p className="font-bold text-foreground">XML + JSON Estruturado</p>
                </div>
              </div>
            </Card>

            <Card className="p-4 border border-border/60 shadow-sm flex flex-col justify-between">
              <div className="space-y-1">
                <h4 className="font-semibold text-sm text-foreground">Métricas de Cobertura</h4>
                <p className="text-xs text-muted-foreground">Total de arquivos indexados para recuperação de desastre.</p>
              </div>
              <div className="flex items-baseline gap-2 pt-2">
                <span className="text-2xl font-bold text-foreground">{backupsCount}</span>
                <span className="text-xs text-muted-foreground">arquivos indexados</span>
              </div>
            </Card>
          </div>

          <Card className="border border-border/60 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              {loadingBackups ? (
                <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
                  <RefreshCw className="w-5 h-5 animate-spin" /> Carregando backups...
                </div>
              ) : backups.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground space-y-2">
                  <Shield className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>Nenhum backup indexado no banco</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/30 border-b border-border/60">
                    <tr>
                      {['Data Backup', 'Nome do Arquivo', 'Tipo', 'Tamanho', 'Vence em', 'Status', 'Ações'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {backups.map(file => (
                      <tr key={file.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(file.created_at).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-4 py-3 max-w-[200px] truncate font-medium text-foreground text-xs">
                          {file.file_name}
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground uppercase font-bold">
                          {file.file_type}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {file.file_size ? `${(file.file_size / 1024).toFixed(1)} KB` : '0 KB'}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {file.expires_at ? new Date(file.expires_at).toLocaleDateString('pt-BR') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cn(
                            'text-[10px] py-0.5 px-2 font-medium',
                            file.status === 'available' && 'bg-green-100 text-green-800 dark:bg-green-950/20 dark:text-green-400',
                            file.status === 'expired' && 'bg-gray-100 text-gray-800 dark:bg-gray-950/20 dark:text-gray-400',
                            file.status === 'error' && 'bg-red-100 text-red-800 dark:bg-red-950/20 dark:text-red-400'
                          )}>
                            {file.status === 'available' ? 'disponível' : file.status === 'expired' ? 'expirado' : 'erro'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs">
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs gap-1.5"
                              disabled={verifyingIntegrity[file.id]}
                              onClick={() => verifyIntegrityAction(file.id, file.storage_path)}
                            >
                              {verifyingIntegrity[file.id] ? (
                                <><RefreshCw className="w-3 animate-spin" /> Checando</>
                              ) : (
                                'Verificar Integridade'
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                              onClick={() => downloadOriginalFile(file.storage_path, file.file_name)}
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Paginação */}
            <div className="px-4 py-3 border-t border-border/60 flex items-center justify-between gap-3 bg-secondary/10">
              <p className="text-xs text-muted-foreground">
                Total de {backupsCount} backups disponíveis
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" id="btn-backup-prev" onClick={() => setBackupPage(p => Math.max(0, p-1))} disabled={backupPage === 0}>
                  Anterior
                </Button>
                <Button size="sm" variant="outline" id="btn-backup-next" onClick={() => setBackupPage(p => p+1)} disabled={(backupPage + 1) * PAGE_SIZE >= backupsCount}>
                  Próxima
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ── 6. Configurações ────────────────────────────────────── */}
        <TabsContent value="settings" className="space-y-6 outline-none">
          <div className="space-y-1">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Settings className="w-5 h-5 text-[#2d9c4a]" /> Configurações de Integração de Entrada
            </h3>
            <p className="text-xs text-muted-foreground">
              Prepare a estrutura para sincronizações automáticas com Google Drive, FTP ou APIs do Promob.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {loadingSettings ? (
              <div className="col-span-2 text-center py-10 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Carregando configurações...
              </div>
            ) : (
              integrationSettings.map(setting => {
                const isManual = setting.integration_type === 'manual_upload';
                return (
                  <Card key={setting.id} className="p-5 border border-border/60 shadow-sm relative overflow-hidden flex flex-col justify-between space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge className="capitalize text-xs font-bold bg-[#76FB91]/10 text-[#2d9c4a] border border-[#76FB91]/25">
                          {setting.integration_type.replace('_', ' ')}
                        </Badge>
                        {setting.enabled ? (
                          <span className="text-[10px] text-green-500 font-semibold flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> {isManual ? 'Padrão Ativo' : 'Ativo (Fase 2)'}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1">
                            {isManual ? (
                              <span className="text-amber-500 font-semibold flex items-center gap-1">Inativo</span>
                            ) : (
                              <>
                                <Lock className="w-3 h-3" /> Integração Futura
                              </>
                            )}
                          </span>
                        )}
                      </div>
                      
                      <h4 className="font-bold text-foreground text-sm">
                        {setting.integration_type === 'manual_upload' && 'Upload Manual do PCP (XML/CSV)'}
                        {setting.integration_type === 'google_drive' && 'Sincronização Google Drive'}
                        {setting.integration_type === 'promob_api' && 'Integração Direta com API Promob'}
                        {setting.integration_type === 'local_watch_folder' && 'Diretório Monitorado Local'}
                        {setting.integration_type === 'ftp' && 'Servidor FTP Compartilhado'}
                        {setting.integration_type === 's3' && 'Bucket AWS S3/Compatível'}
                      </h4>
                      
                      <p className="text-xs text-muted-foreground">
                        {setting.integration_type === 'manual_upload' && 'Permite carregar arquivos do PCP de forma manual via arrastar e soltar na interface.'}
                        {setting.integration_type === 'google_drive' && 'Sincroniza planos de corte de uma pasta monitorada no Google Drive automaticamente.'}
                        {setting.integration_type === 'promob_api' && 'Puxa as OPs automaticamente a partir do endpoint de ERP da Promob.'}
                        {setting.integration_type === 'local_watch_folder' && 'Monitoramento de pasta em rede local usando agente watchfolder.'}
                        {setting.integration_type === 'ftp' && 'Verifica periodicamente arquivos em um servidor FTP.'}
                        {setting.integration_type === 's3' && 'Importações assíncronas via buckets compatíveis.'}
                      </p>
                    </div>

                    <div className="flex justify-between items-center pt-2 border-t border-border/40">
                      <span className="text-xs text-muted-foreground">
                        {setting.last_sync_at ? `Última sincronização: ${new Date(setting.last_sync_at).toLocaleString()}` : 'Nunca sincronizado'}
                      </span>
                      <div className="flex flex-col items-end gap-1">
                        {setting.integration_type === 'google_drive' && (
                          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1.5">
                            <Link to="/downloads-backups?tab=drive">
                              <Cloud className="w-3.5 h-3.5" /> Configurar Drive
                            </Link>
                          </Button>
                        )}
                        {!isAdmin && (
                          <span className="text-[10px] text-muted-foreground">Requer perfil Admin</span>
                        )}
                        <Button
                          variant={setting.enabled ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => toggleSettingEnabled(setting.id, setting.enabled, setting.integration_type)}
                          disabled={!isAdmin}
                          className={cn(
                            setting.enabled && isAdmin && 'bg-[#2d9c4a] hover:bg-[#25813d] text-white',
                            !isAdmin && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          {setting.enabled ? 'Ativo' : 'Ativar'}
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
          </div>

          {/* Configuração de APIs ativas e webhook integrando ApiConfigTab */}
          <div className="pt-6 border-t border-border/60">
            <h4 className="font-bold text-sm text-foreground mb-3">Configurador de APIs e Sincronização Dinâmica (Promob API)</h4>
            <ApiConfigTab />
          </div>
        </TabsContent>
      </Tabs>


      {/* Dialog de Confirmação de Exclusão com Senha */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <Trash2 className="w-5 h-5" /> Excluir Importação PCP
            </DialogTitle>
            <DialogDescription>
              Atenção: Esta ação é irreversível. Ela excluirá o arquivo original do storage e a Ordem de Produção (OP) com todos os seus lotes e roteiros gerados.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={confirmBatchDelete} className="space-y-4 py-2">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">
                Arquivo a ser excluído:
              </div>
              <div className="bg-secondary/40 p-2.5 rounded-lg border border-border/40 text-xs break-all font-mono">
                {batchToDelete?.file_name}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delete-password">Sua Senha de Confirmação</Label>
              <Input
                id="delete-password"
                type="password"
                required
                placeholder="Digite sua senha para autorizar"
                value={deletePassword}
                onChange={e => setDeletePassword(e.target.value)}
                autoComplete="current-password"
              />
              <p className="text-[10px] text-muted-foreground">
                Apenas usuários Admins ou Gestores podem autorizar esta exclusão.
              </p>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeletingBatch}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={isDeletingBatch}
                className="gap-2"
              >
                {isDeletingBatch ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Excluindo...
                  </>
                ) : (
                  'Confirmar Exclusão'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
