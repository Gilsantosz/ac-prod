import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCells } from '@/hooks/useCells';
import { format } from 'date-fns';
import { Loader2, Save, Clock, Factory } from 'lucide-react';

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

function getCurrentShift() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return '1º Turno';
  if (h >= 14 && h < 22) return '2º Turno';
  return '3º Turno';
}

function getCurrentHour() {
  return `${String(new Date().getHours()).padStart(2, '0')}:00`;
}

function getTodayStr() {
  return format(new Date(), 'yyyy-MM-dd');
}

export default function ManualQuickEntryForm({ user = {}, onSubmit = null, saving = false, onContextChange = null }) {
  const { activeCells } = useCells();
  
  // Estados do formulário
  const [cell, setCell] = useState(user?.cell || '');
  const [hour, setHour] = useState(getCurrentHour());
  const [produced, setProduced] = useState('0');
  const [scrap, setScrap] = useState('0');
  const [downtime, setDowntime] = useState('0');
  const [notes, setNotes] = useState('');
  const [duplicateAction, setDuplicateAction] = useState('sum'); // 'sum', 'replace', 'new'

  const userRole = user.role || 'operator';
  const canReplaceOrNew = userRole === 'admin' || userRole === 'manager';

  // Sincronizar célula do perfil
  useEffect(() => {
    if (user?.cell) {
      setCell(user.cell);
    }
  }, [user]);

  // Tick a cada 30 segundos para atualizar horário automático se o usuário não tiver alterado manualmente
  useEffect(() => {
    let hourEdited = false;
    const interval = setInterval(() => {
      if (!hourEdited) {
        setHour(getCurrentHour());
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Notificar pai sobre mudança de contexto
  useEffect(() => {
    if (onContextChange) {
      onContextChange({
        cell,
        hour,
        date: getTodayStr(),
        shift: getCurrentShift()
      });
    }
  }, [cell, hour, onContextChange]);

  const handleAdjustProduced = (val) => {
    const curr = parseInt(produced) || 0;
    setProduced(String(Math.max(0, curr + val)));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!onSubmit) return;

    onSubmit({
      date: getTodayStr(),
      shift: getCurrentShift(),
      cell,
      hour,
      produced: Number(produced) || 0,
      scrap: Number(scrap) || 0,
      downtime: Number(downtime) || 0,
      notes: notes.trim(),
      operator: user.name || user.email || 'Operador Manual',
      lot_code: 'SEM_LOTE',
      order_number: 'MANUAL',
      process_step: cell || 'APONTAMENTO_MANUAL',
      entry_mode: 'manual',
      source: 'manual_entry',
      _duplicateAction: duplicateAction
    });

    // Resetar campos produzidos e paradas, mantendo o contexto operacional
    setProduced('0');
    setScrap('0');
    setDowntime('0');
    setNotes('');
  };

  return (
    <Card className="border-border/60 shadow-sm bg-card">
      <CardContent className="p-5 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          
          {/* Célula e Hora */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="quick-cell" className="text-xs font-bold text-muted-foreground">Célula</Label>
              <select
                id="quick-cell"
                value={cell}
                onChange={(e) => setCell(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:ring-1 focus:ring-[#2d9c4a] focus:outline-none"
                required
              >
                <option value="">Selecione a célula</option>
                {activeCells.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="quick-hour" className="text-xs font-bold text-muted-foreground flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                Hora do Apontamento
              </Label>
              <select
                id="quick-hour"
                value={hour}
                onChange={(e) => setHour(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none"
                required
              >
                {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>

          {/* Campo Principal: Produzido com botões de atalho */}
          <div className="rounded-2xl border-2 border-[#2d9c4a]/50 bg-gradient-to-br from-[#76FB91]/8 via-[#76FB91]/3 to-transparent p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-2.5 shrink-0">
                <div className="w-10 h-10 rounded-lg bg-[#2d9c4a] flex items-center justify-center shadow-md shadow-emerald-700/25">
                  <Factory className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-foreground leading-tight">Produzido</h4>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Peças boas fabricadas na hora</p>
                </div>
              </div>

              {/* Controles de número */}
              <div className="flex-1 flex items-center gap-3">
                <input
                  type="number"
                  value={produced}
                  onChange={(e) => setProduced(e.target.value)}
                  placeholder="0"
                  required
                  min="0"
                  inputMode="numeric"
                  id="quick-produced"
                  className="w-full text-center text-4xl font-extrabold tracking-tight text-[#2d9c4a] placeholder:text-[#2d9c4a]/30 bg-background/80 border border-border rounded-xl py-3 focus:outline-none focus:ring-2 focus:ring-[#2d9c4a]/35"
                />
              </div>
            </div>

            {/* Atalhos Rápidos */}
            <div className="flex flex-wrap gap-1.5 justify-center mt-3.5 pt-3 border-t border-border/50">
              {[-10, -5, -1, 1, 5, 10].map(val => (
                <Button
                  key={val}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleAdjustProduced(val)}
                  className="text-xs font-bold w-12 h-8"
                >
                  {val > 0 ? `+${val}` : val}
                </Button>
              ))}
            </div>
          </div>

          {/* Refugo e Paradas */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="quick-scrap" className="text-xs font-bold text-muted-foreground">Refugos (Defeitos)</Label>
              <Input
                id="quick-scrap"
                type="number"
                min="0"
                value={scrap}
                onChange={(e) => setScrap(e.target.value)}
                placeholder="0"
                className="h-10 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-downtime" className="text-xs font-bold text-muted-foreground">Parada (minutos)</Label>
              <Input
                id="quick-downtime"
                type="number"
                min="0"
                value={downtime}
                onChange={(e) => setDowntime(e.target.value)}
                placeholder="0"
                className="h-10 text-sm"
              />
            </div>
          </div>

          {/* Observações */}
          <div className="space-y-1.5">
            <Label htmlFor="quick-notes" className="text-xs font-bold text-muted-foreground">Observações / Motivos</Label>
            <Textarea
              id="quick-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Descreva o andamento ou motivos de paradas/refugos..."
              rows={2}
              className="text-sm resize-none rounded-md"
            />
          </div>

          {/* Modo de Lançamento se houver duplicidade pré-definido pelo perfil */}
          {canReplaceOrNew && (
            <div className="space-y-1.5 border-t border-border/60 pt-3">
              <Label htmlFor="quick-dup-action" className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Opção para Conflitos (Se duplicado)</Label>
              <select
                id="quick-dup-action"
                value={duplicateAction}
                onChange={(e) => setDuplicateAction(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs focus:outline-none"
              >
                <option value="sum">Somar à quantidade existente</option>
                <option value="replace">Substituir valor anterior</option>
                <option value="new">Lançar como novo registro separado</option>
              </select>
            </div>
          )}

          {/* Botão Salvar */}
          <div className="pt-2">
            <Button 
              type="submit" 
              disabled={saving || !cell} 
              className="w-full h-11 bg-[#2d9c4a] hover:bg-[#237d3a] text-white font-bold gap-2 text-sm shadow-md transition-all rounded-xl"
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              Registrar Produção
            </Button>
          </div>

        </form>
      </CardContent>
    </Card>
  );
}
