import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { base44 } from '@/lib/localDb';
import { Factory, LayoutDashboard, PlusCircle, LogOut, AlertOctagon, Zap, LineChart, Boxes, Users, Gauge, HardHat, TimerOff, ClipboardList, TrendingUp, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { KioskProvider, useKiosk } from '@/lib/KioskContext';
import { useAuth } from '@/lib/AuthContext';
import LeoLogo from '@/components/ui/LeoLogo';

const nav = [
  { to: '/', label: 'Painéis', icon: LayoutDashboard },
  { to: '/entrada', label: 'Entrada de Produção', icon: PlusCircle },
  { to: '/resumo-diario', label: 'Resumo Diário', icon: ClipboardList },
  { to: '/oee', label: 'OEE', icon: Gauge },
  { to: '/celulas-metas', label: 'Células e Metas', icon: Boxes },
  { to: '/operadores', label: 'Operadores', icon: HardHat },
  { to: '/ocorrencias', label: 'Ocorrências', icon: AlertOctagon },
  { to: '/analise-paradas', label: 'Análise de Paradas', icon: TimerOff },
  { to: '/analise-tendencia', label: 'Análise de Tendência', icon: TrendingUp },
  { to: '/gamificacao', label: 'Gamificação', icon: Trophy },
  { to: '/relatorios', label: 'Relatórios', icon: LineChart },
  { to: '/automacoes', label: 'Automações', icon: Zap },
  { to: '/usuarios', label: 'Usuários', icon: Users, adminOnly: true },
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
  const [collapsed, setCollapsed] = useState(false);
  const { kiosk } = useKiosk();
  const { user, logout } = useAuth();

  const visibleNav = nav.filter((item) => {
    // Se o item é reservado para administrador e o usuário não for admin
    if (item.adminOnly && user?.role !== 'admin') return false;
    
    // Se o usuário não for administrador (operador / usuário operacional)
    // ele visualiza e acessa de forma garantida e incondicional as 3 páginas importantes: Painéis, Entrada de Produção e Resumo Diário
    if (user?.role !== 'admin') {
      const allowedPathsForOperators = ['/', '/entrada', '/resumo-diario'];
      return allowedPathsForOperators.includes(item.to);
    }
    
    // Administradores têm acesso irrestrito a todos os menus
    if (user?.role === 'admin') return true;
    
    // Se o usuário não tiver permissões cadastradas no banco
    if (!user?.permissions) return false;
    
    // Mapeamento dinâmico de caminhos para chaves de permissões granulares dos menus permitidos
    if (item.to === '/') return user.permissions.view_dashboards;
    if (item.to === '/entrada') return user.permissions.register_production;
    if (item.to === '/resumo-diario') return user.permissions.view_dashboards;
    
    return true;
  });

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <aside className={cn(
        'hidden md:flex flex-col border-r border-border bg-card/50 backdrop-blur transition-all duration-200 shrink-0 h-screen',
        kiosk && 'md:hidden',
        collapsed ? 'w-20' : 'w-64'
      )}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          className={cn('h-16 flex items-center border-b border-border w-full hover:bg-secondary/60 transition-colors', collapsed ? 'justify-center px-2' : 'gap-3 px-6')}>
          <LeoLogo size="sm" />
          <div className={cn('min-w-0 text-left transition-all duration-200', collapsed ? 'w-0 opacity-0 md:hidden' : 'w-auto opacity-100')}>
            <p className="font-bold leading-tight truncate">AC. Produção</p>
            <p className="text-xs text-muted-foreground truncate">Produção Industrial</p>
          </div>
        </button>
        <nav className="flex-1 p-4 space-y-1">
          {visibleNav.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link key={item.to} to={item.to} title={item.label}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                  collapsed && 'justify-center',
                  active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}>
                <item.icon className="w-4 h-4 shrink-0" />
                <span className={cn('transition-all duration-200 truncate', collapsed ? 'w-0 opacity-0 md:hidden' : 'w-auto opacity-100')}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border space-y-1">
          <Button variant="ghost" className={cn('w-full gap-3 text-muted-foreground', collapsed ? 'justify-center px-0' : 'justify-start')}
            onClick={() => logout()} title="Sair">
            <LogOut className="w-4 h-4" />
            <span className={cn('transition-all duration-200 truncate', collapsed ? 'w-0 opacity-0 md:hidden' : 'w-auto opacity-100')}>
              Sair
            </span>
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className={cn('md:hidden h-14 flex items-center justify-between px-4 border-b border-border bg-card', kiosk && 'hidden')}>
          <div className="flex items-center gap-2">
            <LeoLogo size="sm" />
            <span className="font-bold">AC. Produção</span>
          </div>
          <nav className="flex gap-1">
            {visibleNav.map((item) => (
              <Link key={item.to} to={item.to} className="p-2 rounded-lg hover:bg-secondary">
                <item.icon className="w-5 h-5" />
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}