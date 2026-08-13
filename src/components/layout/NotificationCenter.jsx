import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';

function userHasCellAccess(user, cellName) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'manager' || user.role === 'supervisor') return true;

  let userCells = [];
  try {
    if (typeof user.cells === 'string') {
      userCells = JSON.parse(user.cells);
    } else if (Array.isArray(user.cells)) {
      userCells = user.cells;
    }
  } catch {
    userCells = [user.cell];
  }

  const cleanUserCells = userCells.filter(Boolean).map((cell) => cell.trim().toLowerCase());
  if (cleanUserCells.length === 0) return true;

  return cleanUserCells.includes(cellName?.trim().toLowerCase() || '');
}

export default function NotificationCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: alerts = [] } = useQuery({
    queryKey: ['unresolvedAlerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alert_logs')
        .select('id, cell, resolved')
        .or('resolved.eq.false,resolved.is.null')
        .limit(100);

      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    staleTime: 30000,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  const count = useMemo(() => {
    if (!user) return 0;
    return alerts.filter((alert) => userHasCellAccess(user, alert.cell)).length;
  }, [alerts, user]);

  return (
    <button
      type="button"
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-card text-muted-foreground transition-all hover:text-foreground active:scale-95 focus:outline-none"
      title="Abrir Alertas MES"
      aria-label={count > 0 ? `Abrir Alertas MES: ${count} pendente${count !== 1 ? 's' : ''}` : 'Abrir Alertas MES'}
      onClick={() => navigate('/alertas-mes')}
    >
      {count > 0 ? (
        <>
          <BellRing className="h-4.5 w-4.5 animate-pulse text-rose-500" />
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-background tabular-nums">
            {count}
          </span>
        </>
      ) : (
        <Bell className="h-4.5 w-4.5" />
      )}
    </button>
  );
}
