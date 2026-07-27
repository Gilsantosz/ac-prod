import { useState, useMemo } from 'react';
import { 
  LogIn, 
  User, 
  Lock, 
  ShieldCheck, 
  ShieldAlert, 
  Shield, 
  ScanLine, 
  Barcode, 
  QrCode, 
  Radio, 
  Lightbulb, 
  ClipboardList, 
  Wifi, 
  Users, 
  Info, 
  RotateCcw,
  BadgeCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOperatorSession } from '@/hooks/useOperatorSession';

/**
 * OperationalLoginGate
 * 
 * Implementa o novo layout de alta fidelidade para a Estação de Controle Operacional
 * (Coleta / Bipagem e Marcenaria), com painel de orientações visuais, 3 formas de identificação,
 * formulário seguro e rodapé informativo de sincronização.
 */
export default function OperationalLoginGate({ 
  children,
  pageTitle = "Coleta / Bipagem",
  pageSubtitle = "ESTAÇÃO DE CONTROLE OPERACIONAL",
  pageDescription = "Identificação do operador para início do turno de produção.",
  icon: IconComponent = ScanLine
}) {
  const { isLoggedIn, loading, error, login } = useOperatorSession();
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');
  const [isFocused, setIsFocused] = useState(null);

  // Formata o horário atual de sincronização no padrão: "Hoje, HH:mm"
  const syncTimeText = useMemo(() => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `Hoje, ${hours}:${minutes}`;
  }, []);

  if (isLoggedIn) return children;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login(name, registration);
    } catch (_) {
      // Erro é gerenciado pelo hook e exibido no formulário
    }
  };

  const PageIcon = IconComponent || ScanLine;

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-2 sm:p-4 animate-in fade-in duration-300">
      
      {/* 1. Cabeçalho Superior da Estação */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/40 backdrop-blur-md p-4 sm:px-6 rounded-2xl border border-border/60 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm">
            <PageIcon className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground">
              {pageSubtitle}
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              {pageTitle}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5 font-medium">
              {pageDescription}
            </p>
          </div>
        </div>

        {/* Badge da Estação Online */}
        <div className="flex items-center gap-3 self-start sm:self-auto rounded-2xl border border-border/80 bg-card/80 px-4 py-2.5 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-foreground">Estação online</span>
          </div>
          <div className="h-4 w-px bg-border/60" />
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-medium">
            <span>Sistema sincronizado</span>
            <Wifi className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>
      </div>

      {/* 2. Grid Principal com 2 Painéis (Guias à Esquerda, Formulário à Direita) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Painel Esquerdo: Instruções e Métodos de Leitura */}
        <div className="lg:col-span-5 rounded-3xl border border-border/80 bg-card/70 backdrop-blur-xl p-6 sm:p-8 shadow-lg shadow-foreground/5 flex flex-col justify-between space-y-6">
          <div className="space-y-5">
            
            {/* Ícone de scanner em destaque */}
            <div className="flex justify-center pt-2">
              <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 shadow-inner">
                <ScanLine className="h-12 w-12 text-emerald-600 dark:text-emerald-400" />
                <div className="absolute inset-0 rounded-full bg-emerald-500/5 animate-ping pointer-events-none" style={{ animationDuration: '4s' }} />
              </div>
            </div>

            <div className="text-center space-y-1.5">
              <h2 className="text-xl font-extrabold text-foreground tracking-tight">
                Acesso à Produção
              </h2>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
                Informe seus dados de identificação para iniciar o trabalho nesta estação.
              </p>
            </div>

            <div className="h-px bg-border/60 w-full" />

            {/* Seção "Como se identificar" */}
            <div className="space-y-3.5">
              <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
                <ClipboardList className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Como se identificar</span>
              </div>

              <div className="space-y-3">
                {/* 1. Código de barras */}
                <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/50 p-3 transition-colors hover:border-emerald-500/30">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    <Barcode className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-foreground">Código de barras</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Utilize o crachá ou código de barras do operador.
                    </p>
                  </div>
                </div>

                {/* 2. QR Code */}
                <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/50 p-3 transition-colors hover:border-emerald-500/30">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    <QrCode className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-foreground">QR Code</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Aponte a câmera para o QR Code do crachá.
                    </p>
                  </div>
                </div>

                {/* 3. RFID */}
                <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/50 p-3 transition-colors hover:border-emerald-500/30">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    <Radio className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-foreground">RFID</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Aproxime o crachá RFID do leitor.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Banner Dica Rápida */}
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-xs">
              <Lightbulb className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Dica rápida</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Mantenha seu crachá em boas condições para garantir uma leitura rápida e precisa.
            </p>
          </div>
        </div>

        {/* Painel Direito: Formulário Interativo de Login */}
        <div className="lg:col-span-7 rounded-3xl border border-border/80 bg-card/70 backdrop-blur-xl p-6 sm:p-8 shadow-lg shadow-foreground/5 flex flex-col justify-between space-y-6">
          <form onSubmit={handleSubmit} className="space-y-6 flex-1 flex flex-col justify-between">
            
            <div className="space-y-6">
              {/* Cabeçalho do formulário */}
              <div className="flex items-start gap-4 pb-2 border-b border-border/60">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-extrabold text-foreground">
                    Identificação do operador
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5 font-medium">
                    Preencha os campos abaixo ou utilize seu crachá.
                  </p>
                </div>
              </div>

              {/* Campo 1: Nome/Login do operador */}
              <div className="space-y-2">
                <Label 
                  htmlFor="op-name" 
                  className={`text-xs font-bold transition-colors duration-200 flex items-center gap-2 ${
                    isFocused === 'name' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                  }`}
                >
                  <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Nome/Login do operador</span>
                </Label>
                <Input
                  id="op-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onFocus={() => setIsFocused('name')}
                  onBlur={() => setIsFocused(null)}
                  placeholder="Ex.: carlos.silva ou Carlos Silva"
                  required
                  autoComplete="off"
                  autoFocus
                  className="h-12 px-4 rounded-xl border-border bg-background/50 focus:bg-background focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all duration-200 text-sm font-medium"
                />
              </div>

              {/* Campo 2: Matrícula */}
              <div className="space-y-2">
                <Label 
                  htmlFor="op-reg" 
                  className={`text-xs font-bold transition-colors duration-200 flex items-center gap-2 ${
                    isFocused === 'reg' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                  }`}
                >
                  <BadgeCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Matrícula</span>
                </Label>
                <Input
                  id="op-reg"
                  type="password"
                  value={registration}
                  onChange={(e) => setRegistration(e.target.value)}
                  onFocus={() => setIsFocused('reg')}
                  onBlur={() => setIsFocused(null)}
                  placeholder="Ex.: 00123"
                  required
                  autoComplete="one-time-code"
                  className="h-12 px-4 rounded-xl border-border bg-background/50 focus:bg-background focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all duration-200 text-sm font-medium"
                />
              </div>

              {/* Exibição de erro */}
              {error && (
                <div className="flex items-start gap-2.5 rounded-2xl bg-destructive/10 border border-destructive/20 p-4 text-xs font-medium text-destructive animate-headShake">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-normal">{error}</span>
                </div>
              )}
            </div>

            {/* Ação do Botão Principal e Rodapé do Form */}
            <div className="space-y-4 pt-4">
              <Button
                type="submit"
                disabled={loading || !name.trim() || !registration.trim()}
                className="w-full h-12 rounded-2xl font-bold bg-emerald-700 hover:bg-emerald-800 text-white shadow-md shadow-emerald-700/20 hover:shadow-lg hover:shadow-emerald-700/30 transition-all duration-200 transform active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none text-sm gap-2"
              >
                {loading ? (
                  <span className="flex items-center gap-2 justify-center">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Autenticando...
                  </span>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Entrar na Produção</span>
                  </>
                )}
              </Button>

              {/* Sub-rodapé com divisor */}
              <div className="relative flex items-center justify-center pt-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border/60" />
                </div>
                <div className="relative bg-card px-3 text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Acesso seguro e monitorado</span>
                </div>
              </div>
            </div>

          </form>
        </div>

      </div>

      {/* 3. Rodapé Informativo em 3 Colunas */}
      <div className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-md p-4 sm:px-6 grid grid-cols-1 md:grid-cols-3 gap-4 divide-y md:divide-y-0 md:divide-x divide-border/60">
        
        {/* Coluna 1: Auxílio ao Operador */}
        <div className="flex items-center gap-3 pr-0 md:pr-4 pt-2 md:pt-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/60 text-muted-foreground">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-bold text-foreground">Operador não cadastrado?</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Solicite auxílio ao seu supervisor.</p>
          </div>
        </div>

        {/* Coluna 2: Aviso de Responsabilidade */}
        <div className="flex items-center gap-3 px-0 md:px-4 pt-3 md:pt-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Info className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-bold text-foreground">Importante</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
              Ao iniciar o turno, você será responsável pelas movimentações registradas nesta estação.
            </p>
          </div>
        </div>

        {/* Coluna 3: Sincronização em Tempo Real */}
        <div className="flex items-center gap-3 pl-0 md:pl-4 pt-3 md:pt-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <RotateCcw className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold text-foreground">Última sincronização</p>
            <div className="flex items-center justify-between mt-0.5">
              <p className="text-[11px] font-medium text-muted-foreground">{syncTimeText}</p>
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
