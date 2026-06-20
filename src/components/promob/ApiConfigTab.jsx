import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/lib/localDb';
import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Link2, RefreshCw, CheckCircle, AlertTriangle, Plus,
  Clock, Wifi, Trash2, Edit,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SYNC_INTERVALS = [
  { value: 5,    label: 'A cada 5 minutos' },
  { value: 15,   label: 'A cada 15 minutos' },
  { value: 30,   label: 'A cada 30 minutos' },
  { value: 60,   label: 'A cada 1 hora' },
  { value: 0,    label: 'Manual' },
];

const MODES = [
  { value: 'manual_xml',   label: 'Apenas XML Manual' },
  { value: 'api_pull',     label: 'Buscar via API' },
  { value: 'api_webhook',  label: 'Receber Webhook' },
  { value: 'hybrid',       label: 'Híbrido (Manual + API)' },
];

export default function ApiConfigTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [form, setForm] = useState({
    name: '',
    mode: 'hybrid',
    api_url: '',
    token: '',          // campo temporário — nunca vai para o banco diretamente
    sync_interval_minutes: 60,
    environment: 'production',
    active: true,
  });

  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ['promob-integrations'],
    queryFn: () => base44.entities.PromobIntegration.list('-created_at', 20),
    initialData: [],
  });

  // ─── Salvar integração ───────────────────────────────────────
  const save = useMutation({
    mutationFn: async (payload) => {
      // SEGURANÇA: O token NUNCA é enviado diretamente ao banco via frontend.
      // Ele é armazenado via Edge Function que usa o Supabase Vault.
      const { token, ...safePayload } = payload;
      const requiresApiToken = safePayload.mode !== 'manual_xml';

      if (!editingId && requiresApiToken && !token.trim()) {
        throw new Error('Informe o token da API antes de criar a integração.');
      }

      let savedIntegration;
      if (editingId) {
        savedIntegration = await base44.entities.PromobIntegration.update(editingId, safePayload);
      } else {
        savedIntegration = await base44.entities.PromobIntegration.create(safePayload);
      }

      // Chama Edge Function para salvar token no Vault de forma segura.
      // Em novas integrações, isso precisa acontecer depois do INSERT para existir um ID.
      if (requiresApiToken && token.trim()) {
        const resp = await supabase.functions.invoke('promob-api-sync', {
          body: { action: 'store_token', integrationId: savedIntegration.id, token },
        });
        if (resp.error || !resp.data?.success) {
          const message = await getFunctionErrorMessage(resp, 'Falha ao salvar token');
          throw new Error(`Falha ao salvar token: ${message}`);
        }
      }

      return savedIntegration;
    },
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ['promob-integrations'] });
      await auditLog(AUDIT_ACTIONS.API_CONFIG_CHANGE, 'promob_integration', data?.id, {
        name: form.name, mode: form.mode,
      });
      toast.success('Integração Promob salva com sucesso!');
      resetForm();
    },
    onError: (e) => toast.error(e?.message || 'Falha ao salvar integração'),
  });

  const deleteIntegration = useMutation({
    mutationFn: (id) => base44.entities.PromobIntegration.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promob-integrations'] });
      toast.success('Integração removida');
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }) => base44.entities.PromobIntegration.update(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['promob-integrations'] }),
  });

  const resetForm = () => {
    setForm({ name: '', mode: 'hybrid', api_url: '', token: '', sync_interval_minutes: 60, environment: 'production', active: true });
    setShowForm(false);
    setEditingId(null);
  };

  const startEdit = (integration) => {
    setForm({
      name:                  integration.name,
      mode:                  integration.mode,
      api_url:               integration.api_url || '',
      token:                 '',  // nunca pré-preencher o token
      sync_interval_minutes: integration.sync_interval_minutes || 60,
      environment:           integration.environment || 'production',
      active:                integration.active ?? true,
    });
    setEditingId(integration.id);
    setShowForm(true);
  };

  // ─── Testar conexão ─────────────────────────────────────────
  const testConnection = async (integrationId) => {
    setTesting(true);
    try {
      const resp = await supabase.functions.invoke('promob-api-sync', {
        body: { action: 'test', integrationId },
      });
      if (resp.error || !resp.data?.success) {
        const message = await getFunctionErrorMessage(resp, 'Não foi possível conectar');
        toast.error(`❌ Falha: ${message}`);
        return;
      }
      toast.success('✅ Conexão com a API Promob realizada com sucesso!');
    } catch (e) {
      toast.error(`Erro: ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  // ─── Sincronizar agora ──────────────────────────────────────
  const syncNow = async (integrationId) => {
    setSyncing(true);
    try {
      const resp = await supabase.functions.invoke('promob-api-sync', {
        body: { action: 'sync', integrationId },
      });
      if (resp.error || !resp.data?.success) {
        const message = await getFunctionErrorMessage(resp, 'Não foi possível sincronizar');
        toast.error(`❌ Falha na sincronização: ${message}`);
        return;
      }
      qc.invalidateQueries({ queryKey: ['promob-integrations'] });
      toast.success(`✅ Sincronização concluída! ${resp.data?.imported || 0} ordens importadas.`);
    } catch (e) {
      toast.error(`Erro: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Lista de integrações existentes */}
      {isLoading ? (
        <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin" /> Carregando integrações…
        </div>
      ) : integrations.length === 0 && !showForm ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
          <Link2 className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p className="font-medium text-foreground">Nenhuma integração configurada</p>
          <p className="text-sm mt-1">Adicione a configuração da API Promob abaixo</p>
        </div>
      ) : (
        <div className="space-y-3">
          {integrations.map((integ) => (
            <div key={integ.id}
              className="bg-card border border-border/60 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold text-foreground">{integ.name}</h4>
                  <Badge variant="outline" className="text-xs">
                    {MODES.find(m => m.value === integ.mode)?.label || integ.mode}
                  </Badge>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-medium',
                    integ.active
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-muted text-muted-foreground'
                  )}>
                    {integ.active ? '● Ativo' : '○ Inativo'}
                  </span>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    integ.environment === 'sandbox'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30'
                  )}>
                    {integ.environment === 'sandbox' ? 'Sandbox' : 'Produção'}
                  </span>
                </div>
                {integ.api_url && (
                  <p className="text-xs text-muted-foreground truncate">{integ.api_url}</p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {integ.last_sync_at && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Última sync: {new Date(integ.last_sync_at).toLocaleString('pt-BR')}
                    </span>
                  )}
                  {integ.last_error_message && (
                    <span className="flex items-center gap-1 text-red-500">
                      <AlertTriangle className="w-3 h-3" />
                      {integ.last_error_message.substring(0, 60)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => testConnection(integ.id)} disabled={testing}>
                  {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
                  Testar
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => syncNow(integ.id)} disabled={syncing}>
                  {syncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Sincronizar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => startEdit(integ)}>
                  <Edit className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm" variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => { if (confirm('Remover esta integração?')) deleteIntegration.mutate(integ.id); }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Botão para adicionar nova */}
      {!showForm && (
        <Button onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Nova Integração
        </Button>
      )}

      {/* ── Formulário ──────────────────────────────────────────── */}
      {showForm && (
        <div className="bg-card border border-border/60 rounded-2xl p-6 space-y-5">
          <h3 className="font-semibold text-foreground">
            {editingId ? 'Editar Integração' : 'Nova Integração Promob'}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Nome da Integração *">
              <input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Ex: API Promob Leo Madeiras"
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </FormField>

            <FormField label="Modo de Integração">
              <select
                value={form.mode}
                onChange={e => setForm(p => ({ ...p, mode: e.target.value }))}
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </FormField>

            {form.mode !== 'manual_xml' && (
              <>
                <FormField label="URL da API / Endpoint">
                  <input
                    value={form.api_url}
                    onChange={e => setForm(p => ({ ...p, api_url: e.target.value }))}
                    placeholder="https://api.promob.com/orders"
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </FormField>

                <FormField label={editingId ? 'Novo Token (deixe em branco para manter)' : 'Token / Chave de API *'}>
                  <div className="relative">
                    <input
                      type="password"
                      value={form.token}
                      onChange={e => setForm(p => ({ ...p, token: e.target.value }))}
                      placeholder={editingId ? '••••••••• (mantém atual)' : 'Token seguro — armazenado no Vault'}
                      className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pr-10"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">🔒 Armazenado com segurança — nunca exibido após salvo</p>
                </FormField>

                <FormField label="Intervalo de Sincronização">
                  <select
                    value={form.sync_interval_minutes}
                    onChange={e => setForm(p => ({ ...p, sync_interval_minutes: Number(e.target.value) }))}
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {SYNC_INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                  </select>
                </FormField>

                <FormField label="Ambiente">
                  <select
                    value={form.environment}
                    onChange={e => setForm(p => ({ ...p, environment: e.target.value }))}
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="production">Produção</option>
                    <option value="sandbox">Sandbox / Homologação</option>
                  </select>
                </FormField>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="api-active"
              checked={form.active}
              onChange={e => setForm(p => ({ ...p, active: e.target.checked }))}
              className="w-4 h-4 rounded border-border"
            />
            <label htmlFor="api-active" className="text-sm text-foreground cursor-pointer">
              Integração ativa
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-border/60">
            <Button variant="outline" onClick={resetForm}>Cancelar</Button>
            <Button
              onClick={() => save.mutate(form)}
              disabled={
                save.isPending ||
                !form.name.trim() ||
                (form.mode !== 'manual_xml' && !form.api_url.trim()) ||
                (!editingId && form.mode !== 'manual_xml' && !form.token.trim())
              }
              className="gap-2 bg-[#2d9c4a] hover:bg-[#25813d] text-white"
            >
              {save.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {editingId ? 'Salvar Alterações' : 'Criar Integração'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

async function getFunctionErrorMessage(resp, fallback) {
  if (resp?.data?.error) return resp.data.error;
  if (!resp?.error) return fallback;

  const context = resp.error.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    } catch {
      // Mantém a mensagem padrão abaixo quando o corpo não é JSON.
    }
  }

  return resp.error.message || fallback;
}
