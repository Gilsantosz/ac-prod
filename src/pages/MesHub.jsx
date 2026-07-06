import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Cpu, LayoutDashboard, PlusCircle, Layers, Plug, GitFork,
  Box, Truck, BellRing, ClipboardList, Shield, HardDrive,
  ArrowRight, Activity, Bell, AlertTriangle
} from 'lucide-react';

export default function MesHub() {
  // ─── Query: KPIs Rápidos ──────────────────────────────────────────
  const { data: counts = { lotsInProgress: 0, activeAlerts: 0, openVolumes: 0, pendingShipments: 0 } } = useQuery({
    queryKey: ['mes-hub-kpis'],
    queryFn: async () => {
      const [lots, alerts, volumes, shipments] = await Promise.all([
        supabase.from('production_lots').select('id', { count: 'exact' }).eq('status', 'in_progress'),
        supabase.from('alert_logs').select('id', { count: 'exact' }).eq('resolved', false),
        supabase.from('packing_volumes').select('id', { count: 'exact' }).eq('status', 'open'),
        supabase.from('shipments').select('id', { count: 'exact' }).eq('status', 'pending')
      ]);

      return {
        lotsInProgress: lots.count || 0,
        activeAlerts: alerts.count || 0,
        openVolumes: volumes.count || 0,
        pendingShipments: shipments.count || 0
      };
    },
    refetchInterval: 15000 // atualiza a cada 15 segundos
  });

  const cards = [
    {
      title: 'PCP / Retaguarda',
      description: 'Importação, liberação de planos de corte e ordens',
      icon: Plug,
      path: '/pcp',
      group: 'PCP e Engenharia',
      status: 'Operando',
      badgeColor: 'bg-emerald-500/10 text-emerald-500',
      info: 'Importe arquivos XML/CSV e crie lotes de produção.'
    },
    {
      title: 'Rotas Produtivas',
      description: 'Sequenciamento lógico de postos produtivos',
      icon: GitFork,
      path: '/rotas-produtivas',
      group: 'PCP e Engenharia',
      status: 'Configurável',
      badgeColor: 'bg-indigo-500/10 text-indigo-500',
      info: 'Mapeie o fluxo das peças entre Corte, Bordo, Usinagem e Embalagem.'
    },
    {
      title: 'Coleta / Bipagem',
      description: 'Lançamento de leituras físicas nas células',
      icon: PlusCircle,
      path: '/coleta',
      group: 'Operação',
      status: `${counts.lotsInProgress} Lotes Ativos`,
      badgeColor: 'bg-green-500/10 text-green-500',
      info: 'Bipagem e registro de peças por scanner de barras ou RFID.'
    },
    {
      title: 'Rastreabilidade Geral',
      description: 'Monitoramento do fluxo Kanban e histórico',
      icon: Layers,
      path: '/rastreabilidade',
      group: 'Operação',
      status: 'Tempo Real',
      badgeColor: 'bg-blue-500/10 text-blue-500',
      info: 'Acompanhe gargalos, gargalo geral e progresso das etapas.'
    },
    {
      title: 'Embalagem',
      description: 'Fechamento de volumes e Scan-to-Pack',
      icon: Box,
      path: '/embalagem',
      group: 'Chão de Fábrica MES',
      status: `${counts.openVolumes} Volumes Abertos`,
      badgeColor: counts.openVolumes > 0 ? 'bg-amber-500/10 text-amber-500' : 'bg-secondary/40 text-muted-foreground',
      info: 'Bipe peças dentro das caixas e gere etiquetas de volume.'
    },
    {
      title: 'Expedição',
      description: 'Checklist obrigatório contra carregamentos incompletos',
      icon: Truck,
      path: '/expedicao',
      group: 'Chão de Fábrica MES',
      status: `${counts.pendingShipments} Remessas`,
      badgeColor: counts.pendingShipments > 0 ? 'bg-amber-500/10 text-amber-500' : 'bg-secondary/40 text-muted-foreground',
      info: 'Verifique volumes antes do despacho físico da mercadoria.'
    },
    {
      title: 'Alertas MES',
      description: 'Diagnósticos de atrasos e retenção temporal',
      icon: BellRing,
      path: '/alertas-mes',
      group: 'Chão de Fábrica MES',
      status: counts.activeAlerts > 0 ? `${counts.activeAlerts} Ativos` : 'Zero Alertas',
      badgeColor: counts.activeAlerts > 0 ? 'bg-rose-500/15 text-rose-500 font-bold animate-pulse' : 'bg-emerald-500/10 text-emerald-500',
      info: 'Monitore peças paradas por tempo excessivo em postos produtivos.'
    },
    {
      title: 'Backups & Logs',
      description: 'Segurança, conformidade de 4 anos e auditoria',
      icon: Shield,
      path: '/downloads-backups',
      group: 'Administração',
      status: 'Conforme',
      badgeColor: 'bg-emerald-500/10 text-emerald-500',
      info: 'Audite logs do sistema e garanta redundância de dados.'
    }
  ];

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Central MES Operacional"
        subtitle="Hub unificado para fluxo completo de produção, monitoramento de postos e controle físico do chão de fábrica."
        icon={Cpu}
      />

      {/* Grid de Métricas do Hub */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MiniCard title="Lotes em Andamento" value={counts.lotsInProgress} icon={Activity} color="text-blue-500 bg-blue-500/5 border-blue-500/20" />
        <MiniCard title="Alertas de Retenção" value={counts.activeAlerts} icon={Bell} color={counts.activeAlerts > 0 ? "text-rose-500 bg-rose-500/5 border-rose-500/20" : "text-emerald-500 bg-emerald-500/5 border-emerald-500/20"} />
        <MiniCard title="Volumes em Coleta" value={counts.openVolumes} icon={Box} color="text-amber-500 bg-amber-500/5 border-amber-500/20" />
        <MiniCard title="Cargas Pendentes" value={counts.pendingShipments} icon={Truck} color="text-indigo-500 bg-indigo-500/5 border-indigo-500/20" />
      </div>

      {/* Agrupamento por Categoria */}
      <div className="space-y-6 pt-2">
        {['PCP e Engenharia', 'Operação', 'Chão de Fábrica MES', 'Administração'].map(group => {
          const groupCards = cards.filter(c => c.group === group);
          return (
            <div key={group} className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40 pb-1.5">
                {group}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {groupCards.map(card => {
                  const Icon = card.icon;
                  return (
                    <Card key={card.title} className="border-border/60 hover:border-border/95 bg-card hover:bg-secondary/15 transition-all duration-200 group flex flex-col justify-between overflow-hidden relative">
                      <div className="absolute top-0 right-0 p-3 opacity-15 group-hover:opacity-30 group-hover:scale-110 transition-all duration-200">
                        <Icon className="w-12 h-12 text-foreground" />
                      </div>
                      
                      <CardHeader className="p-4 pb-2 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <Badge className={card.badgeColor}>{card.status}</Badge>
                        </div>
                        <CardTitle className="text-sm font-bold text-foreground pt-1.5">
                          {card.title}
                        </CardTitle>
                        <CardDescription className="text-[11px] leading-tight min-h-[32px]">
                          {card.description}
                        </CardDescription>
                      </CardHeader>

                      <CardContent className="p-4 pt-1 space-y-3">
                        <p className="text-[10px] text-muted-foreground leading-normal min-h-[30px]">
                          {card.info}
                        </p>
                        <Button asChild className="w-full text-xs h-8 bg-secondary hover:bg-secondary/80 text-foreground justify-between">
                          <Link to={card.path}>
                            <span>Abrir Módulo</span>
                            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                          </Link>
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniCard({ title, value, icon: Icon, color }) {
  return (
    <div className={`p-4 border rounded-2xl flex items-center justify-between gap-3 bg-card ${color}`}>
      <div>
        <p className="text-[10px] text-muted-foreground font-medium leading-none">{title}</p>
        <p className="text-2xl font-bold mt-1 text-foreground">{value}</p>
      </div>
      <div className="p-2 rounded-xl bg-background/50">
        <Icon className="w-5 h-5 shrink-0" />
      </div>
    </div>
  );
}
