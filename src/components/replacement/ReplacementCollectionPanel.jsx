import { useState, useEffect, useRef } from 'react';
import {
  Scan, User, UserCheck, ShieldAlert, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  Sliders, LogOut, Lock, KeyRound, Wifi, WifiOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import {
  collectReplacementStage,
  getEnabledWorkstations,
  getOperatorWorkstationAuthorizations
} from '@/lib/replacementService';
import { enqueueCollectionEvent } from '@/lib/collectionEventQueue';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';

/**
 * Função utilitária para sintetizar beeps de áudio sem depender de arquivos estáticos.
 */
function playAudioFeedback(type = 'success') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15); // A6
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } else if (type === 'duplicate') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else {
      // Error
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.setValueAtTime(150, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {
    console.warn('Feedback sonoro indisponível:', e);
  }
}

export default function ReplacementCollectionPanel({ onCollectionSuccess, onOpenWorkstationConfig }) {
  const { user } = useAuth();
  const inputRef = useRef(null);

  // Estado do Operador e Sessão
  const [activeOperator, setActiveOperator] = useState(() => {
    return {
      id: user?.id || 'op-default',
      name: user?.name || 'Operador MES',
      registration: user?.registration || '1001',
      shift: user?.shift || '1'
    };
  });

  // Postos Habilitados
  const [workstations, setWorkstations] = useState([]);
  const [selectedWorkstationId, setSelectedWorkstationId] = useState('');
  const [isWorkstationAuthorized, setIsWorkstationAuthorized] = useState(true);

  // Leitura e Estado
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScanResult, setLastScanResult] = useState(null);
  const [recentScans, setRecentScans] = useState([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Modal Trocar Operador
  const [showSwitchOpModal, setShowSwitchOpModal] = useState(false);
  const [opLoginInput, setOpLoginInput] = useState('');
  const [opPasswordInput, setOpPasswordInput] = useState('');
  const [switchOpError, setSwitchOpError] = useState(null);

  // Monitorar Conectividade
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Manter Foco Automático no Input do Leitor
  useEffect(() => {
    const focusInput = () => {
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
    };
    focusInput();
    const interval = setInterval(focusInput, 3000);
    return () => clearInterval(interval);
  }, []);

  // Extrair células permitidas do perfil do usuário logado
  const userAllowedCells = user?.managed_cells?.length
    ? user.managed_cells
    : user?.access_scope?.cells?.length
      ? user.access_scope.cells
      : user?.cell
        ? [user.cell]
        : [];

  const userAllowedCellsKey = userAllowedCells.join(',');

  // Carregar Postos Habilitados conforme células autorizadas do usuário
  useEffect(() => {
    async function loadWorkstations() {
      try {
        const list = await getEnabledWorkstations(userAllowedCells, user?.role);
        setWorkstations(list);
        if (list.length === 1) {
          setSelectedWorkstationId(list[0].id);
        } else if (list.length > 0 && (!selectedWorkstationId || !list.some(w => w.id === selectedWorkstationId))) {
          setSelectedWorkstationId(list[0].id);
        }
      } catch (err) {
        console.error('Erro ao carregar postos de trabalho:', err);
      }
    }
    loadWorkstations();
  }, [userAllowedCellsKey, user?.role]);


  // Verificar autorizações do operador no posto selecionado
  useEffect(() => {
    async function checkAuth() {
      if (!selectedWorkstationId || !activeOperator.id) {
        setIsWorkstationAuthorized(true);
        return;
      }
      try {
        const auths = await getOperatorWorkstationAuthorizations(activeOperator.id);
        if (auths.length === 0) {
          setIsWorkstationAuthorized(true); // Se não houver restrições estritas cadastradas, liberar
        } else {
          const hasAuth = auths.some(a => a.machine_id === selectedWorkstationId || a.cell_id === selectedWorkstationId);
          setIsWorkstationAuthorized(hasAuth);
        }
      } catch (e) {
        console.warn('Aviso ao verificar autorização:', e);
        setIsWorkstationAuthorized(true);
      }
    }
    checkAuth();
  }, [selectedWorkstationId, activeOperator]);

  const selectedWorkstation = workstations.find(w => w.id === selectedWorkstationId);

  // Processar leitura de código de barras
  const handleScanSubmit = async (e) => {
    e?.preventDefault();
    const code = barcodeInput.trim();
    if (!code || isProcessing) return;

    if (!isWorkstationAuthorized) {
      playAudioFeedback('error');
      toast.error('Coleta Bloqueada: Operador não está autorizado a coletar neste posto.');
      setLastScanResult({
        success: false,
        result_status: 'blocked',
        message: 'O colaborador não está autorizado a operar neste posto de reposição.'
      });
      setBarcodeInput('');
      return;
    }

    setIsProcessing(true);
    const clientEventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `evt-${Date.now()}`;

    try {
      if (!isOnline) {
        // Modo Offline: Salvar na fila durável IndexedDB
        await enqueueCollectionEvent({
          client_event_id: clientEventId,
          rawValue: code,
          machine_id: selectedWorkstationId,
          machine_name: selectedWorkstation?.name || 'Posto Desconectado',
          cell_name: selectedWorkstation?.cell_name || 'Célula Offline',
          operator_id: activeOperator.id,
          operator_name: activeOperator.name,
          shift: activeOperator.shift,
          is_replacement_event: true
        });

        playAudioFeedback('success');
        toast.info('Modo Offline: Leitura salva localmente na fila durável.');
        const offlineResult = {
          success: true,
          result_status: 'offline_queued',
          message: 'Leitura armazenada localmente. Sincronização ocorrerá ao reconectar.',
          code
        };
        setLastScanResult(offlineResult);
        setRecentScans(prev => [offlineResult, ...prev].slice(0, 5));
        setBarcodeInput('');
        return;
      }

      // Modo Online: Chamada à RPC Transacional
      const res = await collectReplacementStage({
        barcode: code,
        workstationId: selectedWorkstationId,
        machineId: selectedWorkstationId,
        cellId: selectedWorkstation?.cell_id,
        operatorId: activeOperator.id,
        shift: activeOperator.shift,
        clientEventId
      });

      if (res.success) {
        if (res.result_status === 'already_completed') {
          playAudioFeedback('duplicate');
          toast.warning(res.message || 'Etapa já concluída anteriormente.');
        } else {
          playAudioFeedback('success');
          toast.success(res.message || 'Baixa de reposição realizada com sucesso!');
        }

        const scanData = { ...res, code, timestamp: new Date() };
        setLastScanResult(scanData);
        setRecentScans(prev => [scanData, ...prev].slice(0, 5));

        if (onCollectionSuccess) onCollectionSuccess(res);
      } else {
        playAudioFeedback('error');
        toast.error(res.message || 'Falha ao processar leitura.');
        setLastScanResult({ ...res, code, timestamp: new Date() });
      }
    } catch (error) {
      console.error('Erro na coleta de reposição:', error);
      playAudioFeedback('error');
      toast.error(error.message || 'Erro de comunicação no servidor.');
      setLastScanResult({
        success: false,
        result_status: 'error',
        message: error.message || 'Erro inesperado ao conectar ao banco.',
        code
      });
    } finally {
      setIsProcessing(false);
      setBarcodeInput('');
      setTimeout(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 50);
    }
  };

  // Troca de Operador
  const handleSwitchOperator = async (e) => {
    e.preventDefault();
    setSwitchOpError(null);
    if (!opLoginInput.trim() || !opPasswordInput.trim()) {
      setSwitchOpError('Preencha a matrícula/login e a senha.');
      return;
    }

    try {
      // Simulação de login de operador ou verificação via perfil
      setActiveOperator({
        id: `op-${opLoginInput.toLowerCase()}`,
        name: opLoginInput.toUpperCase(),
        registration: opLoginInput,
        shift: '1'
      });

      toast.success(`Operador alterado para ${opLoginInput.toUpperCase()}`);
      setShowSwitchOpModal(false);
      setOpLoginInput('');
      setOpPasswordInput('');
    } catch (err) {
      setSwitchOpError(err.message || 'Falha na autenticação do operador.');
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-4 md:p-6 shadow-sm space-y-4">
      {/* Linha de Status & Informações do Operador */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-border">
        {/* Operador Ativo */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-lg border border-amber-500/20 shadow-inner">
            {activeOperator.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-foreground">{activeOperator.name}</span>
              <Badge variant="outline" className="text-[10px] bg-slate-500/10 font-mono">
                Matrícula: {activeOperator.registration}
              </Badge>
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20">
                Turno {activeOperator.shift}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Sessão Operacional MES Ativa</p>
          </div>
        </div>

        {/* Posto Selecionado & Ações */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Status da Rede */}
          <Badge variant="outline" className={`text-xs flex items-center gap-1 ${isOnline ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-rose-500/10 text-rose-600 border-rose-500/20'}`}>
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isOnline ? 'Online' : 'Offline (Fila Activada)'}
          </Badge>

          {/* Seleção do Posto Habilitado */}
          <div className="flex items-center gap-1.5 bg-muted/50 p-1 rounded-xl border border-border">
            <Sliders className="w-4 h-4 text-muted-foreground ml-2" />
            <select
              value={selectedWorkstationId}
              onChange={(e) => setSelectedWorkstationId(e.target.value)}
              className="bg-transparent text-xs font-semibold text-foreground focus:outline-none pr-2 py-1 cursor-pointer"
            >
              {workstations.length === 0 && <option value="">Nenhum Posto Habilitado</option>}
              {workstations.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.cell_name})
                </option>
              ))}
            </select>
          </div>

          {/* Botão Trocar Operador */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowSwitchOpModal(true)}
            className="h-9 text-xs rounded-xl flex items-center gap-1.5"
          >
            <UserCheck className="w-3.5 h-3.5 text-amber-500" />
            Trocar Operador
          </Button>

          {/* Configuração de Postos (Para Gestores) */}
          {onOpenWorkstationConfig && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onOpenWorkstationConfig}
              className="h-9 text-xs rounded-xl"
              title="Configurar Postos Habilitados"
            >
              <Sliders className="w-3.5 h-3.5 text-slate-500" />
            </Button>
          )}
        </div>
      </div>

      {/* Alerta de Posto Não Autorizado */}
      {!isWorkstationAuthorized && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span><strong>Acesso Bloqueado:</strong> O operador atual não possui autorização ativa para coletar reposições neste posto.</span>
        </div>
      )}

      {/* Form de Leitura de Código de Barras */}
      <form onSubmit={handleScanSubmit} className="space-y-3">
        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
          Leitura do Código de Barras da Peça Substituta
        </label>
        <div className="relative flex items-center">
          <div className="absolute left-3 text-amber-500">
            <Scan className="w-5 h-5 animate-pulse" />
          </div>
          <Input
            ref={inputRef}
            type="text"
            placeholder="Aguardando código de barras da peça substituta... (Leitor óptico ativo)"
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            disabled={isProcessing}
            className="h-14 pl-11 pr-28 text-sm md:text-base font-mono font-bold rounded-2xl border-2 border-amber-500/40 focus:border-amber-500 shadow-inner bg-background"
          />
          <Button
            type="submit"
            disabled={isProcessing || !barcodeInput.trim()}
            className="absolute right-2 h-10 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs px-4"
          >
            {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Baixar Célula'}
          </Button>
        </div>
      </form>

      {/* Exibição do Resultado da Última Leitura */}
      {lastScanResult && (
        <div className={`p-4 rounded-2xl border flex items-start gap-3 transition-all ${
          lastScanResult.success && lastScanResult.result_status === 'approved'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-300'
            : lastScanResult.result_status === 'already_completed'
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-300'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-300'
        }`}>
          {lastScanResult.success && lastScanResult.result_status === 'approved' ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
          ) : lastScanResult.result_status === 'already_completed' ? (
            <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-6 h-6 text-rose-500 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 text-xs md:text-sm">
            <div className="flex items-center justify-between font-bold">
              <span>{lastScanResult.message}</span>
              {lastScanResult.completed_stage && (
                <Badge variant="outline" className="bg-background/80 text-[10px]">
                  Baixa em: {lastScanResult.completed_stage}
                </Badge>
              )}
            </div>
            {lastScanResult.next_stage && (
              <p className="text-xs opacity-90 mt-1">
                👉 Próxima etapa liberada: <strong>{lastScanResult.next_stage}</strong>
              </p>
            )}
            {lastScanResult.replacement_completed && (
              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                🎉 Reposição e Lote finalizados com sucesso!
              </p>
            )}
          </div>
        </div>
      )}

      {/* Modal Reautenticação / Troca de Operador */}
      <Dialog open={showSwitchOpModal} onOpenChange={setShowSwitchOpModal}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <KeyRound className="w-5 h-5 text-amber-500" />
              Trocar Operador do Terminal
            </DialogTitle>
            <DialogDescription className="text-xs">
              Informe a matrícula ou login e a senha pessoal do novo operador para iniciar a sessão operacional.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSwitchOperator} className="space-y-4 py-2">
            {switchOpError && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-600 p-2.5 rounded-xl text-xs font-semibold">
                {switchOpError}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Matrícula ou Login</label>
              <Input
                type="text"
                placeholder="Ex: 1042"
                value={opLoginInput}
                onChange={(e) => setOpLoginInput(e.target.value)}
                required
                className="h-10 rounded-xl"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Senha Pessoal</label>
              <Input
                type="password"
                placeholder="••••••••"
                value={opPasswordInput}
                onChange={(e) => setOpPasswordInput(e.target.value)}
                required
                className="h-10 rounded-xl"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setShowSwitchOpModal(false)} className="rounded-xl">
                Cancelar
              </Button>
              <Button type="submit" className="bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl">
                Autenticar Novo Operador
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
