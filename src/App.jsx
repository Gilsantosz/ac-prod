import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
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
import Traceability from '@/pages/Traceability';
import PromobIntegration from '@/pages/PromobIntegration';
import SystemLogs from '@/pages/SystemLogs';
import DownloadsBackups from '@/pages/DownloadsBackups';
import AiOperations from '@/pages/AiOperations';

const AuthenticatedApp = () => {
  const { isLoadingAuth, authError, navigateToLogin } = useAuth();

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
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
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
          <Route path="/operadores" element={<Navigate to="/usuarios?tab=operators" replace />} />
          <Route path="/metas" element={<Navigate to="/celulas-metas" replace />} />
          <Route path="/celulas" element={<Navigate to="/celulas-metas" replace />} />
          <Route path="/usuarios" element={<Users />} />
          <Route path="/relatorios" element={<Reports />} />
          <Route path="/ia-operacional" element={<AiOperations />} />
          {/* ── Novas rotas MES Leo Madeiras ── */}
          <Route path="/rastreabilidade" element={<Traceability />} />
          <Route path="/integracoes/promob" element={<PromobIntegration />} />
          <Route path="/logs-sistema" element={<SystemLogs />} />
          <Route path="/downloads-backups" element={<DownloadsBackups />} />
          <Route path="/backups" element={<Navigate to="/downloads-backups" replace />} />
          <Route path="/ordens-producao" element={<Navigate to="/integracoes/promob?tab=orders" replace />} />
          {/* Aliases de compatibilidade */}
          <Route path="/coleta-codigo-rfid" element={<Navigate to="/entrada?modo=coleta" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router basename="/ac-prod">
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
