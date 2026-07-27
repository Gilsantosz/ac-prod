/**
 * AC.Prod MES — Configuração Centralizada de Rotas e Navegação
 * 
 * Fonte única de verdade para rotas, permissões e estrutura do menu lateral.
 * Facilita a manutenção, RLS no frontend e enquadramento visual.
 */

import {
  LayoutDashboard, PlusCircle, ClipboardList, Gauge, Boxes,
  Layers, Plug, AlertOctagon, Trophy, LineChart, BrainCircuit,
  Zap, Users, Shield, HardDrive, Truck, Box, BellRing, FolderKanban, GitFork, Cpu, ShieldCheck, Wrench, HardHat, Edit3,
  ChartNoAxesCombined, RotateCcw, ShieldAlert
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
    path: '/acompanhamento-lotes',
    label: 'Acompanhamento de Lotes',
    description: 'Dashboard de andamento e previsão dos lotes gerais até a separação',
    icon: ChartNoAxesCombined,
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
    path: '/baixa-manual',
    label: 'Entradas Manuais',
    description: 'Lançamento de produção manual quantitativa por Lote Geral e Célula com baixa em cascata',
    icon: Edit3,
    group: 'pcp',
    permission: 'register_manual_production',
    showInSidebar: true,
    showInDashboardHub: true,
    aliases: ['/entrada-manual', '/lancamento-manual', '/pcp/manual']
  },
  {
    path: '/rotas-produtivas',
    label: 'Rotas Produtivas',
    description: 'Configuração e templates de sequência produtiva das peças',
    icon: GitFork,
    group: 'pcp',
    permission: 'manage_routes',
    showInSidebar: false,
    showInDashboardHub: false
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
  {
    path: '/reposicao',
    label: 'Reposição',
    description: 'Gestão de ordens de reposição de peças reprovadas e acompanhamento',
    icon: RotateCcw,
    group: 'mes',
    permission: 'view_replacements',
    showInSidebar: true,
    showInDashboardHub: true
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
    path: '/qualidade',
    label: 'Qualidade',
    description: 'Catálogo de defeitos 6M, gestão de não conformidades, 5W2H e indicadores Pareto/FPY',
    icon: ShieldAlert,
    group: 'management',
    permission: 'view_quality',
    showInSidebar: true,
    showInDashboardHub: true
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
    description: 'Gestão de usuários administrativos, e-mails e permissões de acesso',
    icon: Users,
    group: 'admin',
    permission: 'manage_users',
    showInSidebar: true,
    showInDashboardHub: true
  },
  {
    path: '/operadores',
    label: 'Operadores',
    description: 'Gestão de operadores da fábrica, turnos e postos autorizados',
    icon: HardHat,
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
  }
];

const PAGE_ACCESS_OVERRIDES = {
  '/': { viewPermission: 'view_dashboards' },
  '/coleta': { viewPermission: 'view_collection', editPermission: 'traceability_collect' },
  '/rastreabilidade': { viewPermission: 'view_traceability' },
  '/integridade-lote': { viewPermission: 'view_traceability', editPermission: 'manage_lot_integrity' },
  '/acompanhamento-lotes': { viewPermission: 'view_traceability' },
  '/marcenaria': { viewPermission: 'view_joinery', editPermission: 'manage_joinery', legacyViewPermission: 'view_traceability' },
  '/oee': { viewPermission: 'view_oee', legacyViewPermission: 'view_dashboards' },
  '/pcp': { viewPermission: 'view_pcp', editPermission: 'manage_pcp' },
  '/pcp/importar': { viewPermission: 'view_pcp', editPermission: 'manage_pcp' },
  '/pcp/ordens': { viewPermission: 'view_pcp', editPermission: 'manage_pcp' },
  '/baixa-manual': { viewPermission: 'view_manual_production', editPermission: 'register_manual_production' },
  '/rotas-produtivas': { viewPermission: 'view_routes', editPermission: 'manage_routes' },
  '/embalagem': { viewPermission: 'view_packaging', editPermission: 'manage_packaging' },
  '/expedicao': { viewPermission: 'view_shipping', editPermission: 'manage_shipping' },
  '/alertas-mes': { viewPermission: 'view_mes_alerts', editPermission: 'resolve_mes_alerts' },
  '/resumo-diario': { viewPermission: 'view_daily_summary', editPermission: 'send_reports', legacyViewPermission: 'view_dashboards' },
  '/relatorios': { viewPermission: 'view_reports', editPermission: 'send_reports' },
  '/ocorrencias': { viewPermission: 'view_occurrences', editPermission: 'manage_occurrences' },
  '/ia-operacional': { viewPermission: 'view_ai', editPermission: 'ai_operations' },
  '/automacoes': { viewPermission: 'view_automations', editPermission: 'manage_automations' },
  '/gamificacao': { viewPermission: 'view_gamification', legacyViewPermission: 'view_dashboards' },
  '/usuarios': { viewPermission: 'view_users', editPermission: 'manage_users' },
  '/operadores': { viewPermission: 'view_operators', editPermission: 'manage_operators' },
  '/celulas-metas': { viewPermission: 'view_cells', editPermission: 'manage_cells' },
  '/logs-sistema': { viewPermission: 'view_audit_logs', adminOnly: true },
  '/downloads-backups': { viewPermission: 'view_backups', editPermission: 'manage_backups', adminOnly: true },
  '/logs-integridade': { viewPermission: 'view_integrity_logs' },
  '/reposicao': { viewPermission: 'view_replacements', editPermission: 'manage_replacements' },
  '/qualidade': { viewPermission: 'view_quality', editPermission: 'manage_quality' },
};

export const routeAccessCatalog = appRoutes
  .map((route) => ({
    ...route,
    ...(PAGE_ACCESS_OVERRIDES[route.path] || {
      viewPermission: route.permission,
      editPermission: null,
    }),
  }));

export const pageAccessCatalog = routeAccessCatalog.filter((route) => route.showInSidebar);

const normalizePath = (path = '/') => {
  const cleanPath = String(path).split('?')[0].replace(/\/$/, '') || '/';
  const direct = appRoutes.find((route) => route.path === cleanPath);
  if (direct) return direct.path;
  const alias = appRoutes.find((route) => route.aliases?.some((candidate) => candidate.split('?')[0] === cleanPath));
  if (alias) return alias.path;
  if (cleanPath.startsWith('/pcp/')) return '/pcp';
  if (cleanPath.startsWith('/rastreabilidade/')) return '/rastreabilidade';
  return cleanPath;
};

export const getRouteAccess = (path) => {
  const normalized = normalizePath(path);
  return routeAccessCatalog.find((route) => route.path === normalized)
    || {
      path: normalized,
      viewPermission: null,
      editPermission: null,
    };
};

const getPermissionValue = (user, permission, legacyPermission) => {
  if (!permission) return true;
  if (user?.role === 'admin') return true;
  if (user?.permissions?.[permission] !== undefined) return user.permissions[permission] === true;
  if (legacyPermission && user?.permissions?.[legacyPermission] !== undefined) {
    return user.permissions[legacyPermission] === true;
  }
  const defaults = getDefaultPermissions(user?.role || 'operator');
  if (defaults[permission] !== undefined) return defaults[permission] === true;
  return legacyPermission ? defaults[legacyPermission] === true : false;
};

export const canUserViewRoute = (user, path) => {
  const access = getRouteAccess(path);
  if (access.adminOnly && user?.role !== 'admin') return false;
  return getPermissionValue(user, access.viewPermission, access.legacyViewPermission || access.editPermission);
};

export const canUserEditRoute = (user, path) => {
  const access = getRouteAccess(path);
  if (!access.editPermission) return false;
  if (access.adminOnly && user?.role !== 'admin') return false;
  return getPermissionValue(user, access.editPermission);
};

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
  ai_operations: 'IA Operacional e Insights',
  // Novas permissões Reposição, Qualidade e Paradas
  view_replacements: 'Visualizar Ordens de Reposição',
  manage_replacements: 'Gerenciar Ordens de Reposição',
  approve_replacements: 'Aprovar e Liberar Reposições',
  view_quality: 'Visualizar Qualidade e Não Conformidades',
  manage_quality: 'Gerenciar Qualidade e Ações 5W2H',
  close_quality_nonconformities: 'Encerrar Não Conformidades',
  register_downtime: 'Registrar Paradas na Coleta',
  manage_downtime_reasons: 'Gerenciar Motivos de Parada',
  correct_downtime: 'Corrigir Lançamentos de Parada'
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

export const getDefaultPermissions = (role) => {
  if (role === 'admin') {
    return {
      view_dashboards: true,
      register_production: true,
      manage_occurrences: true,
      manage_cells: true,
      manage_operators: true,
      view_reports: true,
      ai_operations: true,
      manage_automations: true,
      manage_users: true,
      view_pcp: true,
      manage_pcp: true,
      register_manual_production: true,
      manage_routes: true,
      traceability_collect: true,
      view_traceability: true,
      manage_packaging: true,
      manage_shipping: true,
      view_mes_alerts: true,
      send_reports: true,
      schedule_reports: true,
      manage_report_recipients: true,
      view_report_delivery_logs: true,
      manage_email_settings: true,
      view_audit_logs: true,
      view_replacements: true,
      manage_replacements: true,
      approve_replacements: true,
      view_quality: true,
      manage_quality: true,
      close_quality_nonconformities: true,
      register_downtime: true,
      manage_downtime_reasons: true,
      correct_downtime: true,
    };
  } else if (role === 'manager') {
    return {
      view_dashboards: true,
      register_production: true,
      manage_occurrences: true,
      manage_cells: false,
      manage_operators: false,
      view_reports: true,
      ai_operations: true,
      manage_automations: false,
      manage_users: false,
      view_pcp: true,
      manage_pcp: true,
      register_manual_production: true,
      manage_routes: true,
      traceability_collect: true,
      view_traceability: true,
      manage_packaging: true,
      manage_shipping: true,
      view_mes_alerts: true,
      send_reports: true,
      schedule_reports: true,
      manage_report_recipients: true,
      view_report_delivery_logs: true,
      manage_email_settings: false,
      view_audit_logs: false,
      view_replacements: true,
      manage_replacements: true,
      approve_replacements: true,
      view_quality: true,
      manage_quality: true,
      close_quality_nonconformities: true,
      register_downtime: true,
      manage_downtime_reasons: true,
      correct_downtime: true,
    };
  } else if (role === 'supervisor') {
    return {
      view_dashboards: true,
      register_production: true,
      manage_occurrences: true,
      manage_cells: false,
      manage_operators: false,
      view_reports: true,
      ai_operations: false,
      manage_automations: false,
      manage_users: false,
      view_pcp: true,
      manage_pcp: false,
      register_manual_production: true,
      manage_routes: false,
      traceability_collect: true,
      view_traceability: true,
      manage_packaging: false,
      manage_shipping: false,
      view_mes_alerts: true,
      send_reports: true,
      schedule_reports: false,
      manage_report_recipients: false,
      view_report_delivery_logs: false,
      manage_email_settings: false,
      view_audit_logs: false,
      view_replacements: true,
      manage_replacements: true,
      approve_replacements: true,
      view_quality: true,
      manage_quality: true,
      close_quality_nonconformities: false,
      register_downtime: true,
      manage_downtime_reasons: false,
      correct_downtime: true,
    };
  } else if (role === 'viewer') {
    return {
      view_dashboards: true,
      register_production: false,
      manage_occurrences: false,
      manage_cells: false,
      manage_operators: false,
      view_reports: true,
      ai_operations: false,
      manage_automations: false,
      manage_users: false,
      view_pcp: true,
      manage_pcp: false,
      register_manual_production: false,
      manage_routes: false,
      traceability_collect: false,
      view_traceability: true,
      manage_packaging: false,
      manage_shipping: false,
      view_mes_alerts: true,
      send_reports: false,
      schedule_reports: false,
      manage_report_recipients: false,
      view_report_delivery_logs: false,
      manage_email_settings: false,
      view_audit_logs: false,
      view_replacements: true,
      manage_replacements: false,
      approve_replacements: false,
      view_quality: true,
      manage_quality: false,
      close_quality_nonconformities: false,
      register_downtime: false,
      manage_downtime_reasons: false,
      correct_downtime: false,
    };
  } else {
    // operator / user
    return {
      view_dashboards: true,
      register_production: true,
      manage_occurrences: true,
      manage_cells: false,
      manage_operators: false,
      view_reports: false,
      ai_operations: false,
      manage_automations: false,
      manage_users: false,
      view_pcp: false,
      manage_pcp: false,
      register_manual_production: true,
      manage_routes: false,
      traceability_collect: true,
      view_traceability: true,
      manage_packaging: false,
      manage_shipping: false,
      view_mes_alerts: false,
      send_reports: false,
      schedule_reports: false,
      manage_report_recipients: false,
      view_report_delivery_logs: false,
      manage_email_settings: false,
      view_audit_logs: false,
      view_replacements: true,
      manage_replacements: true,
      approve_replacements: false,
      view_quality: false,
      manage_quality: false,
      close_quality_nonconformities: false,
      register_downtime: true,
      manage_downtime_reasons: false,
      correct_downtime: false,
    };
  }
};
