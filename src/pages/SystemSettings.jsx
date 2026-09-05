import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, Clock3, Layers, Loader2, Plus, RefreshCw, Save, Settings, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { SYSTEM_ROLE_OPTIONS } from '@/lib/roleProfiles';
import { loadSystemSettings, saveSystemSettings } from '@/lib/systemSettingsService';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const PANEL_CLASS = 'hover:translate-y-0';

function minutesValue(value, label, optional = false) {
  if (optional && (value === '' || value == null)) return null;
  const number = value === '' || value == null ? NaN : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 1440) {
    throw new Error(`${label}: informe um número inteiro de 1 a 1.440 minutos.`);
  }
  return number;
}

function prepareSettings(draft) {
  const defaultTimeout = minutesValue(draft.default_timeout_minutes, 'Tempo padrão');
  const warning = draft.warning_seconds === '' ? NaN : Number(draft.warning_seconds);
  if (!Number.isInteger(warning) || warning < 0 || warning > 300) {
    throw new Error('Aviso antes do logout: informe um número inteiro de 0 a 300 segundos.');
  }
  const prepareRules = (rules, label) => Object.fromEntries(
    Object.entries(rules || {})
      .map(([key, value]) => [key, minutesValue(value, label, true)])
      .filter(([, value]) => value !== null),
  );
  const assigned = new Set();
  const names = new Set();
  const sectors = (draft.sectors || []).map((sector, index) => {
    const name = sector.name.trim();
    if (!name) throw new Error(`Informe o nome do setor ${index + 1}.`);
    if (names.has(name.toLocaleLowerCase('pt-BR'))) throw new Error('Use um nome diferente para cada setor.');
    names.add(name.toLocaleLowerCase('pt-BR'));
    sector.cell_ids.forEach((id) => {
      if (assigned.has(id)) throw new Error('Cada célula pode pertencer a somente um setor.');
      assigned.add(id);
    });
    return { ...sector, name, timeout_minutes: minutesValue(sector.timeout_minutes, `Setor ${name}`, true) };
  });
  return {
    ...draft,
    default_timeout_minutes: defaultTimeout,
    warning_seconds: warning,
    role_timeouts: prepareRules(draft.role_timeouts, 'Tempo por nível de acesso'),
    cell_timeouts: prepareRules(draft.cell_timeouts, 'Tempo por célula'),
    sectors,
  };
}

function TimeoutField({ id, label, value, onChange, optional = true, hint }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <Input
          id={id}
          type="number"
          min="1"
          max="1440"
          step="1"
          inputMode="numeric"
          required={!optional}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          placeholder={optional ? 'Herdar' : undefined}
          className="max-w-40"
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <span className="text-sm text-muted-foreground">minutos</span>
      </div>
      {hint && <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

function AdminSettings() {
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const mounted = useRef(false);

  // The editable snapshot changes only on initial load, explicit reload, or save.
  // Session-policy refreshes elsewhere must never overwrite unsaved admin edits.
  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const settings = await loadSystemSettings({ force: true });
      if (mounted.current) {
        setDraft(settings);
        setDirty(false);
      }
    } catch (loadError) {
      if (mounted.current) setError(loadError?.message || 'Não foi possível carregar as configurações. Tente novamente.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    reload();
    return () => { mounted.current = false; };
  }, [reload]);

  const edit = (change) => {
    setDraft((current) => ({ ...current, ...(typeof change === 'function' ? change(current) : change) }));
    setDirty(true);
    setSuccess('');
    setError('');
  };

  const updateRule = (field, key, value) => edit((current) => ({
    [field]: { ...current[field], [key]: value },
  }));

  const updateSector = (id, change) => edit((current) => ({
    sectors: current.sectors.map((sector) => sector.id === id ? { ...sector, ...change } : sector),
  }));

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    let payload;
    try {
      payload = prepareSettings(draft);
    } catch (validationError) {
      setError(validationError.message);
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSystemSettings(payload);
      if (mounted.current) {
        setDraft(saved);
        setDirty(false);
        setSuccess('Configurações salvas. As telas conectadas recebem as novas regras em até 60 segundos.');
      }
    } catch (saveError) {
      if (mounted.current) {
        const conflict = saveError?.code === '40001' || /conflict|conflito|versão/i.test(saveError?.message || '');
        setError(conflict
          ? 'Outro administrador alterou estas configurações. Sua edição foi preservada; anote os ajustes, descarte e recarregue para usar a versão atual antes de salvar.'
          : saveError?.message || 'Não foi possível salvar. Suas alterações continuam disponíveis nesta tela.');
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const cells = draft?.cell_catalog || [];
  const catalogIds = new Set(cells.map((cell) => cell.id));
  const missingCellIds = new Set([
    ...Object.keys(draft?.cell_timeouts || {}),
    ...(draft?.sectors || []).flatMap((sector) => sector.cell_ids),
  ].filter((id) => !catalogIds.has(id)));

  const removeMissingCells = () => edit((current) => ({
    cell_timeouts: Object.fromEntries(Object.entries(current.cell_timeouts || {}).filter(([id]) => !missingCellIds.has(id))),
    sectors: current.sectors.map((sector) => ({ ...sector, cell_ids: sector.cell_ids.filter((id) => !missingCellIds.has(id)) })),
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Configurações" subtitle="Administração do sistema" icon={Settings} />

      {error && (
        <div role="alert" className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}
      {success && <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">{success}</p>}

      {loading ? (
        <div role="status" className="flex items-center justify-center gap-3 py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Carregando configurações…</div>
      ) : !draft ? (
        <Button variant="outline" onClick={reload}><RefreshCw className="mr-2 h-4 w-4" />Tentar novamente</Button>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">Tempo de tela e novo login</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">Defina quanto tempo uma tela pode ficar sem uso. Ao atingir esse tempo, o sistema encerra a sessão neste dispositivo e solicita o login novamente.</p>
                <p className="text-sm leading-relaxed text-muted-foreground">Digitação, cliques, toques e leituras do coletor contam como atividade. Atualizações automáticas dos dados não reiniciam o tempo.</p>
                <p className="text-sm"><strong>Prioridade das regras:</strong> célula → nível de acesso → setor → padrão. Campos em branco herdam a próxima regra.</p>
              </div>
            </div>
          </div>

          {missingCellIds.size > 0 && (
            <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm">Há referências a {missingCellIds.size} célula(s) que não estão mais no cadastro. Remova essas referências das regras de tempo e dos setores antes de salvar.</p>
              <Button type="button" variant="outline" disabled={saving} onClick={removeMissingCells}>Remover referências a células excluídas</Button>
            </div>
          )}

          <fieldset disabled={saving} className="min-w-0">
            <Tabs defaultValue="general">
              <TabsList aria-label="Tipos de configuração" className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-4">
                <TabsTrigger value="general" className="py-2">Geral</TabsTrigger>
                <TabsTrigger value="roles" className="py-2">Por acesso</TabsTrigger>
                <TabsTrigger value="cells" className="py-2">Por célula</TabsTrigger>
                <TabsTrigger value="sectors" className="py-2">Por setor</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="mt-5 space-y-5">
                <Card className={PANEL_CLASS}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" />Configuração padrão</CardTitle>
                    <CardDescription>Vale para todas as telas sem uma regra específica.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-6 sm:grid-cols-2">
                    <TimeoutField id="default-timeout" label="Tempo sem atividade" value={draft.default_timeout_minutes} onChange={(value) => edit({ default_timeout_minutes: value })} optional={false} hint="De 1 a 1.440 minutos (24 horas)." />
                    <div className="space-y-2">
                      <Label htmlFor="warning-seconds">Aviso antes do logout</Label>
                      <div className="flex items-center gap-3">
                        <Input id="warning-seconds" type="number" inputMode="numeric" min="0" max="300" step="1" value={draft.warning_seconds} onChange={(event) => edit({ warning_seconds: event.target.value })} className="max-w-40" aria-describedby="warning-hint" />
                        <span className="text-sm text-muted-foreground">segundos</span>
                      </div>
                      <p id="warning-hint" className="text-xs leading-relaxed text-muted-foreground">De 0 a 300 segundos; use 0 para desativar o aviso. A antecedência é limitada pelo tempo de inatividade da tela.</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className={PANEL_CLASS}>
                  <CardHeader><CardTitle>Outras configurações básicas</CardTitle><CardDescription>Acesse os cadastros usados em todo o sistema.</CardDescription></CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-3">
                    {[
                      { to: '/celulas-metas', label: 'Células, máquinas e metas' },
                      { to: '/usuarios', label: 'Usuários e permissões' },
                      { to: '/operadores', label: 'Operadores e turnos' },
                    ].map((link) => (
                      <Button key={link.to} asChild variant="outline" className="h-auto justify-between gap-2 whitespace-normal py-3 text-left"><Link to={link.to}>{link.label}<ArrowUpRight className="h-4 w-4 shrink-0" /></Link></Button>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="roles" className="mt-5">
                <Card className={PANEL_CLASS}>
                  <CardHeader><CardTitle>Tempo por nível de acesso</CardTitle><CardDescription>Uma regra da célula tem prioridade. Em branco, será usado o setor ou o padrão.</CardDescription></CardHeader>
                  <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {SYSTEM_ROLE_OPTIONS.map((role) => <TimeoutField key={role.value} id={`role-${role.value}`} label={role.label} value={draft.role_timeouts?.[role.value]} onChange={(value) => updateRule('role_timeouts', role.value, value)} />)}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="cells" className="mt-5">
                <Card className={PANEL_CLASS}>
                  <CardHeader><CardTitle>Tempo por célula de produção</CardTitle><CardDescription>Aplica-se à célula em uso na tela. Em branco, será usado o nível de acesso, o setor ou o padrão.</CardDescription></CardHeader>
                  <CardContent>
                    {cells.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{cells.map((cell) => (
                      <TimeoutField key={cell.id} id={`cell-${cell.id}`} label={`${cell.name}${cell.active === false ? ' (inativa)' : ''}`} value={draft.cell_timeouts?.[cell.id]} onChange={(value) => updateRule('cell_timeouts', cell.id, value)} />
                    ))}</div> : <p className="text-sm text-muted-foreground">Nenhuma célula cadastrada. Cadastre as células em Células, Máquinas e Metas para definir regras individuais.</p>}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="sectors" className="mt-5 space-y-4">
                <div className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-start">
                  <div className="space-y-2">
                    <h3 className="font-semibold">Setores para o tempo de tela</h3>
                    <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Agrupe células que devem compartilhar uma regra, por exemplo LSM e CS. Cada célula pode estar em apenas um setor. Este agrupamento configura o tempo de tela e não altera as permissões de acesso aos dados.</p>
                  </div>
                  <Button type="button" variant="outline" className="shrink-0" onClick={() => edit((current) => ({ sectors: [...(current.sectors || []), { id: crypto.randomUUID(), name: '', cell_ids: [], timeout_minutes: null }] }))}><Plus className="mr-2 h-4 w-4" />Adicionar setor</Button>
                </div>
                {draft.sectors?.length ? draft.sectors.map((sector, index) => (
                  <Card key={sector.id} className={PANEL_CLASS}>
                    <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                      <CardTitle className="flex items-center gap-2"><Layers className="h-5 w-5" />{sector.name || `Novo setor ${index + 1}`}</CardTitle>
                      <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" aria-label={`Remover setor ${sector.name || index + 1}`} onClick={() => edit((current) => ({ sectors: current.sectors.filter((item) => item.id !== sector.id) }))}><Trash2 className="mr-2 h-4 w-4" />Remover</Button>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="grid items-start gap-6 sm:grid-cols-2">
                        <div className="space-y-2"><Label htmlFor={`sector-name-${sector.id}`}>Nome do setor {index + 1}</Label><Input id={`sector-name-${sector.id}`} value={sector.name} maxLength={80} placeholder="Ex.: LSM" onChange={(event) => updateSector(sector.id, { name: event.target.value })} /></div>
                        <TimeoutField id={`sector-timeout-${sector.id}`} label={`Tempo do setor ${index + 1}`} value={sector.timeout_minutes} onChange={(value) => updateSector(sector.id, { timeout_minutes: value })} hint="Em branco, usa o padrão. Regras da célula e do nível de acesso têm prioridade." />
                      </div>
                      <fieldset className="space-y-3">
                        <legend className="text-sm font-medium">Células do setor {sector.name || index + 1}</legend>
                        {cells.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{cells.map((cell) => {
                          const assignedElsewhere = draft.sectors.find((other) => other.id !== sector.id && other.cell_ids.includes(cell.id));
                          return (
                            <label key={cell.id} className={`flex items-start gap-2 rounded-lg border border-border p-3 text-sm ${assignedElsewhere ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer'}`}>
                              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={sector.cell_ids.includes(cell.id)} disabled={!!assignedElsewhere || saving} onChange={(event) => updateSector(sector.id, { cell_ids: event.target.checked ? [...sector.cell_ids, cell.id] : sector.cell_ids.filter((id) => id !== cell.id) })} />
                              <span>{cell.name}{cell.active === false ? ' (inativa)' : ''}{assignedElsewhere && <span className="block text-xs">Já pertence a {assignedElsewhere.name || 'outro setor'}</span>}</span>
                            </label>
                          );
                        })}</div> : <p className="text-sm text-muted-foreground">Cadastre células para associá-las a este setor.</p>}
                      </fieldset>
                    </CardContent>
                  </Card>
                )) : <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhum setor configurado. Adicione um setor para agrupar suas células.</p>}
              </TabsContent>
            </Tabs>
          </fieldset>

          <div className="sticky bottom-3 flex flex-col gap-3 rounded-2xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{dirty ? 'Há alterações ainda não salvas.' : 'As regras salvas valem para todos os dispositivos conectados.'}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={reload} disabled={saving}><RefreshCw className="mr-2 h-4 w-4" />{dirty ? 'Descartar e recarregar' : 'Recarregar'}</Button>
              <Button type="submit" disabled={!dirty || saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{saving ? 'Salvando…' : 'Salvar configurações'}</Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

export default function SystemSettings() {
  const { user, isLoadingAuth } = useAuth();
  if (isLoadingAuth) return <p role="status" className="p-8 text-muted-foreground">Verificando acesso…</p>;
  if (user?.role !== 'admin') {
    return <div role="alert" className="mx-auto max-w-xl space-y-3 p-8"><ShieldCheck className="h-8 w-8 text-muted-foreground" /><h1 className="text-xl font-semibold">Acesso restrito</h1><p className="text-sm text-muted-foreground">Somente administradores podem consultar e alterar as configurações do sistema.</p></div>;
  }
  return <AdminSettings />;
}
