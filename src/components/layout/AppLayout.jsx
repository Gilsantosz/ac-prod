import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { KioskProvider, useKiosk } from '@/lib/KioskContext';
import { useAuth } from '@/lib/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { useTheme } from '@/hooks/useTheme';
import LeoLogo from '@/components/ui/LeoLogo';
import NotificationCenter from '@/components/layout/NotificationCenter';
import LeoAssistantChat from '@/components/assistant/LeoAssistantChat';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { appRoutes, routeGroups } from '@/config/appRoutes';

const DESKTOP_POINTER_QUERY = '(hover: hover) and (pointer: fine)';
const SIDEBAR_CLOSE_DELAY_MS = 180;

export function isDesktopSidebarExpanded({ hovered, focused, profileOpen, notificationsOpen }) {
  return hovered || focused || profileOpen || notificationsOpen;
}

export default function AppLayout() {
  return <KioskProvider><AppShell /></KioskProvider>;
}

function AppShell() {
  const location = useLocation();
  const { kiosk } = useKiosk();
  const { user, logout } = useAuth();
  const [theme, setTheme] = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopPointer, setDesktopPointer] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(DESKTOP_POINTER_QUERY).matches
  ));
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const sidebarRef = useRef(null);
  const pointerInsideRef = useRef(false);
  const closeTimerRef = useRef(null);

  useRealtimeSync(!!user);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_POINTER_QUERY);
    const update = () => setDesktopPointer(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimerRef.current);
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      if (!pointerInsideRef.current && !sidebarRef.current?.contains(document.activeElement)) {
        setHovered(false);
        setFocused(false);
      }
    }, SIDEBAR_CLOSE_DELAY_MS);
  }, [cancelClose]);

  const expanded = desktopPointer && isDesktopSidebarExpanded({
    hovered, focused, profileOpen, notificationsOpen,
  });

  const visibleNav = useMemo(() => appRoutes.filter((item) => {
    if (!item.showInSidebar) return false;
    if (item.permission === 'adminOnly' && user?.role !== 'admin') return false;
    if (user?.role === 'operator' && ['/pcp', '/celulas-metas', '/usuarios', '/rotas-produtivas'].includes(item.path)) return false;
    if (user?.role === 'admin') return true;
    if (!user?.permissions) return false;
    if (item.permission === 'ai_operations') {
      return !!(user.permissions.ai_operations || user.permissions.view_reports || user.permissions.manage_automations);
    }
    return item.permission ? !!user.permissions[item.permission] : true;
  }), [user]);

  const userInitials = user
    ? (user.name || user.email || '??').substring(0, 2).toUpperCase()
    : '??';
  const mobileOnlyClass = desktopPointer ? 'md:hidden' : '';

  return (
    <div className="relative flex h-[100dvh] w-full overflow-hidden bg-background">
      {!kiosk && desktopPointer && (
        <div
          className={cn(
            'relative z-30 hidden h-full shrink-0 md:block',
            expanded ? 'w-[240px]' : 'w-[64px]'
          )}
          data-testid="desktop-sidebar-slot"
        >
          <aside
            ref={sidebarRef}
            onMouseEnter={() => {
              pointerInsideRef.current = true;
              cancelClose();
              setHovered(true);
            }}
            onMouseLeave={() => {
              pointerInsideRef.current = false;
              if (!profileOpen && !notificationsOpen) scheduleClose();
            }}
            onFocusCapture={() => {
              cancelClose();
              setFocused(true);
            }}
            onBlurCapture={() => {
              window.setTimeout(() => {
                if (!sidebarRef.current?.contains(document.activeElement)) {
                  setFocused(false);
                  if (!pointerInsideRef.current && !profileOpen && !notificationsOpen) scheduleClose();
                }
              }, 0);
            }}
            className={cn(
              'relative flex h-full w-full flex-col overflow-hidden border-r border-border/60 bg-card'
            )}
            aria-label="Navegação principal"
          >
            <Link
              to="/"
              className={cn(
                'flex h-16 shrink-0 items-center gap-3 border-b border-border/60 px-4 transition-colors hover:bg-secondary/60',
                !expanded && 'justify-center px-0'
              )}
              title={!expanded ? 'Leo Flow' : undefined}
            >
              <LeoLogo size="sm" className="shrink-0" />
              {expanded && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="whitespace-nowrap font-display text-lg font-extrabold tracking-tight">Leo Flow</motion.span>}
            </Link>

            <nav className="flex-1 select-none space-y-4 overflow-y-auto overflow-x-hidden px-2 py-3">
              <NavigationGroups items={visibleNav} pathname={location.pathname} expanded={expanded} />
            </nav>

            <div className={cn('shrink-0 space-y-2 border-t border-border/60 p-3', !expanded && 'flex flex-col items-center')}>
              <div className={cn('flex w-full items-center gap-2', !expanded ? 'flex-col' : 'justify-between')}>
                <NotificationCenter
                  open={notificationsOpen}
                  onOpenChange={(open) => {
                    setNotificationsOpen(open);
                    if (open) { cancelClose(); setHovered(true); }
                    else if (!pointerInsideRef.current && !profileOpen) scheduleClose();
                  }}
                />
                <button
                  className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground', !expanded ? 'h-10 w-10 justify-center px-0' : 'flex-1')}
                  onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
                  title={theme === 'dark' ? 'Ativar Modo Claro' : 'Ativar Modo Escuro'}
                >
                  {theme === 'dark' ? <Sun className="h-4.5 w-4.5 shrink-0 text-amber-400" /> : <Moon className="h-4.5 w-4.5 shrink-0 text-indigo-400" />}
                  {expanded && <span className="whitespace-nowrap">{theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}</span>}
                </button>
              </div>

              {user && (
                <DropdownMenu
                  open={profileOpen}
                  onOpenChange={(open) => {
                    setProfileOpen(open);
                    if (open) { cancelClose(); setHovered(true); }
                    else if (!pointerInsideRef.current && !notificationsOpen) scheduleClose();
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <button className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-secondary focus:outline-none', !expanded && 'justify-center')} title={!expanded ? (user.name || user.email) : undefined}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#76FB91] text-sm font-extrabold text-black shadow-sm">{userInitials}</span>
                      {expanded && <span className="min-w-0 flex-1 text-left"><span className="block truncate text-xs font-bold leading-tight">{user.name || user.email}</span><span className="mt-0.5 block truncate text-[10px] capitalize leading-none text-muted-foreground">{user.role || 'Operador'}</span></span>}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="end" className="mb-2 w-52 rounded-2xl border border-border/80 bg-card p-1 shadow-md">
                    <div className="mb-1 border-b border-border/65 px-3 py-2 text-xs"><p className="truncate font-semibold">{user.name || user.email}</p><p className="mt-0.5 capitalize text-muted-foreground">{user.role || 'Operador'}</p></div>
                    <DropdownMenuItem onClick={logout} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-destructive focus:bg-destructive/10 focus:text-destructive"><LogOut className="h-4 w-4" /> Sair do sistema</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </aside>
        </div>
      )}

      <div className={cn('flex min-w-0 flex-1 flex-col overflow-hidden', kiosk && 'w-full')}>
        {!kiosk && (
          <header className={cn('relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-border/60 bg-card px-4 transition-colors', mobileOnlyClass)}>
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/80 bg-card transition-all hover:bg-secondary active:scale-95" aria-label="Abrir menu"><Menu className="h-5 w-5" /></button>
              <Link to="/" className="flex items-center gap-2"><LeoLogo size="sm" className="shrink-0" /><span className="font-display text-base font-bold">Leo Flow</span></Link>
            </div>
            <div className="flex items-center gap-2">
              <NotificationCenter />
              <button className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/80 bg-card text-muted-foreground transition-all hover:text-foreground active:scale-95" onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))} aria-label="Alternar tema">
                {theme === 'dark' ? <Sun className="h-4.5 w-4.5 text-amber-400" /> : <Moon className="h-4.5 w-4.5 text-indigo-400" />}
              </button>
            </div>
          </header>
        )}

        <AnimatePresence>
          {!kiosk && mobileOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} className={cn('fixed inset-0 z-40 bg-black', mobileOnlyClass)} />
              <motion.aside initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className={cn('fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-border/60 bg-card p-5', mobileOnlyClass)} aria-label="Menu móvel">
                <div className="mb-4 flex shrink-0 items-center justify-between border-b border-border/60 pb-4"><Link to="/" className="flex items-center gap-2"><LeoLogo size="sm" /><span className="font-display text-base font-bold">Leo Flow</span></Link><button onClick={() => setMobileOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-secondary" aria-label="Fechar menu"><X className="h-5 w-5 text-muted-foreground" /></button></div>
                <nav className="flex-1 space-y-4 overflow-y-auto pr-1"><NavigationGroups items={visibleNav} pathname={location.pathname} expanded mobile onNavigate={() => setMobileOpen(false)} /></nav>
                <div className="mt-auto shrink-0 border-t border-border/60 pt-4">
                  {user && <div className="mb-3 flex items-center gap-3 rounded-xl bg-secondary/50 p-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#76FB91] text-sm font-extrabold text-black">{userInitials}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{user.name || user.email}</span><span className="mt-0.5 block truncate text-[10px] capitalize leading-none text-muted-foreground">{user.role || 'Operador'}</span></span></div>}
                  <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-destructive transition-colors hover:bg-destructive/10"><LogOut className="h-5 w-5" /> Sair do sistema</button>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <main className="min-w-0 flex-1 overflow-y-auto" data-testid="app-content"><Outlet /></main>
      </div>
      {user && <LeoAssistantChat user={user} />}
    </div>
  );
}

function NavigationGroups({ items, pathname, expanded, mobile = false, onNavigate }) {
  return Object.entries(routeGroups).map(([groupKey, groupLabel]) => {
    const groupItems = items.filter((item) => item.group === groupKey);
    if (groupItems.length === 0) return null;
    return (
      <div key={groupKey} className="space-y-1">
        {expanded && <h4 className={cn('mb-2 mt-2 text-[9px] font-bold uppercase leading-none tracking-widest text-muted-foreground opacity-65', mobile ? 'px-4' : 'px-3')}>{groupLabel}</h4>}
        {groupItems.map((item) => {
          const active = pathname === item.path || item.aliases?.some((alias) => pathname === alias.split('?')[0]);
          const Icon = item.icon;
          return (
            <Link key={item.path} to={item.path} onClick={onNavigate} title={!expanded ? item.label : undefined} className={cn('group flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-200', mobile ? 'px-4 py-3' : 'px-3 py-2.5', !expanded && 'justify-center', active ? 'border border-[#76FB91]/30 bg-[#76FB91]/20 font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}>
              <Icon className={cn('h-4.5 w-4.5 shrink-0 transition-transform duration-200 group-hover:scale-110', active && 'text-[#2d9c4a]')} />
              {expanded && <span className="truncate whitespace-nowrap">{item.label}</span>}
            </Link>
          );
        })}
      </div>
    );
  });
}
