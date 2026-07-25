import { useState, useEffect } from 'react';
import { Plus, Edit2, CheckCircle2, XCircle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { getDefectCatalog, saveDefectInCatalog, SIX_M_CATEGORIES } from '@/lib/qualityService';
import { toast } from 'sonner';

export default function QualityDefectCatalogTab({ userPermissions = {} }) {
  const [defects, setDefects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState(false);
  const [currentDefect, setCurrentDefect] = useState({
    code: '',
    name: '',
    description: '',
    category: 'Geral',
    six_m_category: 'Método',
    default_severity: 'medium',
    display_order: 0,
    active: true
  });

  const loadCatalog = async () => {
    try {
      setLoading(true);
      const data = await getDefectCatalog({ activeOnly: false });
      setDefects(data);
    } catch (error) {
      console.error('Erro ao carregar catálogo:', error);
      toast.error('Falha ao carregar catálogo de defeitos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  const handleOpenNew = () => {
    const nextNum = defects.length + 1;
    setCurrentDefect({
      code: `DEF-${String(nextNum).padStart(3, '0')}`,
      name: '',
      description: '',
      category: 'Geral',
      six_m_category: 'Método',
      default_severity: 'medium',
      display_order: nextNum,
      active: true
    });
    setEditModal(true);
  };

  const handleOpenEdit = (defect) => {
    setCurrentDefect({ ...defect });
    setEditModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!currentDefect.code || !currentDefect.name) {
      toast.error('Código e Nome do defeito são obrigatórios.');
      return;
    }

    try {
      await saveDefectInCatalog(currentDefect);
      toast.success('Defeito salvo com sucesso no catálogo!');
      setEditModal(false);
      loadCatalog();
    } catch (error) {
      console.error('Erro ao salvar defeito:', error);
      toast.error(error.message || 'Falha ao salvar defeito.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card border border-border/60 p-4 rounded-2xl shadow-sm">
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-500" />
            Catálogo Normalizado de Defeitos 6M
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Fonte única de verdade para os motivos de refugo, não conformidades e diagnósticos de Ishikawa.
          </p>
        </div>

        {userPermissions.manage_quality && (
          <Button
            type="button"
            onClick={handleOpenNew}
            className="h-9 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Novo Defeito
          </Button>
        )}
      </div>

      {loading ? (
        <div className="py-8 text-center text-xs text-muted-foreground">Carregando catálogo de defeitos...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {defects.map((def) => (
            <div key={def.id} className="bg-card border border-border/60 rounded-2xl p-3.5 space-y-2 shadow-sm hover:border-amber-500/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-extrabold text-xs text-foreground">{def.code}</span>
                    <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20 font-bold">
                      6M: {def.six_m_category}
                    </Badge>
                  </div>
                  <h4 className="font-bold text-sm text-foreground mt-1">{def.name}</h4>
                </div>

                {userPermissions.manage_quality && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenEdit(def)}
                    className="h-8 w-8 p-0 text-muted-foreground rounded-lg"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-border/40 text-muted-foreground">
                <span>Severidade Padrão: <strong className="text-foreground capitalize">{def.default_severity}</strong></span>
                <span className="flex items-center gap-1">
                  {def.active ? (
                    <span className="text-emerald-600 font-bold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Ativo</span>
                  ) : (
                    <span className="text-slate-400 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Inativo</span>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Cadastro / Edição */}
      <Dialog open={editModal} onOpenChange={setEditModal}>
        <DialogContent className="sm:max-w-[480px] rounded-2xl p-6 bg-card border border-border/80 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-extrabold flex items-center gap-2 text-amber-600">
              <ShieldAlert className="w-5 h-5" />
              {currentDefect.id ? 'Editar Defeito do Catálogo' : 'Cadastrar Novo Defeito'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Configure as propriedades e a categorização Ishikawa 6M do defeito.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="def-code" className="font-bold text-muted-foreground">Código *</Label>
                <Input
                  id="def-code"
                  value={currentDefect.code}
                  onChange={(e) => setCurrentDefect({ ...currentDefect, code: e.target.value })}
                  placeholder="DEF-001"
                  className="h-10 text-xs rounded-xl font-mono"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="def-sixm" className="font-bold text-muted-foreground">Categoria 6M *</Label>
                <select
                  id="def-sixm"
                  value={currentDefect.six_m_category}
                  onChange={(e) => setCurrentDefect({ ...currentDefect, six_m_category: e.target.value })}
                  className="w-full h-10 rounded-xl border border-input bg-background px-3 text-xs font-medium focus-visible:outline-none"
                >
                  {SIX_M_CATEGORIES.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="def-name" className="font-bold text-muted-foreground">Nome do Defeito *</Label>
              <Input
                id="def-name"
                value={currentDefect.name}
                onChange={(e) => setCurrentDefect({ ...currentDefect, name: e.target.value })}
                placeholder="Ex: MDF riscado na superfície"
                className="h-10 text-xs rounded-xl"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="def-sev" className="font-bold text-muted-foreground">Severidade Padrão</Label>
                <select
                  id="def-sev"
                  value={currentDefect.default_severity}
                  onChange={(e) => setCurrentDefect({ ...currentDefect, default_severity: e.target.value })}
                  className="w-full h-10 rounded-xl border border-input bg-background px-3 text-xs font-medium focus-visible:outline-none"
                >
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                  <option value="critical">Crítica</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="def-order" className="font-bold text-muted-foreground">Ordem de Exibição</Label>
                <Input
                  id="def-order"
                  type="number"
                  value={currentDefect.display_order}
                  onChange={(e) => setCurrentDefect({ ...currentDefect, display_order: parseInt(e.target.value) || 0 })}
                  className="h-10 text-xs rounded-xl"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditModal(false)}
                className="text-xs font-semibold rounded-xl"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl"
              >
                Salvar Defeito
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
