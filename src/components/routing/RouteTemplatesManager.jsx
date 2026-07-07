import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/lib/localDb';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2, Plus, ArrowUp, ArrowDown, Trash2, Edit3, X, GitCommit, ListOrdered, CheckCircle2, AlertCircle } from 'lucide-react';

export default function RouteTemplatesManager() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    product_type: 'standard',
    material: '',
    application: '',
    allow_skip: false,
    requires_final_inspection: false,
    requires_individual_packaging: false,
    active: true
  });

  // Queries
  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ['routeTemplates'],
    queryFn: () => base44.entities.RouteTemplate.list('-created_at'),
    initialData: [],
  });

  const { data: routingSteps = [] } = useQuery({
    queryKey: ['routingSteps'],
    queryFn: () => base44.entities.RoutingStep.list('sequence'),
    initialData: [],
  });

  const selectedTemplate = templates.find((t) => t.id === selectedId);

  const { data: templateSteps = [], isLoading: loadingTemplateSteps } = useQuery({
    queryKey: ['routeTemplateSteps', selectedId],
    queryFn: () =>
      selectedId
        ? base44.entities.RouteTemplateStep.filter({ route_template_id: selectedId }, 'sequence')
        : Promise.resolve([]),
    enabled: !!selectedId,
    initialData: [],
  });

  // Mutations - Template
  const saveTemplate = useMutation({
    mutationFn: (payload) =>
      editingTemplate
        ? base44.entities.RouteTemplate.update(editingTemplate.id, payload)
        : base44.entities.RouteTemplate.create(payload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['routeTemplates'] });
      toast.success(editingTemplate ? 'Roteiro atualizado!' : 'Roteiro criado com sucesso!');
      if (!editingTemplate && data) {
        setSelectedId(data.id);
      }
      setShowForm(false);
      setEditingTemplate(null);
    },
    onError: (e) => toast.error(e?.message || 'Erro ao salvar roteiro'),
  });

  const deleteTemplate = useMutation({
    mutationFn: (id) => base44.entities.RouteTemplate.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routeTemplates'] });
      setSelectedId(null);
      toast.success('Roteiro excluído.');
    },
    onError: () => toast.error('Falha ao excluir roteiro'),
  });

  // Mutations - Steps
  const addStep = useMutation({
    mutationFn: (payload) => base44.entities.RouteTemplateStep.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routeTemplateSteps', selectedId] });
      toast.success('Etapa adicionada ao roteiro!');
    },
    onError: (e) => toast.error(e?.message || 'Erro ao adicionar etapa'),
  });

  const removeStep = useMutation({
    mutationFn: (id) => base44.entities.RouteTemplateStep.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routeTemplateSteps', selectedId] });
      toast.success('Etapa removida do roteiro.');
    },
  });

  const updateStepSequence = useMutation({
    mutationFn: async ({ stepId, sequence }) => {
      return base44.entities.RouteTemplateStep.update(stepId, { sequence });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routeTemplateSteps', selectedId] });
    },
  });

  const handleEditTemplate = (t) => {
    setEditingTemplate(t);
    setForm({
      name: t.name,
      description: t.description || '',
      product_type: t.product_type || 'standard',
      material: t.material || '',
      application: t.application || '',
      allow_skip: !!t.allow_skip,
      requires_final_inspection: !!t.requires_final_inspection,
      requires_individual_packaging: !!t.requires_individual_packaging,
      active: t.active !== false
    });
    setShowForm(true);
  };

  const handleCreateTemplate = () => {
    setEditingTemplate(null);
    setForm({
      name: '',
      description: '',
      product_type: 'standard',
      material: '',
      application: '',
      allow_skip: false,
      requires_final_inspection: false,
      requires_individual_packaging: false,
      active: true
    });
    setShowForm(true);
  };

  const handleAddStep = (stepCode) => {
    if (!selectedId) return;

    // Verificar se já existe essa etapa
    if (templateSteps.some((ts) => ts.step_code === stepCode)) {
      toast.warning('Esta etapa já faz parte do roteiro!');
      return;
    }

    const nextSequence = templateSteps.length + 1;
    addStep.mutate({
      route_template_id: selectedId,
      step_code: stepCode,
      sequence: nextSequence,
      required: true,
      can_skip: false,
    });
  };

  const handleMove = async (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === templateSteps.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const current = templateSteps[index];
    const target = templateSteps[targetIndex];

    await updateStepSequence.mutateAsync({ stepId: current.id, sequence: target.sequence });
    await updateStepSequence.mutateAsync({ stepId: target.id, sequence: current.sequence });
    toast.success('Sequência atualizada!');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Painel Esquerdo: Listagem de Roteiros */}
      <div className="lg:col-span-1 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-lg text-foreground flex items-center gap-2">
            <GitCommit className="w-5 h-5 text-primary" />
            Roteiros de Produção
          </h3>
          {!showForm && (
            <Button size="sm" onClick={handleCreateTemplate} className="gap-1">
              <Plus className="w-4 h-4" /> Novo
            </Button>
          )}
        </div>

        {showForm && (
          <Card className="p-4 border-border/60 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-sm text-foreground">
                {editingTemplate ? 'Editar Roteiro' : 'Novo Roteiro'}
              </h4>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowForm(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveTemplate.mutate(form);
              }}
              className="space-y-3"
            >
              <div className="space-y-1">
                <Label className="text-xs">Nome do Roteiro</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Roteiro Padrão MDF"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Descrição</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Ex: Corte → Bordo → Separação"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo de Produto</Label>
                <Select
                  value={form.product_type}
                  onValueChange={(val) => setForm((f) => ({ ...f, product_type: val }))}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Padrão</SelectItem>
                    <SelectItem value="edge">Bordo</SelectItem>
                    <SelectItem value="cnc">Usinagem</SelectItem>
                    <SelectItem value="custom_refined">Refinado Sob Medida</SelectItem>
                    <SelectItem value="pivot_door">Porta Pivotante</SelectItem>
                    <SelectItem value="sorrentos">Sorrentos</SelectItem>
                    <SelectItem value="special_joinery">Marcenaria Especial</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Material</Label>
                  <Input
                    value={form.material}
                    onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))}
                    placeholder="Ex: MDF 18mm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Aplicação</Label>
                  <Input
                    value={form.application}
                    onChange={(e) => setForm((f) => ({ ...f, application: e.target.value }))}
                    placeholder="Ex: Portas"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <Label className="text-xs cursor-pointer" htmlFor="allow_skip">Permitir pular etapa?</Label>
                  <Switch
                    id="allow_skip"
                    checked={form.allow_skip}
                    onCheckedChange={(val) => setForm((f) => ({ ...f, allow_skip: val }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs cursor-pointer" htmlFor="requires_final_inspection">Exigir conferência final?</Label>
                  <Switch
                    id="requires_final_inspection"
                    checked={form.requires_final_inspection}
                    onCheckedChange={(val) => setForm((f) => ({ ...f, requires_final_inspection: val }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs cursor-pointer" htmlFor="requires_individual_packaging">Exigir embalagem individual?</Label>
                  <Switch
                    id="requires_individual_packaging"
                    checked={form.requires_individual_packaging}
                    onCheckedChange={(val) => setForm((f) => ({ ...f, requires_individual_packaging: val }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs cursor-pointer text-emerald-600 font-semibold" htmlFor="active">Roteiro Ativo?</Label>
                  <Switch
                    id="active"
                    checked={form.active}
                    onCheckedChange={(val) => setForm((f) => ({ ...f, active: val }))}
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button size="sm" variant="outline" type="button" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
                <Button size="sm" type="submit" disabled={saveTemplate.isPending}>
                  {saveTemplate.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                  Salvar
                </Button>
              </div>
            </form>
          </Card>
        )}

        {loadingTemplates ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : templates.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground border-dashed border-border/80">
            Nenhum roteiro cadastrado.
          </Card>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <Card
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`p-3.5 border cursor-pointer hover:border-primary/40 transition-colors shadow-sm ${
                  selectedId === t.id ? 'border-primary bg-primary/5' : 'border-border/60'
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground text-sm truncate">{t.name}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{t.description || 'Sem descrição'}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {t.material && <span className="text-[9px] bg-secondary text-secondary-foreground px-1 rounded">{t.material}</span>}
                      {t.allow_skip && <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1 rounded">Pula etapa</span>}
                      {t.requires_final_inspection && <span className="text-[9px] bg-blue-500/10 text-blue-600 px-1 rounded font-medium">Insp. Final</span>}
                      {t.requires_individual_packaging && <span className="text-[9px] bg-purple-500/10 text-purple-600 px-1 rounded font-medium">Embalagem</span>}
                      {t.active === false && <span className="text-[9px] bg-destructive/10 text-destructive px-1 rounded font-bold">Inativo</span>}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0 capitalize">
                    {t.product_type}
                  </Badge>
                </div>
                <div className="flex justify-end gap-2 border-t border-border/40 pt-2 mt-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditTemplate(t);
                    }}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Deseja excluir este roteiro de produção permanentemente?')) {
                        deleteTemplate.mutate(t.id);
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Painel Direito: Configuração das Etapas */}
      <div className="lg:col-span-2">
        {selectedTemplate ? (
          <Card className="p-6 border-border/60 shadow-sm space-y-6">
            <div className="border-b border-border/40 pb-4">
              <div className="flex justify-between items-start flex-wrap gap-4">
                <div className="space-y-1">
                  <h3 className="font-semibold text-xl text-foreground">{selectedTemplate.name}</h3>
                  <p className="text-sm text-muted-foreground">{selectedTemplate.description || 'Sem descrição'}</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Badge variant="secondary" className="capitalize text-[10px]">{selectedTemplate.product_type}</Badge>
                    {selectedTemplate.material && <Badge variant="outline" className="text-[10px]">Material: {selectedTemplate.material}</Badge>}
                    {selectedTemplate.application && <Badge variant="outline" className="text-[10px]">Aplicação: {selectedTemplate.application}</Badge>}
                    {selectedTemplate.allow_skip && <Badge variant="outline" className="text-[10px] border-amber-500/20 text-amber-600 bg-amber-500/5">Permite Pular Etapa</Badge>}
                    {selectedTemplate.requires_final_inspection && <Badge variant="outline" className="text-[10px] border-blue-500/20 text-blue-600 bg-blue-500/5">Exige Insp. Final</Badge>}
                    {selectedTemplate.requires_individual_packaging && <Badge variant="outline" className="text-[10px] border-purple-500/20 text-purple-600 bg-purple-500/5">Embalagem Indiv.</Badge>}
                    {selectedTemplate.active === false && <Badge variant="destructive" className="text-[10px]">Inativo</Badge>}
                  </div>
                </div>
              </div>
            </div>

            {/* Listagem de Etapas Configuradas */}
            <div className="space-y-4">
              <h4 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                <ListOrdered className="w-4 h-4 text-primary" />
                Fluxo de Etapas Produtivas
              </h4>

              {loadingTemplateSteps ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : templateSteps.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground border border-dashed border-border rounded-xl">
                  Nenhuma etapa configurada para este roteiro. Selecione as etapas abaixo para construir o fluxo.
                </div>
              ) : (
                <div className="space-y-2">
                  {templateSteps.map((ts, index) => {
                    const stepName = routingSteps.find((s) => s.code === ts.step_code)?.name || ts.step_code;
                    return (
                      <div
                        key={ts.id}
                        className="flex items-center justify-between p-3 rounded-xl border border-border/60 bg-secondary/20 hover:border-border transition-colors gap-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                            {index + 1}
                          </span>
                          <span className="font-medium text-sm text-foreground truncate">{stepName}</span>
                          {ts.required ? (
                            <Badge variant="outline" className="text-[10px] bg-emerald-500/5 text-emerald-600 border-emerald-500/20 py-0 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Obrigatória
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] bg-amber-500/5 text-amber-600 border-amber-500/20 py-0 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> Opcional
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={index === 0}
                            onClick={() => handleMove(index, 'up')}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={index === templateSteps.length - 1}
                            onClick={() => handleMove(index, 'down')}
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => removeStep.mutate(ts.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Adicionar Etapas */}
            <div className="border-t border-border/40 pt-4 space-y-3">
              <h4 className="font-semibold text-sm text-foreground">Adicionar Etapa ao Roteiro</h4>
              <div className="flex flex-wrap gap-2">
                {routingSteps
                  .filter((rs) => rs.code !== 'imported' && rs.code !== 'completed' && rs.code !== 'released')
                  .map((rs) => {
                    const exists = templateSteps.some((ts) => ts.step_code === rs.code);
                    return (
                      <Button
                        key={rs.id}
                        size="sm"
                        variant={exists ? 'secondary' : 'outline'}
                        className="h-8 text-xs gap-1"
                        disabled={exists}
                        onClick={() => handleAddStep(rs.code)}
                      >
                        <Plus className="w-3 h-3" />
                        {rs.name}
                      </Button>
                    );
                  })}
              </div>
            </div>
          </Card>
        ) : (
          <div className="h-full flex items-center justify-center p-12 text-center text-muted-foreground border border-dashed border-border/80 rounded-2xl">
            Selecione ou crie um roteiro de produção para configurar seu fluxo de etapas.
          </div>
        )}
      </div>
    </div>
  );
}
