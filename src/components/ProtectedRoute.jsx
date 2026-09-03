import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AUTH_STATES, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { Lock, ShieldAlert, ArrowLeft, LogOut } from 'lucide-react';
import { canUserViewRoute, getRouteAccess, isRouteOnStandby, permissionLabels } from '@/config/appRoutes';
import { navTo } from '@/lib/navigation';
import { recordAuthMetric } from '@/lib/authTelemetry';


const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-slate-950/20 backdrop-blur-sm">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

export default function ProtectedRoute({ fallback = <DefaultFallback />, unauthenticatedElement }) {
  const { user, isAuthenticated, isLoadingAuth, authChecked, authError, authStatus, checkUserAuth, logout } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) {
      checkUserAuth();
    }
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  useEffect(() => {
    if (authStatus === AUTH_STATES.AUTHENTICATED) {
      recordAuthMetric({ correlationId: 'route', step: 'protected_route_released', result: 'success' });
    }
  }, [authStatus]);

  if (isLoadingAuth || !authChecked) {
    return fallback;
  }

  if ([AUTH_STATES.PROFILE_LOADING, AUTH_STATES.RECONNECTING].includes(authStatus)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-950/30 backdrop-blur-sm p-4">
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-emerald-400" />
          <p className="font-semibold text-slate-100">Validando acesso</p>
          <p className="mt-1 text-sm text-slate-400">Reconectando sem encerrar sua sessão.</p>
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
    return unauthenticatedElement;
  }

  if (!isAuthenticated) {
    return unauthenticatedElement;
  }

  if (isRouteOnStandby(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  // Controle de Rota baseado em Permissões Granulares (RBAC)
  const path = location.pathname;
  let hasPermission = true;
  let requiredPermissionLabel = '';

  if (user) {
    const access = getRouteAccess(path);
    hasPermission = canUserViewRoute(user, path);
    if (!hasPermission) {
      requiredPermissionLabel = `Permissão requerida: ${permissionLabels[access.viewPermission] || access.viewPermission || 'acesso à página'}`;
    }
  }

  // Se o usuário não tiver permissão para a rota atual, renderiza a tela de Acesso Restrito
  if (!hasPermission) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
        {/* Efeito de luz ambiente de fundo */}
        <div className="absolute w-[300px] h-[300px] rounded-full bg-amber-500/10 blur-[100px] -top-10 -right-10 pointer-events-none" />
        <div className="absolute w-[300px] h-[300px] rounded-full bg-blue-500/5 blur-[100px] -bottom-10 -left-10 pointer-events-none" />

        <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-8 text-center space-y-6 shadow-2xl relative z-10">
          {/* Cadeado Brilhante */}
          <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.08)] relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/20 to-transparent" />
            <Lock className="w-7 h-7 text-amber-500 animate-pulse relative z-10" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-slate-100">Acesso Restrito</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Sua conta atual não possui privilégios necessários para acessar esta página.
            </p>
          </div>

          {requiredPermissionLabel && (
            <div className="bg-slate-950/80 border border-slate-800/60 px-4 py-3 rounded-xl text-left space-y-1.5">
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">Permissão Requerida</span>
              <span className="text-sm text-amber-400 font-medium flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                {requiredPermissionLabel}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2.5 pt-2">
            <button
              onClick={() => navTo('/')}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/10 hover:translate-y-[-1px] active:translate-y-0"
            >
              <ArrowLeft className="w-4 h-4" /> Voltar para o Painel Principal
            </button>
            <button
              onClick={() => logout()}
              className="w-full border border-slate-850 hover:bg-slate-800/40 text-slate-400 hover:text-slate-350 font-medium text-sm py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 hover:translate-y-[-1px] active:translate-y-0"
            >
              <LogOut className="w-4 h-4" /> Entrar com Outra Conta
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
