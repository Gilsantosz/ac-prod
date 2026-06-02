import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, PlusCircle, LogOut, AlertOctagon, Zap,
  LineChart, Boxes, Users, Gauge, HardHat, TimerOff,
  ClipboardList, TrendingUp, Trophy, Sun, Moon, Menu, X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { KioskProvider, useKiosk } from '@/lib/KioskContext';
import { useAuth } from '@/lib/AuthContext';
import LeoLogo from '@/components/ui/LeoLogo';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';

const nav = [
  { to: '/',                    label: 'Painéis',             icon: LayoutDashboard },
  { to: '/entrada',             label: 'Entrada de Produção', icon: PlusCircle },
  { to: '/resumo-diario',       label: 'Resumo Diário',       icon: ClipboardList },
  { to: '/oee',                 label: 'OEE',                 icon: Gauge },
  { to: '/celulas-metas',       label: 'Células e Metas',     icon: Boxes },
  { to: '/operadores',          label: 'Operadores',          icon: HardHat },
  { to: '/ocorrencias',         label: 'Ocorrências',         icon: AlertOctagon },
  { to: '/analise-paradas',     label: 'Análise de Paradas',  icon: TimerOff },
  { to: '/analise-tendencia',   label: 'Análise de Tendência',icon: TrendingUp },
  { to: '/gamificacao',         label: 'Gamificação',         icon: Trophy },
  { to: '/relatorios',          label: 'Relatórios',          icon: LineChart },
  { to: '/automacoes',          label: 'Automações',          icon: Zap },
  { to: '/usuarios',            label: 'Usuários',            icon: Users, adminOnly: true },
];

export default function AppLayout() {
  return (
    <KioskProvider>
      <AppShell />
    </KioskProvider>
  );
}

function AppShell() {
  const location = useLocation();
  const isMobile = () => window.innerWidth < 768;

  // Sidebar starts collapsed on mobile, expanded on desktop
  const [collapsed, setCollapsed] = useState(() => isMobile());
  const { kiosk } = useKiosk();
  const { user, logout } = useAuth();

  // Controle de Tema (Claro / Escuro)
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Colapsa ao mudar de rota no mobile
  useEffect(() => {
    if (isMobile()) setCollapsed(true);
  }, [location.pathname]);

  useRealtimeSync(!!user);

  const visibleNav = nav.filter((item) => {
    if (item.adminOnly && user?.role !== 'admin') return false;
    if (user?.role !== 'admin') {
      const allowedPathsForOperators = ['/', '/entrada', '/resumo-diario'];
      return allowedPathsForOperators.includes(item.to);
    }
    if (user?.role === 'admin') return true;
    if (!user?.permissions) return false;
    if (item.to === '/') return user.permissions.view_dashboards;
    if (item.to === '/entrada') return user.permissions.register_production;
    if (item.to === '/resumo-diario') return user.permissions.view_dashboards;
    return true;
  });

  const sidebarOpen = !collapsed;

  return (
    <div className="h-[100dvh] flex bg-background overflow-hidden relative">

      {/* ── Backdrop no mobile quando sidebar aberta ──────────────────── */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-background/70 backdrop-blur-sm z-30 transition-opacity duration-300"
          onClick={() => setCollapsed(true)}
          aria-hidden="true"
        />
      )}

      {/* ── Botão fechar ou abrir no mobile ── */}
      {/* O menu hamburguer agora reside dentro do Topbar Móvel no topo da página, fornecendo um visual limpo e sem sobreposições. */}

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          'sidebar-glass flex flex-col border-r border-border/60 transition-all duration-300 shrink-0 h-[100dvh] z-40',
          kiosk && 'hidden',
          // Mobile: posição fixa, desliza da esquerda
          !collapsed
            ? 'fixed inset-y-0 left-0 w-[260px] shadow-2xl md:relative md:shadow-none'
            : 'hidden md:flex md:w-[64px]'
        )}
      >
        {/* ── Cabeçalho da Sidebar ─────────────────────────────────────── */}
        <div className={cn(
          'h-16 flex items-center border-b border-border/60 shrink-0 relative overflow-hidden',
          !collapsed ? 'gap-3 px-5' : 'justify-center px-2'
        )}>
          {/* Acento de brilho decorativo */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

          <div className="flex items-center gap-3 min-w-0 flex-1">
            <LeoLogo size="sm" className="shrink-0" />
            {!collapsed && (
              <div className="min-w-0 animate-fade-up">
                <p className="font-display font-bold text-sm leading-tight truncate text-foreground">AC. Produção</p>
                <p className="text-xs text-muted-foreground truncate">Produção Industrial</p>
              </div>
            )}
          </div>

          {/* Botão fechar no mobile (quando expandido) */}
          {!collapsed && (
            <button
              className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg hover:bg-secondary/60 transition-colors shrink-0"
              onClick={() => setCollapsed(true)}
              aria-label="Fechar menu"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}

          {/* Botão colapsar no desktop */}
          <button
            className={cn(
              'hidden md:flex items-center justify-center w-7 h-7 rounded-lg hover:bg-secondary/60 transition-colors shrink-0',
              collapsed && 'w-full justify-center'
            )}
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            <Menu className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* ── Links de Navegação ───────────────────────────────────────── */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {visibleNav.map((item, i) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-[44px] md:min-h-[40px] group relative',
                  collapsed ? 'justify-center' : 'justify-start',
                  active
                    ? 'nav-active'
                    : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
                )}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <item.icon className={cn(
                  'shrink-0 transition-transform duration-200 group-hover:scale-110',
                  active ? 'w-5 h-5' : 'w-4.5 h-4.5',
                  'w-5 h-5 md:w-4 md:h-4'
                )} />
                {!collapsed && (
                  <span className="truncate">{item.label}</span>
                )}
                {/* Indicador activo */}
                {active && !collapsed && (
                  <span className="absolute right-3 w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_6px_currentColor]" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* ── Rodapé: Tema & Sair ──────────────────────────────────────── */}
        <div className={cn(
          'border-t border-border/60 py-3 px-2 space-y-0.5 shrink-0',
        )}>

          {/* Informações do usuário (quando expandido) */}
          {!collapsed && user && (
            <div className="px-3 py-2 mb-2 rounded-xl bg-secondary/40">
              <p className="text-xs font-semibold text-foreground truncate">{user.name || user.email}</p>
              <p className="text-xs text-muted-foreground capitalize">{user.role || 'Operador'}</p>
            </div>
          )}

          {/* Toggle de Tema */}
          <button
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-secondary/70 hover:text-foreground transition-all duration-200 min-h-[44px] md:min-h-[40px]',
              collapsed ? 'justify-center' : 'justify-start'
            )}
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Ativar Modo Claro' : 'Ativar Modo Escuro'}
          >
            {theme === 'dark' ? (
              <Sun className="w-5 h-5 md:w-4 md:h-4 text-amber-400 shrink-0" />
            ) : (
              <Moon className="w-5 h-5 md:w-4 md:h-4 text-indigo-400 shrink-0" />
            )}
            {!collapsed && (
              <span>{theme === 'dark' ? 'Tema Claro' : 'Tema Escuro'}</span>
            )}
          </button>

          {/* Botão Sair */}
          <button
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200 min-h-[44px] md:min-h-[40px]',
              collapsed ? 'justify-center' : 'justify-start'
            )}
            onClick={logout}
            title="Sair"
          >
            <LogOut className="w-5 h-5 md:w-4 md:h-4 shrink-0" />
            {!collapsed && <span>Sair</span>}
          </button>
        </div>
      </aside>

      {/* ── Painel Principal ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-[100dvh] overflow-hidden">
        {/* Topbar Móvel (apenas mobile/tablet) */}
        {!kiosk && (
          <header className="md:hidden flex items-center justify-between px-4 h-14 bg-background/80 backdrop-blur-md border-b border-border/60 z-20 shrink-0 relative">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCollapsed(false)}
                className="flex items-center justify-center w-10 h-10 rounded-xl border border-border/80 bg-card/90 text-foreground hover:bg-secondary/60 active:scale-95 transition-all"
                aria-label="Abrir menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2">
                <LeoLogo size="sm" className="shrink-0" />
                <span className="font-display font-bold text-sm leading-tight text-foreground">AC. Produção</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                className="flex items-center justify-center w-10 h-10 rounded-xl border border-border/80 bg-card/90 text-muted-foreground hover:text-foreground active:scale-95 transition-all"
                onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                title={theme === 'dark' ? 'Ativar Modo Claro' : 'Ativar Modo Escuro'}
              >
                {theme === 'dark' ? (
                  <Sun className="w-4.5 h-4.5 text-amber-400" />
                ) : (
                  <Moon className="w-4.5 h-4.5 text-indigo-400" />
                )}
              </button>
            </div>
          </header>
        )}

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}