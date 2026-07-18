/**
 * AC.Prod MES — Configuração Centralizada de Rotas e Navegação
 * 
 * Fonte única de verdade para rotas, permissões e estrutura do menu lateral.
 * Facilita a manutenção, RLS no frontend e enquadramento visual.
 */

import {
  LayoutDashboard, PlusCircle, ClipboardList, Gauge, Boxes,
  Layers, Plug, AlertOctagon, Trophy, LineChart, BrainCircuit,
  Zap, Users, Shield, HardDrive, Truck, Box, BellRing, FolderKanban, GitFork, Cpu, ShieldCheck, Wrench
} from 'lucide-react';

export const routeGroups = {
  operation:   'Operação',
  pcp:         'PCP e Engenharia',
  mes:         'Chão de Fábrica MES',
  management:  'Gestão',
  admin:       'Administração'
};

export const appRoutes = [
  // ─── GRUPO 1: OPERAÇÃO ──────────────────────────────────────────────
  {
    path: '/',
    label: 'Painéis',
    description: 'Dashboard principal com KPIs de produção e eficiência',
    icon: LayoutDashboard,
    group: 'operation',
    permission: 'view_dashboards',
    showInSidebar: true,
    showInDashboardHub: true
  },
  {
    path: '/coleta',
    label: 'Coleta / Bipagem',
    description: 'Entrada física de produção por código de barras, QR ou RFID',
    icon: PlusCircle,
    group: 'operation',
    permission: 'traceability_collect',
    showInSidebar: true,
    showInDashboardHub: true,
    aliases: ['/coleta-rastreabilidade', '/coleta-codigo-rfid', '/entrada?modo=coleta']
  },
  {
    path: '/rastreabilidade',
    label: 'Rastreabilidade Geral',
    description: 'Painel Kanban, timeline de peças e busca detalhada de lotes',
    icon: Layers,
    group: 'operation',
    permission: 'view_traceability',
    showInSidebar: true,
    showInDashboardHub: true
  },
  {
    path: '/integridade-lote',
    label: 'Integridade do Lote',
    description: 'Painel de controle de integridade de lotes, gargalos e fechamento',
    icon: ShieldCheck,
    group: 'operation',
    permission: 'view_traceability',
    showInSidebar: true,
    showInDashboardHub: true
  },
  {
    path: '/marcenaria',
    label: 'Marcenaria',
    description: 'Bancada operacional de Marcenaria — gestão de peças e fluxo manual',
    icon: Wrench,
    group: 'operation',
    permission: 'view_traceability',
    showInSidebar: true,
    showInDashboardHub: true,
    aliases: ['/rastreabilidade/marcenaria']
  },
  {
    path: '/oee',
    label: 'OEE',
    description: 'Monitoramento de eficiência global de equipamentos em tempo real',
    icon: Gauge,
    group: 'operation',
    permission: 'view_dashboards',
    showInSidebar: true,
    showInDashboardHub: true
  },


  // ─── GRUPO 2: PCP E ENGENHARIA ─────────────────────────────────────
  {
    path: '/pcp',
    label: 'PCP / Retaguarda',
    description: 'Portal PCP de importações Promob/XML, ordens e configurações',
    icon: Plug,
    group: 'pcp',
    permission: 'view_pcp',
    showInSidebar: true,
    showInDashboardHub: true,
    aliases: ['/integracoes/promob']
  },
  {
    path: '/pcp/importar',
    label: 'Importar XML/CSV',
    description: 'Carregamento de planos de corte e arquivos do Promob',
    icon: PlusCircle,
    group: 'pcp',
    permission: 'manage_pcp',
    showInSidebar: false,
    showInDashboardHub: true,
    tabTarget: 'import'
  },
  {
    path: '/pcp/ordens',
    label: 'Ordens de Produção',
    description: 'Status e gerenciamento de OPs ativas no chão de fábrica',
    icon: FolderKanban,
    group: 'pcp',
    permission: 'view_pcp',
    showInSidebar: false,
    showInDashboardHub: true,
    tabTarget: 'orders',
    aliases: ['/ordens-producao']
  },
  {
    path: '/rotas-produtivas',
    label: 'Rotas Produtivas',
    description: 'Configuração e templates de sequência produtiva das peças',
    icon: GitFork,
    group: 'pcp',
    permission: 'manage_routes',
    showInSidebar: true,
    showInDashboardHub: true
  },

  // ─── GRUPO 3: CHÃO DE FÁBRICA MES ──────────────────────────────────
  {
    path: '/embalagem',
    label: 'Embalagem',
    description: 'Criação de volumes, bipagem física de peças (Scan-to-Pack) e etiquetas',
    icon: Box,
    group: 'mes',
    permission: 'manage_packaging',
    showInSidebar: true,
    showInDashboardHub: true,
    tabTarget: 'packaging'
  },
  {
    path: '/expedicao',
    label: 'Expedição',
    description: 'Controle de carregamento por checklist de volumes e conferência rígida',
    icon: Truck,
    group: 'mes',
    permission: 'manage_shipping',
    showInSidebar: true,
    showInDashboardHub: true,
    tabTarget: 'shipping'
  },
  {
    path: '/alertas-mes',
    label: 'Alertas MES',
    description: 'Diagnósticos em tempo real de gargalos, atrasos e peças paradas',
    icon: BellRing,
    group: 'mes',
    permission: 'view_mes_alerts',
    showInSidebar: true,
    showInDashboardHub: true,
    tabTarget: 'alerts'
  },

  // ─── GRUPO 4: GESTÃO ───────────────────────────────────────────────
  {
    path: '/resumo-diario',
    label: 'Resumo Diário',
    description: 'Visualização rápida de rendimento por turno e relatórios operacionais',
    icon: ClipboardList,
    group: 'management',
    permission: 'view_dashboards',
    showInSidebar: true,
    showInDashboardHub: true
  },
  {
    path: '/relatorios',
    label: 'Relatórios',
    description: 'Métricas completas, tendências, tempos de postos e análises',
    icon: LineChart,
    group: 'management',
    permission: 'view_reports',
    showInSidebar: true,
    showInDashboardHub: true
  },
  {
    path: '/ocorrencias',
    label: 'Ocorrências',
    description: 'Apuração de paradas de máquina, refugos e retrabalhos',
    icon: AlertOctagon,
    group: 'management',
    permission: 'manage_occurrences',
    showInSidebar: true,
    showInDashboardHub: true,
    aliases: ['/analise-paradas']
  },
  {
    path: '/ia-operacional',
    label: 'IA Operacional',
    description: 'Assistência preditiva, diagnósticos automatizados e insights',
    icon: BrainCircuit,
    group: 'management',
    permission: 'ai_operations',
    showInSidebar: true,
    showInDashboardHub: true
  },
  {
    path: '/automacoes',
    label: 'Automações',
    description: 'Gatilhos de integração e avisos automáticos de processos',
    icon: Zap,
    group: 'management',
    permission: 'manage_automations',
    showInSidebar: true,
    showInDashboardHub: true
  },
  {
    path: '/gamificacao',
    label: 'Gamificação',
    description: 'Conquistas, rankings e metas participativas de produção',
    icon: Trophy,
    group: 'management',
    permission: 'view_dashboards',
    showInSidebar: true,
    showInDashboardHub: true
  },

  // ─── GRUPO 5: ADMINISTRAÇÃO ────────────────────────────────────────
  {
    path: '/usuarios',
    label: 'Usuários',
    description: 'Cadastro de operadores, perfis de acesso e sessões ativas',
    icon: Users,
    group: 'admin',
    permission: 'manage_operators',
    showInSidebar: true,
    showInDashboardHub: true
  },
  {
    path: '/celulas-metas',
    label: 'Células, Máquinas e Metas',
    description: 'Cadastre células produtivas, postos de trabalho e metas operacionais usadas na coleta, rastreabilidade e dashboards.',
    icon: Boxes,
    group: 'admin',
    permission: 'manage_cells',
    showInSidebar: true,
    showInDashboardHub: true,
    aliases: ['/celulas', '/metas', '/celulas-e-metas', '/cells-goals']
  },
  {
    path: '/logs-sistema',
    label: 'Logs do Sistema',
    description: 'Auditoria de segurança e logs de sistema (Admin Only)',
    icon: Shield,
    group: 'admin',
    permission: 'adminOnly',
    showInSidebar: true,
    showInDashboardHub: true
  },
  {
    path: '/downloads-backups',
    label: 'Backups & Drive',
    description: 'Gestão de backups na nuvem e arquivos XML/CSV (Admin Only)',
    icon: HardDrive,
    group: 'admin',
    permission: 'adminOnly',
    showInSidebar: true,
    showInDashboardHub: true
  },
  {
    path: '/logs-integridade',
    label: 'Logs de Integridade',
    description: 'Histórico e auditoria de coletas, bipes rejeitados e liberações especiais',
    icon: ClipboardList,
    group: 'admin',
    permission: 'manage_operators',
    showInSidebar: true,
    showInDashboardHub: true
  },

  // ─── CENTRAL MES OPERACIONAL ──────────────────────────────────────
  {
    path: '/mes',
    label: 'Central MES',
    description: 'Painel operacional integrado com atalhos de fluxo e gargalos',
    icon: Cpu,
    group: 'operation',
    permission: 'view_dashboards',
    showInSidebar: true,
    showInDashboardHub: false
  }
];

export const permissionLabels = {
  view_dashboards: 'Visualizar Painéis (OEE, Ocorrências)',
  register_production: 'Lançar Produção',
  manage_occurrences: 'Gerenciar Ocorrências e Paradas',
  manage_cells: 'Gerenciar Células e Metas',
  manage_operators: 'Gerenciar Operadores e Equipes',
  view_reports: 'Visualizar Relatórios Industriais',
  manage_automations: 'Gerenciar Alertas e Automações',
  // Novas permissões MES
  view_pcp: 'Visualizar PCP / Retaguarda',
  manage_pcp: 'Gerenciar PCP e Importações',
  manage_routes: 'Gerenciar Rotas Produtivas',
  traceability_collect: 'Realizar Coleta / Bipagem',
  view_traceability: 'Visualizar Rastreabilidade Geral',
  manage_packaging: 'Gerenciar Embalagem (Scan-to-Pack)',
  manage_shipping: 'Gerenciar Expedição Rígida',
  view_mes_alerts: 'Visualizar Alertas MES Chão de Fábrica',
  ai_operations: 'IA Operacional e Insights'
};

const buildPathPermissionMap = (routes) => {
  const map = {};
  routes.forEach(route => {
    if (route.permission) {
      map[route.path] = route.permission;
      if (route.aliases) {
        route.aliases.forEach(alias => {
          map[alias] = route.permission;
        });
      }
    }
  });
  
  // Mapear também sub-rotas/redirecionamentos comuns para proteção rígida
  map['/coleta-rastreabilidade'] = 'traceability_collect';
  map['/coleta-codigo-rfid'] = 'traceability_collect';
  map['/rastreabilidade/kanban'] = 'view_traceability';
  map['/rastreabilidade/buscar'] = 'view_traceability';
  map['/rastreabilidade/historico'] = 'view_traceability';
  map['/rastreabilidade/marcenaria'] = 'view_traceability';
  map['/marcenaria'] = 'view_traceability';
  map['/rastreabilidade/embalagem'] = 'manage_packaging';
  map['/rastreabilidade/expedicao'] = 'manage_shipping';
  map['/rastreabilidade/alertas'] = 'view_mes_alerts';
  
  map['/pcp/importar'] = 'manage_pcp';
  map['/pcp/historico'] = 'view_pcp';
  map['/pcp/ordens'] = 'view_pcp';
  map['/pcp/logs'] = 'view_pcp';
  map['/pcp/backups'] = 'view_pcp';
  map['/pcp/configuracoes'] = 'manage_pcp';
  
  return map;
};

export const pathPermissionMap = buildPathPermissionMap(appRoutes);

