import React, { useState } from 'react';
import { 
  IndustrialPageShell, 
  IndustrialSectionCard, 
  IndustrialKpiCard, 
  IndustrialStatusBadge, 
  IndustrialActionBar, 
  IndustrialEmptyState, 
  IndustrialTimeline, 
  IndustrialDataTable, 
  IndustrialScannerInput, 
  IndustrialMobileFooterAction, 
  IndustrialProgressBar, 
  IndustrialMetricGrid, 
  IndustrialModeTabs 
} from '../index';
import { 
  Wrench, Activity, Clock, ShieldCheck, AlertTriangle, 
  Database, RefreshCw, Barcode, HelpCircle, LayoutGrid, 
  FileText 
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';

export default function IndustrialComponentsPreview() {
  // Estados para simular interações
  const [activeTab, setActiveTab] = useState('quick');
  const [scanValue, setScanValue] = useState('');
  const [scanStatus, setScanStatus] = useState('neutral');
  const [scanHelper, setScanHelper] = useState('Aguardando leitura física...');
  const [progressVal, setProgressVal] = useState(65);
  const [tableLoading, setTableLoading] = useState(false);

  // Mock de etapas para a timeline
  const timelineSteps = [
    { key: 'corte', label: 'Corte Primário', description: 'Corte automatizado de chapas', status: 'completed', meta: 'OP-10293' },
    { key: 'bordo', label: 'Colagem de Bordo', description: 'Fita de bordo termofusível', status: 'completed', meta: 'OP-10293' },
    { key: 'usinagem', label: 'Usinagem CNC', description: 'Furação e canais', status: 'active', meta: 'OP-10293' },
    { key: 'inspecao', label: 'Inspeção de Qualidade', description: 'Controle de qualidade dimensional', status: 'pending' },
    { key: 'embalagem', label: 'Embalagem', description: 'Criação do volume de entrega', status: 'pending' }
  ];

  // Mock de colunas para a tabela
  const tableColumns = [
    { key: 'id', label: 'Cód. Reg', type: 'text', className: 'font-mono text-xs w-20' },
    { key: 'timestamp', label: 'Data/Hora', type: 'text', className: 'font-mono text-xs' },
    { key: 'cell', label: 'Célula', type: 'text' },
    { key: 'produced', label: 'Qtd.', type: 'number' },
    { key: 'scrap', label: 'Ref.', type: 'number', className: 'text-red-500' },
    { key: 'status', label: 'Status', type: 'status' }
  ];

  // Mock de dados para a tabela
  const tableData = [
    { id: 'REG-001', timestamp: '19/06 08:00', cell: 'Célula A - Corte', produced: 120, scrap: 2, status: 'approved' },
    { id: 'REG-002', timestamp: '19/06 09:00', cell: 'Célula A - Corte', produced: 98, scrap: 5, status: 'warning' },
    { id: 'REG-003', timestamp: '19/06 10:00', cell: 'Célula B - Bordo', produced: 145, scrap: 0, status: 'online' },
    { id: 'REG-004', timestamp: '19/06 11:00', cell: 'Célula C - Usinagem', produced: 0, scrap: 0, status: 'blocked' }
  ];

  // Handler para simular envio de scanner
  const handleScanSubmit = (val) => {
    if (!val.trim()) {
      setScanStatus('warning');
      setScanHelper('Código vazio inserido.');
      return;
    }
    setScanStatus('info');
    setScanHelper('Processando leitura...');

    setTimeout(() => {
      if (val.toUpperCase().startsWith('LOTE-ERR')) {
        setScanStatus('danger');
        setScanHelper('Lote rejeitado: etapa do processo incorreta.');
      } else {
        setScanStatus('success');
        setScanHelper(`Leitura aprovada com sucesso! Código: ${val}`);
      }
    }, 600);
  };

  return (
    <IndustrialPageShell>
      {/* Cabeçalho da Página */}
      <PageHeader
        title="Catálogo de Componentes Industriais"
        subtitle="Biblioteca de componentes reutilizáveis, seguros e responsivos para o chão de fábrica do Leo Flow."
        icon={Wrench}
        actions={
          <div className="flex gap-2">
            <IndustrialStatusBadge status="online" dot />
            <IndustrialStatusBadge status="info" />
          </div>
        }
      />

      {/* ── Seção 1: Tabs e Modos ── */}
      <IndustrialSectionCard
        title="Modos de Operação (IndustrialModeTabs)"
        subtitle="Seletor segmentado com suporte a ícones, descrições e controle horizontal."
        icon={LayoutGrid}
      >
        <IndustrialModeTabs
          value={activeTab}
          onChange={setActiveTab}
          items={[
            { value: 'quick', label: 'Manual Rápido', icon: Clock, description: 'Lançamentos sem OP/Lote' },
            { value: 'complete', label: 'Manual Completo', icon: FileText, description: 'MES & Rastreabilidade' },
            { value: 'collection', label: 'Coleta Código/RFID', icon: Barcode, description: 'Scanners físicos/RFID' },
            { value: 'history', label: 'Histórico Recente', icon: Clock, description: 'Auditoria de lançamentos' },
            { value: 'disabled_item', label: 'Modo Inativo', icon: HelpCircle, description: 'Aguardando licença', disabled: true }
          ]}
        />
        <p className="text-xs text-muted-foreground mt-4 bg-secondary/35 p-2 rounded-xl">
          Aba selecionada no estado do preview: <strong className="text-foreground">{activeTab}</strong>
        </p>
      </IndustrialSectionCard>

      {/* ── Seção 2: KPIs & Metas ── */}
      <IndustrialSectionCard
        title="Métricas e KPIs (IndustrialKpiCard & IndustrialMetricGrid)"
        subtitle="Organização em grid responsivo com status de eficiência, descarte e paradas."
        icon={Activity}
      >
        <IndustrialMetricGrid columns={4}>
          <IndustrialKpiCard
            label="Eficiência Geral"
            value="94.2%"
            helper="Meta do turno: 90%"
            icon={Activity}
            status="success"
            trend="+2.1%"
          />
          <IndustrialKpiCard
            label="Produção Acumulada"
            value="363"
            helper="Meta: 400 peças"
            icon={Database}
            status="neutral"
            trend="Faltam 37"
          />
          <IndustrialKpiCard
            label="Refugos Detectados"
            value="7"
            helper="Taxa de refugo: 1.9%"
            icon={AlertTriangle}
            status="warning"
            trend="Atenção"
          />
          <IndustrialKpiCard
            label="Tempo de Parada"
            value="24 min"
            helper="Setup de seccionadora"
            icon={Clock}
            status="danger"
            trend="Crítico"
          />
        </IndustrialMetricGrid>

        {/* Exemplo de Skeleton State */}
        <div className="mt-5 pt-5 border-t border-border/40">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Exemplo de estado de carregamento:</p>
          <IndustrialMetricGrid columns={4}>
            <IndustrialKpiCard loading />
            <IndustrialKpiCard loading />
            <IndustrialKpiCard loading />
            <IndustrialKpiCard loading />
          </IndustrialMetricGrid>
        </div>
      </IndustrialSectionCard>

      {/* ── Seção 3: Coleta e Inputs de Scanner ── */}
      <IndustrialSectionCard
        title="Entradas de Leitura (IndustrialScannerInput)"
        subtitle="Simulação interativa de digitação e disparos de coletores/scanners de chão de fábrica."
        icon={Barcode}
      >
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <IndustrialScannerInput
              value={scanValue}
              onChange={setScanValue}
              onSubmit={handleScanSubmit}
              status={scanStatus}
              helper={scanHelper}
              mode={activeTab === 'collection' ? 'camera' : 'keyboard'}
              placeholder="Digite 'LOTE-ERR-9' para testar erro..."
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setScanValue('LOTE-CORTE-102A'); handleScanSubmit('LOTE-CORTE-102A'); }}>
                Disparar Lote Válido
              </Button>
              <Button size="sm" variant="destructive" onClick={() => { setScanValue('LOTE-ERR-992F'); handleScanSubmit('LOTE-ERR-992F'); }}>
                Disparar Lote Inválido
              </Button>
            </div>
          </div>

          <div className="space-y-2.5 text-xs text-muted-foreground bg-secondary/35 p-4 rounded-2xl">
            <h4 className="font-bold text-foreground">Comportamento do Componente:</h4>
            <p>1. Autofoco persistente para acelerar disparos sequenciais.</p>
            <p>2. Botão limpar rápido "X" e confirmação "Scan" acoplados.</p>
            <p>3. Bordas coloridas conforme validação (Sucesso, Atenção, Erro).</p>
            <p>4. Modo de entrada (USB Físico, Celular, RFID) exibido dinamicamente.</p>
          </div>
        </div>
      </IndustrialSectionCard>

      {/* ── Seção 4: Linha de Progresso e Badges ── */}
      <IndustrialSectionCard
        title="Progresso e Badges de Status"
        subtitle="Barras de percentual de lote e listagem de emblemas visuais."
        icon={ShieldCheck}
      >
        <div className="grid md:grid-cols-2 gap-8">
          {/* Barras de progresso */}
          <div className="space-y-5">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Barras de Progresso</h4>
            <IndustrialProgressBar
              value={progressVal}
              max={100}
              label="Eficiência do Lote Atual"
              helper="Etapa: Usinagem CNC"
              status={progressVal >= 90 ? 'success' : progressVal >= 70 ? 'warning' : 'danger'}
            />
            <div className="flex items-center gap-2">
              <Button size="xs" onClick={() => setProgressVal(prev => Math.max(0, prev - 10))}>-10%</Button>
              <Button size="xs" onClick={() => setProgressVal(prev => Math.min(100, prev + 10))}>+10%</Button>
              <span className="text-xs text-muted-foreground font-mono">Valor: {progressVal}%</span>
            </div>
          </div>

          {/* Listagem de badges */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Amostra de Status Badges</h4>
            <div className="flex flex-wrap gap-2">
              <IndustrialStatusBadge status="approved" dot />
              <IndustrialStatusBadge status="success" />
              <IndustrialStatusBadge status="online" dot />
              <IndustrialStatusBadge status="warning" />
              <IndustrialStatusBadge status="etapa_errada" dot />
              <IndustrialStatusBadge status="error" />
              <IndustrialStatusBadge status="offline" dot />
              <IndustrialStatusBadge status="cancelled" />
              <IndustrialStatusBadge status="reversed" />
              <IndustrialStatusBadge status="corrected" dot />
              <IndustrialStatusBadge status="reading" />
              <IndustrialStatusBadge status="neutral" />
            </div>
          </div>
        </div>
      </IndustrialSectionCard>

      {/* ── Seção 5: Timelines ── */}
      <IndustrialSectionCard
        title="Linha do Tempo de Etapas (IndustrialTimeline)"
        subtitle="Acompanhamento do lote produtivo nas orientações horizontal (desktop) e vertical (mobile)."
        icon={Clock}
      >
        <div className="space-y-8">
          <div>
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4">Timeline Horizontal</h4>
            <IndustrialTimeline steps={timelineSteps} orientation="horizontal" currentStep="usinagem" />
          </div>
          <div className="border-t border-border/40 pt-5">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4">Timeline Vertical</h4>
            <div className="max-w-md">
              <IndustrialTimeline steps={timelineSteps} orientation="vertical" currentStep="usinagem" />
            </div>
          </div>
        </div>
      </IndustrialSectionCard>

      {/* ── Seção 6: Tabelas e Históricos ── */}
      <IndustrialSectionCard
        title="Grids de Dados Responsivos (IndustrialDataTable)"
        subtitle="Tabela clássica em desktop que se autotransforma em cards empilhados no mobile."
        icon={FileText}
        actions={
          <div className="flex items-center gap-1.5">
            <Button size="xs" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setTableLoading(prev => !prev)}>
              <RefreshCw className={tableLoading ? 'w-3 h-3 animate-spin' : 'w-3 h-3'} /> Loading Toggle
            </Button>
          </div>
        }
      >
        <IndustrialDataTable
          columns={tableColumns}
          data={tableData}
          loading={tableLoading}
        />
      </IndustrialSectionCard>

      {/* ── Seção 7: Estado Vazio ── */}
      <IndustrialSectionCard
        title="Estados de Alerta / Vazio (IndustrialEmptyState)"
        icon={HelpCircle}
      >
        <IndustrialEmptyState
          title="Sem conexões RFID ativas"
          description="Nenhuma antena RFID física foi detectada na célula. Verifique a chave de energia ou utilize o scanner USB para contingência."
          action={
            <Button variant="outline" size="sm" className="text-xs font-bold gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Tentar Reconectar
            </Button>
          }
        />
      </IndustrialSectionCard>

      {/* ── Barra de Ações ── */}
      <IndustrialSectionCard
        title="Barra de Ações (IndustrialActionBar)"
        icon={ShieldCheck}
      >
        <IndustrialActionBar align="between">
          <Button variant="ghost" className="text-xs">
            Resetar Preview
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              Voltar ao Início
            </Button>
            <Button size="sm" className="bg-[#2d9c4a] hover:bg-[#237d3a] text-white">
              Salvar Configurações
            </Button>
          </div>
        </IndustrialActionBar>
      </IndustrialSectionCard>

      {/* Mobile Footer Action Placeholder */}
      <div className="opacity-90 border border-dashed border-border p-4 rounded-2xl bg-secondary/5">
        <p className="text-xs text-muted-foreground text-center">
          * Componente <code className="font-mono text-[#2d9c4a] font-bold">IndustrialMobileFooterAction</code> está ativo no rodapé em telas mobile/PWA.
        </p>
      </div>

      <IndustrialMobileFooterAction
        primaryLabel="Finalizar Simulação"
        onPrimary={() => alert('Simulação finalizada!')}
        secondaryLabel="Voltar"
        onSecondary={() => alert('Voltou')}
      />

    </IndustrialPageShell>
  );
}
