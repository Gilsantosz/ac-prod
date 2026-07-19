import React from 'react'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';

import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import { Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute';
import { Toaster as SonnerToaster } from 'sonner';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import AppLayout from '@/components/layout/AppLayout';
import KioskLayout from '@/components/layout/KioskLayout';
import KioskDashboard from '@/pages/KioskDashboard';
import Dashboard from '@/pages/Dashboard';
import DailySummary from '@/pages/DailySummary';
import OEE from '@/pages/OEE';
import Entry from '@/pages/Entry';
import Occurrences from '@/pages/Occurrences';
import Automations from '@/pages/Automations';
import CellsAndGoals from '@/pages/CellsAndGoals';
import Gamification from '@/pages/Gamification';
import Reports from '@/pages/Reports';
import Users from '@/pages/Users';
import Operators from '@/pages/Operators';
import Traceability from '@/pages/Traceability';
import PromobIntegration from '@/pages/PromobIntegration';
import SystemLogs from '@/pages/SystemLogs';
import DownloadsBackups from '@/pages/DownloadsBackups';
import AiOperations from '@/pages/AiOperations';
import ProductionRoutes from '@/pages/ProductionRoutes';
import MesHub from '@/pages/MesHub';
import CollectionPage from '@/pages/CollectionPage';
import PackagingPage from '@/pages/PackagingPage';
import ShippingPage from '@/pages/ShippingPage';
import MesAlertsPage from '@/pages/MesAlertsPage';
import LotIntegrity from '@/pages/LotIntegrity';
import IntegrityLogs from '@/pages/IntegrityLogs';
import JoineryPage from '@/pages/JoineryPage';
import { useProductionRealtimeSync } from '@/hooks/useProductionRealtimeSync';
import { isSupabaseConfigured } from '@/lib/supabaseClient';


const AcProdRedirect = () => {
  const location = useLocation();
  const cleanPath = location.pathname.replace(/^\/ac-prod/, '');
  const target = cleanPath === '' ? '/' : cleanPath;
  return <Navigate to={target} replace />;
};

const MissingSupabaseConfiguration = () => (
  <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-5">
    <section className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900/80 p-6 md:p-9 shadow-2xl">
      <div className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-300">
        Configuração necessária
      </div>
      <h1 className="mt-5 text-2xl md:text-3xl font-bold">O simulador abriu corretamente</h1>
      <p className="mt-3 text-sm md:text-base leading-relaxed text-slate-300">
        Falta somente informar a conexão pública do Supabase. Nenhum dado de produção será enviado enquanto essa configuração estiver ausente.
      </p>
      <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950 p-4 font-mono text-sm text-emerald-300 space-y-2 overflow-x-auto">
        <p>cp .env.example .env</p>
        <p>npm install</p>
        <p>npm run dev</p>
      </div>
      <p className="mt-5 text-sm text-slate-400">
        No arquivo <strong className="text-slate-200">.env</strong>, preencha <strong className="text-slate-200">VITE_SUPABASE_URL</strong> e <strong className="text-slate-200">VITE_SUPABASE_ANON_KEY</strong>. O passo a passo completo está em GUIA_IMPLANTACAO_COLETA_PCP.md.
      </p>
    </section>
  </main>
);




const AuthenticatedApp = () => {
  const { isLoadingAuth, authError, navigateToLogin } = useAuth();
  useProductionRealtimeSync({ enabled: !isLoadingAuth && !authError });

  // Show loading spinner while checking auth
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/ac-prod/*" element={<AcProdRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route path="/quiosque" element={
          <KioskLayout>
            <KioskDashboard />
          </KioskLayout>
        } />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/painel" element={<Navigate to="/" replace />} />
          <Route path="/resumo-diario" element={<DailySummary />} />
          <Route path="/oee" element={<OEE />} />
          <Route path="/entrada" element={<Entry />} />
          <Route path="/coleta-rastreabilidade" element={<Navigate to="/entrada?modo=coleta" replace />} />
          <Route path="/ocorrencias" element={<Occurrences />} />
          <Route path="/analise-paradas" element={<Navigate to="/ocorrencias" replace />} />
          <Route path="/analise-tendencia" element={<Navigate to="/relatorios?tab=trend" replace />} />
          <Route path="/automacoes" element={<Automations />} />
          <Route path="/celulas-metas" element={<CellsAndGoals />} />
          <Route path="/gamificacao" element={<Gamification />} />
          <Route path="/operadores" element={<Operators />} />
          <Route path="/metas" element={<Navigate to="/celulas-metas" replace />} />
          <Route path="/celulas" element={<Navigate to="/celulas-metas" replace />} />
          <Route path="/usuarios" element={<Users />} />
          <Route path="/relatorios" element={<Reports />} />
          <Route path="/ia-operacional" element={<AiOperations />} />
           {/* ── Novas rotas MES Leo Madeiras ── */}
          <Route path="/rastreabilidade" element={<Traceability />} />
          <Route path="/rastreabilidade/kanban" element={<Navigate to="/rastreabilidade?tab=kanban" replace />} />
          <Route path="/rastreabilidade/buscar" element={<Navigate to="/rastreabilidade?tab=search" replace />} />
          <Route path="/rastreabilidade/historico" element={<Navigate to="/rastreabilidade?tab=timeline" replace />} />
          <Route path="/rastreabilidade/marcenaria" element={<Navigate to="/marcenaria" replace />} />
          <Route path="/rastreabilidade/embalagem" element={<Navigate to="/rastreabilidade?tab=packaging" replace />} />
          <Route path="/rastreabilidade/expedicao" element={<Navigate to="/rastreabilidade?tab=shipping" replace />} />
          <Route path="/rastreabilidade/alertas" element={<Navigate to="/rastreabilidade?tab=alerts" replace />} />

          <Route path="/pcp" element={<PromobIntegration />} />
          <Route path="/pcp/importar" element={<Navigate to="/pcp?tab=import" replace />} />
          <Route path="/pcp/historico" element={<Navigate to="/pcp?tab=history" replace />} />
          <Route path="/pcp/ordens" element={<Navigate to="/pcp?tab=orders" replace />} />
          <Route path="/pcp/logs" element={<Navigate to="/pcp?tab=logs" replace />} />
          <Route path="/pcp/backups" element={<Navigate to="/pcp?tab=backup" replace />} />
          <Route path="/pcp/configuracoes" element={<Navigate to="/pcp?tab=settings" replace />} />

          <Route path="/coleta" element={<CollectionPage />} />
          <Route path="/embalagem" element={<PackagingPage />} />
          <Route path="/expedicao" element={<ShippingPage />} />
          <Route path="/alertas-mes" element={<MesAlertsPage />} />

          <Route path="/rotas-produtivas" element={<ProductionRoutes />} />
          <Route path="/marcenaria" element={<JoineryPage />} />
          <Route path="/mes" element={<MesHub />} />
          <Route path="/integridade-lote" element={<LotIntegrity />} />
          <Route path="/logs-integridade" element={<IntegrityLogs />} />

          <Route path="/integracoes/promob" element={<Navigate to="/pcp" replace />} />
          <Route path="/logs-sistema" element={<SystemLogs />} />
          <Route path="/downloads-backups" element={<DownloadsBackups />} />
          <Route path="/backups" element={<Navigate to="/downloads-backups" replace />} />
          <Route path="/ordens-producao" element={<Navigate to="/pcp?tab=orders" replace />} />
          {/* Aliases de compatibilidade */}
          <Route path="/coleta-codigo-rfid" element={<Navigate to="/coleta" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {
  React.useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;

    let refreshing = false;
    let intervalId;
    let registration;

    const handleControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    const checkForUpdate = () => {
      registration?.update().catch((err) => {
        console.error('Erro ao verificar atualizações do Service Worker:', err);
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    window.addEventListener('focus', checkForUpdate);
    window.addEventListener('online', checkForUpdate);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    navigator.serviceWorker.ready.then((readyRegistration) => {
      registration = readyRegistration;
      checkForUpdate();
      intervalId = window.setInterval(checkForUpdate, 1000 * 60 * 5);
    });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      window.removeEventListener('focus', checkForUpdate);
      window.removeEventListener('online', checkForUpdate);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  if (!isSupabaseConfigured) {
    return <MissingSupabaseConfiguration />;
  }

  const routerBase = import.meta.env.BASE_URL === '/'
    ? ''
    : import.meta.env.BASE_URL.replace(/\/$/, '');

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router basename={routerBase}>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>

        <Toaster />
        <SonnerToaster position="top-right" richColors />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
