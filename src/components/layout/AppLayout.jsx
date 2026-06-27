import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, PlusCircle, LogOut, AlertOctagon, Zap,
  LineChart, Boxes, Users, Gauge,
  ClipboardList, Trophy, Sun, Moon, Menu, X,
  ChevronLeft, Layers, Plug, Shield, HardDrive,
  BrainCircuit,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { KioskProvider, useKiosk } from '@/lib/KioskContext';
import { useAuth } from '@/lib/AuthContext';
import LeoLogo from '@/components/ui/LeoLogo';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { useTheme } from '@/hooks/useTheme';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { motion, AnimatePresence } from 'framer-motion';
import NotificationCenter from '@/components/layout/NotificationCenter';
import LeoAssistantChat from '@/components/assistant/LeoAssistantChat';

const nav = [
  // ─── Produção Principal ──────────────────────────────────────────────
  { to: '/',                    label: 'Painéis',             icon: LayoutDashboard },
  { to: '/entrada',             label: 'Entrada de Produção', icon: PlusCircle },
  { to: '/resumo-diario',       label: 'Resumo Diário',       icon: ClipboardList },
  { to: '/oee',                 label: 'OEE',                 icon: Gauge },
  { to: '/celulas-metas',       label: 'Células e Metas',     icon: Boxes },
  // ─── Rastreabilidade MES ──────────────────────────────────────────
  { to: '/rastreabilidade',     label: 'Rastreabilidade',     icon: Layers },
  { to: '/integracoes/promob',  label: 'Integração Promob',   icon: Plug },
  // ─── Qualidade e Relatórios ─────────────────────────────────────
  { to: '/ocorrencias',         label: 'Ocorrências',         icon: AlertOctagon },
  { to: '/gamificacao',         label: 'Gamificação',         icon: Trophy },
  { to: '/relatorios',          label: 'Relatórios',          icon: LineChart },
  { to: '/ia-operacional',      label: 'IA Operacional',      icon: BrainCircuit },
  { to: '/automacoes',          label: 'Automações',          icon: Zap },
  // ─── Administração ─────────────────────────────────────────────────
  { to: '/usuarios',            label: 'Usuários',            icon: Users },
  { to: '/logs-sistema',        label: 'Logs do Sistema',     icon: Shield,    adminOnly: true },
  { to: '/downloads-backups',   label: 'Backups & Drive',     icon: HardDrive, adminOnly: true },
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const { kiosk } = useKiosk();
  const { user, logout } = useAuth();

  // Sidebar collapse state — persisted
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true'; }
    catch { return false; }
  });

  const [theme, setTheme] = useTheme();

  useEffect(() => {
    try { localStorage.setItem('sidebar-collapsed', String(collapsed)); }
    catch { /* noop */ }
  }, [collapsed]);

  // Fecha o drawer ao mudar de rota (mobile)
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useRealtimeSync(!!user);

  const pathPermissionMap = {
    '/': 'view_dashboards',
    '/entrada': 'register_production',
    '/resumo-diario': 'view_dashboards',
    '/oee': 'view_dashboards',
    '/celulas-metas': 'manage_cells',
    '/usuarios': 'manage_operators',
    '/ocorrencias': 'manage_occurrences',
    '/analise-paradas': 'manage_occurrences',
    '/analise-tendencia': 'view_dashboards',
    '/gamificacao': 'view_dashboards',
    '/relatorios': 'view_reports',
    '/ia-operacional': 'ai_operations',
    '/automacoes': 'manage_automations',
  };

  const visibleNav = nav.filter((item) => {
    if (item.adminOnly && user?.role !== 'admin') return false;
    if (user?.role === 'admin') return true;
    if (!user?.permissions) return false;
    
    const requiredPermission = pathPermissionMap[item.to];
    if (requiredPermission) {
      if (requiredPermission === 'ai_operations') {
        return !!(user.permissions.ai_operations || user.permissions.view_reports || user.permissions.manage_automations);
      }
      return !!user.permissions[requiredPermission];
    }
    return true;
  });

  const userInitials = user
    ? (user.name ? user.name.substring(0, 2).toUpperCase() : user.email.substring(0, 2).toUpperCase())
    : '??';

  return (
    <div className="h-[100dvh] w-full flex bg-background overflow-hidden relative">

      {/* ── Desktop Sidebar ───────────────────────────────────────────────── */}
      {!kiosk && (
        <aside
          className={cn(
            'hidden md:flex flex-col shrink-0 h-full bg-card border-r border-border/60 transition-all duration-300 ease-in-out relative z-20',
            collapsed ? 'w-[64px]' : 'w-[240px]'
          )}
        >
          {/* Decorative top glow */}
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#76FB91]/60 to-transparent" />

          {/* ── Logo / Toggle ──────────────────────────────────────────────── */}
          <button
            onClick={() => setCollapsed(c => !c)}
            className={cn(
              'flex items-center gap-3 px-4 h-16 shrink-0 border-b border-border/60',
              'hover:bg-secondary/60 transition-colors duration-200 select-none group w-full text-left',
              collapsed ? 'justify-center px-0' : 'justify-between'
            )}
            title={collapsed ? 'Expandir menu' : 'Colapsar menu'}
          >
            <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
              <LeoLogo size="sm" className="shrink-0" />
              {!collapsed && (
                <span className="font-extrabold text-lg leading-none tracking-tight select-none font-display text-foreground">
                  Leo Flow
                </span>
              )}
            </div>
            {!collapsed && (
              <ChevronLeft
                className={cn(
                  'w-4 h-4 text-muted-foreground transition-transform duration-300 group-hover:text-foreground shrink-0',
                )}
              />
            )}
          </button>

          {/* ── Nav Items ─────────────────────────────────────────────────── */}
          <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 space-y-0.5 px-2">
            {visibleNav.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 select-none group',
                    collapsed ? 'justify-center' : 'justify-start',
                    active
                      ? 'bg-[#76FB91]/20 text-foreground font-semibold border border-[#76FB91]/30 shadow-sm'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  )}
                >
                  <item.icon
                    className={cn(
                      'shrink-0 transition-transform duration-200 group-hover:scale-110',
                      collapsed ? 'w-5 h-5' : 'w-4.5 h-4.5',
                      active ? 'text-[#2d9c4a]' : ''
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          {/* ── Footer: Tema + Perfil ──────────────────────────────────────── */}
          <div className={cn(
            'shrink-0 border-t border-border/60 p-3 space-y-2',
            collapsed ? 'flex flex-col items-center' : ''
          )}>
            {/* Theme & Notifications */}
            <div className={cn('flex items-center gap-2 w-full', collapsed ? 'flex-col' : 'justify-between')}>
              <NotificationCenter />
              <button
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-all duration-200',
                  collapsed ? 'w-10 h-10 justify-center px-0' : 'flex-1'
                )}
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                title={theme === 'dark' ? 'Ativar Modo Claro' : 'Ativar Modo Escuro'}
              >
                {theme === 'dark' ? (
                  <Sun className="w-4.5 h-4.5 text-amber-400 shrink-0" />
                ) : (
                  <Moon className="w-4.5 h-4.5 text-indigo-400 shrink-0" />
                )}
                {!collapsed && <span className="text-sm">{theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}</span>}
              </button>
            </div>

            {/* User profile */}
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-secondary transition-all duration-200 w-full focus:outline-none',
                      collapsed ? 'justify-center' : 'justify-start'
                    )}
                    title={collapsed ? (user.name || user.email) : undefined}
                  >
                    <div className="w-8 h-8 rounded-full bg-[#76FB91] text-black font-extrabold flex items-center justify-center text-sm shadow-sm shrink-0">
                      {userInitials}
                    </div>
                    {!collapsed && (
                      <div className="text-left min-w-0 flex-1">
                        <p className="text-xs font-bold leading-tight truncate text-foreground">{user.name || user.email}</p>
                        <p className="text-[10px] text-muted-foreground capitalize leading-none mt-0.5 truncate">{user.role || 'Operador'}</p>
                      </div>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="end"
                  className="w-52 mb-2 rounded-2xl p-1 bg-card border border-border/80 shadow-md z-50"
                >
                  <div className="px-3 py-2 border-b border-border/65 text-xs mb-1">
                    <p className="font-semibold text-foreground truncate">{user.name || user.email}</p>
                    <p className="text-muted-foreground capitalize mt-0.5">{user.role || 'Operador'}</p>
                  </div>
                  <DropdownMenuItem
                    onClick={logout}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    <span>Sair do sistema</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </aside>
      )}

      {/* ── Mobile Topbar ─────────────────────────────────────────────────── */}
      <div className={cn('flex flex-col flex-1 min-w-0 overflow-hidden', kiosk && 'w-full')}>
        <header className={cn(
          'md:hidden flex items-center justify-between px-4 h-16 bg-card border-b border-border/60 z-20 shrink-0 relative transition-colors',
          kiosk && 'hidden'
        )}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="flex items-center justify-center w-10 h-10 rounded-xl border border-border/80 bg-card text-foreground hover:bg-secondary active:scale-95 transition-all"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <LeoLogo size="sm" className="shrink-0" />
              <span className="font-bold text-base leading-tight text-foreground font-display">Leo Flow</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <NotificationCenter />
            <button
              className="flex items-center justify-center w-10 h-10 rounded-xl border border-border/80 bg-card text-muted-foreground hover:text-foreground active:scale-95 transition-all"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? (
                <Sun className="w-4.5 h-4.5 text-amber-400" />
              ) : (
                <Moon className="w-4.5 h-4.5 text-indigo-400" />
              )}
            </button>
          </div>
        </header>

        {/* ── Mobile Drawer ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileOpen(false)}
                className="fixed inset-0 bg-black z-40 md:hidden"
              />
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed inset-y-0 left-0 w-[280px] bg-card border-r border-border/60 z-50 p-5 flex flex-col md:hidden"
              >
                {/* Header drawer */}
                <div className="flex items-center justify-between pb-4 border-b border-border/60 mb-4 shrink-0">
                  <div className="flex items-center gap-2">
                    <LeoLogo size="sm" className="shrink-0" />
                    <span className="font-bold text-base text-foreground font-display">Leo Flow</span>
                  </div>
                  <button
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-secondary transition-colors"
                  >
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                </div>

                {/* Nav list */}
                <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
                  {visibleNav.map((item) => {
                    const active = location.pathname === item.to;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 select-none',
                          active
                            ? 'bg-[#76FB91]/20 text-foreground font-semibold border border-[#76FB91]/30 shadow-sm'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                        )}
                      >
                        <item.icon className={cn('w-5 h-5 shrink-0', active ? 'text-[#2d9c4a]' : '')} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </nav>

                {/* Footer drawer */}
                <div className="pt-4 border-t border-border/60 mt-auto shrink-0">
                  {user && (
                    <div className="flex items-center gap-3 p-2.5 rounded-xl bg-secondary/50 mb-3">
                      <div className="w-9 h-9 rounded-full bg-[#76FB91] text-black font-extrabold flex items-center justify-center text-sm shadow-sm shrink-0">
                        {userInitials}
                      </div>
                      <div className="text-left min-w-0 flex-1">
                        <p className="text-xs font-bold leading-tight truncate">{user.name || user.email}</p>
                        <p className="text-[10px] text-muted-foreground capitalize leading-none mt-0.5 truncate">{user.role || 'Operador'}</p>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={logout}
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-colors focus:outline-none"
                  >
                    <LogOut className="w-5 h-5 shrink-0" />
                    <span>Sair do sistema</span>
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ── Main Content ─────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      {user && <LeoAssistantChat user={user} />}
    </div>
  );
}
