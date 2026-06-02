import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, LogOut, AlertOctagon, Zap, LineChart, Boxes, Users, Gauge, HardHat, TimerOff, ClipboardList, TrendingUp, Trophy, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { KioskProvider, useKiosk } from '@/lib/KioskContext';
import { useAuth } from '@/lib/AuthContext';
import LeoLogo from '@/components/ui/LeoLogo';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';

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
  // Inicializa colapsado por padrão em dispositivos móveis (< 768px) para otimizar espaço de tela
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 768);
  const { kiosk } = useKiosk();
  const { user, logout } = useAuth();

  // Ativa a escuta de eventos em tempo real do banco de dados enquanto logado
  useRealtimeSync(!!user);

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
    <div className="h-screen flex bg-background overflow-hidden relative">
      {/* Backdrop de desfocagem/vidro desfocado no mobile quando o menu está expandido */}
      {!collapsed && (
        <div 
          className="md:hidden fixed inset-0 bg-background/60 backdrop-blur-xs z-30 transition-opacity duration-200"
          onClick={() => setCollapsed(true)}
        />
      )}

      {/* Sidebar Colapsável (Funciona no Desktop e no Mobile como lateral esquerda) */}
      <aside className={cn(
        'flex flex-col border-r border-border bg-card/95 md:bg-card/50 backdrop-blur transition-all duration-200 shrink-0 h-screen z-40',
        kiosk && 'hidden',
        collapsed 
          ? 'w-16 md:w-20' 
          : 'fixed md:relative inset-y-0 left-0 w-64 shadow-2xl md:shadow-none'
      )}>
        {/* Cabeçalho da Sidebar / Botão de Expandir/Colapsar */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          className={cn(
            'h-16 flex items-center border-b border-border w-full hover:bg-secondary/60 transition-colors shrink-0', 
            collapsed ? 'justify-center px-2' : 'gap-3 px-6'
          )}
        >
          <LeoLogo size="sm" />
          <div className={cn(
            'min-w-0 text-left transition-all duration-200', 
            collapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'
          )}>
            <p className="font-bold leading-tight truncate">AC. Produção</p>
            <p className="text-xs text-muted-foreground truncate">Produção Industrial</p>
          </div>
        </button>

        {/* Links de Navegação */}
        <nav className="flex-1 p-2 md:p-4 space-y-1.5 overflow-y-auto">
          {visibleNav.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link 
                key={item.to} 
                to={item.to} 
                title={item.label}
                onClick={() => {
                  // Colapsa automaticamente no mobile ao clicar em qualquer item para revelar a página
                  if (window.innerWidth < 768) {
                    setCollapsed(true);
                  }
                }}
                className={cn(
                  'flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-sm font-medium transition-all min-h-[44px] md:min-h-[40px]',
                  collapsed ? 'justify-center' : 'justify-start',
                  active ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                <item.icon className="w-5 h-5 md:w-4 md:h-4 shrink-0" />
                <span className={cn(
                  'transition-all duration-200 truncate', 
                  collapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'
                )}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Botão de Sair (Logout) no Rodapé da Sidebar */}
        <div className="p-2 md:p-4 border-t border-border space-y-1 shrink-0">
          <Button 
            variant="ghost" 
            className={cn(
              'w-full gap-3 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-xl min-h-[44px] md:min-h-[40px]', 
              collapsed ? 'justify-center px-0' : 'justify-start'
            )}
            onClick={() => {
              if (window.innerWidth < 768) {
                setCollapsed(true);
              }
              logout();
            }} 
            title="Sair"
          >
            <LogOut className="w-5 h-5 md:w-4 md:h-4" />
            <span className={cn(
              'transition-all duration-200 truncate', 
              collapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'
            )}>
              Sair
            </span>
          </Button>
        </div>
      </aside>

      {/* Painel Principal de Conteúdo */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}