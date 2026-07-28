import { useState, useMemo } from 'react';
import { 
  LogIn, 
  User, 
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
import { useAuth } from '@/lib/AuthContext';

/**
 * OperationalLoginGate
 * 
 * Design ultra-compacto e responsivo para caber 100% dos elementos
 * (Cabeçalho, Painel de Guias, Formulário e Rodapé de Sincronização)
 * em uma única tela sem necessidade de rolagem vertical.
 */
export default function OperationalLoginGate({ 
  children,
  pageTitle = "Coleta / Bipagem",
  pageSubtitle = "ESTAÇÃO DE CONTROLE OPERACIONAL",
  pageDescription = "Identificação do operador para início do turno de produção.",
  icon: IconComponent = ScanLine
}) {
  const { isLoggedIn, loading, error, login } = useOperatorSession();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');
  const [isFocused, setIsFocused] = useState(null);

  // Nome do usuário logado no sistema (Supabase Profile/Auth)
  const systemUserName = useMemo(() => {
    return (
      user?.user_metadata?.full_name || 
      user?.user_metadata?.name || 
      user?.name || 
      user?.email?.split('@')[0] || 
      'Usuário Conectado'
    );
  }, [user]);

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
      // Erro tratado no hook
    }
  };

  const PageIcon = IconComponent || ScanLine;

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-3 p-1.5 sm:p-3 animate-in fade-in duration-200">
      
      {/* 1. Cabeçalho Superior da Estação (Compacto) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-card/50 backdrop-blur-md p-3 sm:px-4 rounded-xl border border-border/60 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm">
            <PageIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                {pageSubtitle}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground leading-none mt-0.5">
              {pageTitle}
            </h1>
            <p className="text-[11px] text-muted-foreground font-medium mt-0.5">
              {pageDescription}
            </p>
          </div>
        </div>

        {/* Badge da Estação Online */}
        <div className="flex items-center gap-2.5 self-start sm:self-auto rounded-xl border border-border/80 bg-card/80 px-3 py-1.5 shadow-sm">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-bold text-foreground">Estação online</span>
          </div>
          <div className="h-3 w-px bg-border/60" />
          <div className="text-[10px] text-muted-foreground flex items-center gap-1 font-medium">
            <span>Sistema sincronizado</span>
            <Wifi className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>
      </div>

      {/* 2. Grid Principal com 2 Painéis Compactos */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
        
        {/* Painel Esquerdo: Guias e Formas de Identificação */}
        <div className="lg:col-span-5 rounded-2xl border border-border/80 bg-card/70 backdrop-blur-xl p-4 sm:p-5 shadow-sm flex flex-col justify-between space-y-3">
          <div className="space-y-3">
            
            {/* Ícone de scanner compacto */}
            <div className="flex justify-center pt-1">
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 shadow-inner">
                <ScanLine className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                <div className="absolute inset-0 rounded-full bg-emerald-500/5 animate-ping pointer-events-none" style={{ animationDuration: '4s' }} />
              </div>
            </div>

            <div className="text-center space-y-0.5">
              <h2 className="text-base font-extrabold text-foreground tracking-tight">
                Acesso à Produção
              </h2>
              <p className="text-[11px] text-muted-foreground max-w-xs mx-auto leading-tight">
                Informe seus dados de identificação para iniciar o trabalho nesta estação.
              </p>
            </div>

            <div className="h-px bg-border/50 w-full" />

            {/* Seção "Como se identificar" */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground uppercase tracking-wider">
                <ClipboardList className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Como se identificar</span>
              </div>

              <div className="space-y-2">
                {/* 1. Código de barras */}
                <div className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-background/50 p-2 transition-colors hover:border-emerald-500/30">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    <Barcode className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[11px] font-bold text-foreground leading-none">Código de barras</h3>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      Utilize o crachá ou código de barras do operador.
                    </p>
                  </div>
                </div>

                {/* 2. QR Code */}
                <div className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-background/50 p-2 transition-colors hover:border-emerald-500/30">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    <QrCode className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[11px] font-bold text-foreground leading-none">QR Code</h3>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      Aponte a câmera para o QR Code do crachá.
                    </p>
                  </div>
                </div>

                {/* 3. RFID */}
                <div className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-background/50 p-2 transition-colors hover:border-emerald-500/30">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    <Radio className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[11px] font-bold text-foreground leading-none">RFID</h3>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      Aproxime o crachá RFID do leitor.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Banner Dica Rápida */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 space-y-1">
            <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-bold text-[11px]">
              <Lightbulb className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Dica rápida</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-tight">
              Mantenha seu crachá em boas condições para garantir uma leitura rápida e precisa.
            </p>
          </div>
        </div>

        {/* Painel Direito: Formulário Interativo de Login */}
        <div className="lg:col-span-7 rounded-2xl border border-border/80 bg-card/70 backdrop-blur-xl p-4 sm:p-5 shadow-sm flex flex-col justify-between space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4 flex-1 flex flex-col justify-between">
            
            <div className="space-y-4">
              {/* Cabeçalho do formulário */}
              <div className="flex items-center gap-3 pb-2 border-b border-border/50">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-extrabold text-foreground leading-none">
                    Identificação do operador
                  </h2>
                  <p className="text-[11px] text-muted-foreground font-medium mt-0.5">
                    Preencha os campos abaixo ou utilize seu crachá.
                  </p>
                </div>
              </div>

              {/* Campo 1: Nome/Login do operador */}
              <div className="space-y-1.5">
                <Label 
                  htmlFor="op-name" 
                  className={`text-[11px] font-bold transition-colors duration-200 flex items-center gap-1.5 ${
                    isFocused === 'name' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                  }`}
                >
                  <User className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
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
                  className="h-10 px-3 rounded-xl border-border bg-background/50 focus:bg-background focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all duration-200 text-xs font-medium"
                />
              </div>

              {/* Campo 2: Matrícula */}
              <div className="space-y-1.5">
                <Label 
                  htmlFor="op-reg" 
                  className={`text-[11px] font-bold transition-colors duration-200 flex items-center gap-1.5 ${
                    isFocused === 'reg' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                  }`}
                >
                  <BadgeCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
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
                  className="h-10 px-3 rounded-xl border-border bg-background/50 focus:bg-background focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all duration-200 text-xs font-medium"
                />
              </div>

              {/* Exibição de erro */}
              {error && (
                <div className="flex items-start gap-2 rounded-xl bg-destructive/10 border border-destructive/20 p-2.5 text-[11px] font-medium text-destructive animate-headShake">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-tight">{error}</span>
                </div>
              )}
            </div>

            {/* Ação do Botão Principal e Rodapé do Form */}
            <div className="space-y-2.5 pt-2">
              <Button
                type="submit"
                disabled={loading || !name.trim() || !registration.trim()}
                className="w-full h-10 rounded-xl font-bold bg-emerald-700 hover:bg-emerald-800 text-white shadow-md shadow-emerald-700/20 hover:shadow-lg hover:shadow-emerald-700/30 transition-all duration-200 transform active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none text-xs gap-2"
              >
                {loading ? (
                  <span className="flex items-center gap-2 justify-center">
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Autenticando...
                  </span>
                ) : (
                  <>
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Entrar na Produção</span>
                  </>
                )}
              </Button>

              {/* Sub-rodapé com divisor */}
              <div className="relative flex items-center justify-center pt-1">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border/50" />
                </div>
                <div className="relative bg-card/90 px-2.5 text-[10px] font-medium text-muted-foreground flex items-center gap-1.5">
                  <Shield className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  <span>Acesso seguro e monitorado</span>
                </div>
              </div>
            </div>

          </form>
        </div>

      </div>

      {/* 3. Rodapé Informativo Compacto em 3 Colunas */}
      <div className="rounded-xl border border-border/70 bg-card/60 backdrop-blur-md p-3 sm:px-4 grid grid-cols-1 md:grid-cols-3 gap-3 divide-y md:divide-y-0 md:divide-x divide-border/50">
        
        {/* Coluna 1: Usuário Logado no Sistema */}
        <div className="flex items-center gap-2.5 pr-0 md:pr-3 pt-1 md:pt-0 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            <Users className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Usuário Logado</p>
            <p className="text-xs font-bold text-foreground truncate">{systemUserName}</p>
          </div>
        </div>

        {/* Coluna 2: Aviso de Responsabilidade */}
        <div className="flex items-center gap-2.5 px-0 md:px-3 pt-2 md:pt-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            <Info className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-foreground leading-none">Importante</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
              Ao iniciar o turno, você será responsável pelas movimentações registradas nesta estação.
            </p>
          </div>
        </div>

        {/* Coluna 3: Sincronização em Tempo Real */}
        <div className="flex items-center gap-2.5 pl-0 md:pl-3 pt-2 md:pt-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            <RotateCcw className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-foreground leading-none">Última sincronização</p>
            <div className="flex items-center justify-between mt-0.5">
              <p className="text-[10px] font-medium text-muted-foreground">{syncTimeText}</p>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
