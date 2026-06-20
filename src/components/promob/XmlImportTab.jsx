import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Upload, FileText, CheckCircle, AlertTriangle, Eye, Package,
  Scissors, Layers, Wrench, Box, Truck, ChevronDown, ChevronUp,
  RefreshCw, X, GitCompare,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Status badges por tipo de etapa
const STEP_BADGES = {
  requiresCut:       { label: 'Corte',     color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  requiresEdge:      { label: 'Bordo',     color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  requiresCnc:       { label: 'Usinagem',  color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  requiresJoinery:   { label: 'Marcenaria', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
};

export default function XmlImportTab() {
  const [file, setFile] = useState(null);
  const [xmlContent, setXmlContent] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState(null);
  const [expandedItems, setExpandedItems] = useState({});
  const fileRef = useRef(null);

  // ─── Leitura do arquivo ─────────────────────────────────────
  const handleFileChange = useCallback(async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.endsWith('.xml') && !f.name.endsWith('.XML')) {
      toast.error('Selecione um arquivo .xml');
      return;
    }
    setFile(f);
    setDuplicateInfo(null);
    setParsed(null);

    const text = await f.text();
    setXmlContent(text);
    await parseXml(text);
  }, []);

  // ─── Parse via Edge Function ────────────────────────────────
  const parseXml = async (xml) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await supabase.functions.invoke('promob-parse-order', {
        body: { xmlContent: xml },
      });
      if (resp.error) throw new Error(resp.error.message);
      setParsed(resp.data?.data);
    } catch (err) {
      toast.error(`Erro ao ler XML: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ─── Importar (via Edge Function segura) ────────────────────
  const handleImport = async () => {
    if (!xmlContent || !parsed) return;
    setImporting(true);
    setDuplicateInfo(null);
    try {
      const resp = await supabase.functions.invoke('promob-import-xml', {
        body: {
          xmlContent,
          fileName: file?.name,
          integrationId: null,
        },
      });

      const result = resp.data;

      if (result?.duplicate) {
        setDuplicateInfo(result);
        return;
      }

      if (result?.success) {
        await auditLog(AUDIT_ACTIONS.PROMOB_XML_IMPORT, 'production_order',
          result.data.productionOrderId,
          { orderCode: result.data.orderCode, fileName: file?.name }
        );
        toast.success(`✅ Ordem ${result.data.orderCode} importada com sucesso! ${result.data.totalItems} peças criadas.`);
        setFile(null); setXmlContent(null); setParsed(null);
        if (fileRef.current) fileRef.current.value = '';
      } else {
        throw new Error(result?.error || 'Erro desconhecido');
      }
    } catch (err) {
      toast.error(`Falha na importação: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  // ─── Limpar seleção ─────────────────────────────────────────
  const handleClear = () => {
    setFile(null); setXmlContent(null); setParsed(null); setDuplicateInfo(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const toggleItem = (idx) => setExpandedItems(p => ({ ...p, [idx]: !p[idx] }));

  return (
    <div className="space-y-6">
      {/* ── Upload Zone ──────────────────────────────────────── */}
      <div
        className={cn(
          'border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all duration-200',
          'hover:border-[#76FB91]/60 hover:bg-[#76FB91]/5 cursor-pointer',
          file ? 'border-[#76FB91]/50 bg-[#76FB91]/5' : 'border-border/60 bg-card'
        )}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xml"
          className="hidden"
          onChange={handleFileChange}
        />
        {!file ? (
          <>
            <div className="mx-auto w-14 h-14 rounded-2xl bg-[#76FB91]/10 border border-[#76FB91]/20 flex items-center justify-center mb-4">
              <Upload className="w-6 h-6 text-[#2d9c4a]" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Selecionar arquivo XML do Promob</h3>
            <p className="text-sm text-muted-foreground">
              Arraste ou clique para escolher o arquivo exportado do Promob
            </p>
          </>
        ) : (
          <div className="flex items-center justify-center gap-3">
            <FileText className="w-6 h-6 text-[#2d9c4a] shrink-0" />
            <div className="text-left">
              <p className="font-semibold text-foreground text-sm">{file.name}</p>
              <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button
              onClick={e => { e.stopPropagation(); handleClear(); }}
              className="ml-4 p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* ── Loading ──────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center gap-3 p-4 bg-card border border-border/60 rounded-2xl">
          <RefreshCw className="w-5 h-5 text-[#2d9c4a] animate-spin" />
          <span className="text-sm text-muted-foreground">Lendo e interpretando XML do Promob…</span>
        </div>
      )}

      {/* ── Alerta de Duplicidade ─────────────────────────────── */}
      {duplicateInfo && (
        <div className="p-5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-2xl space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-300">{duplicateInfo.message}</p>
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                {duplicateInfo.duplicateType === 'order_code'
                  ? `O pedido ${parsed?.project?.orderCode} já existe no sistema.`
                  : 'Este arquivo XML já foi importado anteriormente (hash idêntico).'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" className="gap-2" onClick={handleClear}>
              <X className="w-3.5 h-3.5" /> Cancelar
            </Button>
            {duplicateInfo.canRevise && (
              <Button size="sm" className="gap-2 bg-amber-600 hover:bg-amber-700 text-white">
                <GitCompare className="w-3.5 h-3.5" /> Ver Diferenças e Criar Revisão
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Pré-visualização ─────────────────────────────────── */}
      {parsed && !loading && (
        <div className="space-y-5">
          {/* Dados do Projeto */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Eye className="w-4 h-4 text-[#2d9c4a]" /> Pré-visualização da Ordem
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <InfoField label="Cliente"   value={parsed.project?.customer} />
              <InfoField label="Pedido"    value={parsed.project?.orderCode} />
              <InfoField label="Projeto"   value={parsed.project?.name} />
              <InfoField label="Código"    value={parsed.project?.code} />
              <InfoField label="Entrega"   value={parsed.project?.deliveryDate} />
              <InfoField label="Data"      value={parsed.project?.date} />
            </div>

            {/* Resumo */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border/60">
              <SummaryCard icon={Package}  label="Total Peças"   value={parsed.summary?.totalPieces} />
              <SummaryCard icon={Layers}   label="Ambientes"    value={parsed.summary?.environments} />
              <SummaryCard icon={FileText} label="Módulos"      value={parsed.summary?.modules} />
              <SummaryCard
                icon={Wrench}
                label="Com Marcenaria"
                value={parsed.summary?.requiresJoinery ? 'Sim' : 'Não'}
                accent={parsed.summary?.requiresJoinery ? 'amber' : 'default'}
              />
            </div>
          </div>

          {/* Tags de operações necessárias */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(STEP_BADGES).map(([key, badge]) =>
              parsed.allItems?.some(i => i[key]) && (
                <span key={key} className={cn('text-xs font-medium px-3 py-1.5 rounded-full border', badge.color)}>
                  ✓ Requer {badge.label}
                </span>
              )
            )}
          </div>

          {/* Lista de Ambientes e Módulos */}
          {parsed.environments?.map((env, eIdx) => (
            <div key={eIdx} className="bg-card border border-border/60 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 bg-secondary/30 border-b border-border/60 flex items-center justify-between">
                <h4 className="font-semibold text-sm text-foreground">{env.name}</h4>
                <Badge variant="outline" className="text-xs">
                  {env.modules.reduce((a, m) => a + m.items.length, 0)} peças
                </Badge>
              </div>
              {env.modules.map((mod, mIdx) => (
                <div key={mIdx} className="border-b border-border/40 last:border-0">
                  <div className="px-5 py-2.5 bg-secondary/10 flex items-center justify-between text-xs">
                    <span className="font-medium text-muted-foreground">{mod.name}</span>
                    <span className="text-muted-foreground">{mod.items.length} itens</span>
                  </div>
                  <div className="divide-y divide-border/30">
                    {mod.items.slice(0, expandedItems[`${eIdx}-${mIdx}`] ? undefined : 3).map((item, iIdx) => (
                      <div key={iIdx} className="px-5 py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{item.name || item.code}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.width > 0 && item.height > 0
                              ? `${item.width} × ${item.height}` + (item.thickness > 0 ? ` × ${item.thickness}mm` : '')
                              : item.material || ''}
                            {item.color ? ` · ${item.color}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.requiresJoinery && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              Marcenaria
                            </span>
                          )}
                          {item.requiresCnc && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                              CNC
                            </span>
                          )}
                          {item.requiresEdge && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                              Bordo
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground font-medium">×{item.quantity}</span>
                        </div>
                      </div>
                    ))}
                    {mod.items.length > 3 && (
                      <button
                        onClick={() => toggleItem(`${eIdx}-${mIdx}`)}
                        className="w-full px-5 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors flex items-center justify-center gap-1"
                      >
                        {expandedItems[`${eIdx}-${mIdx}`]
                          ? <><ChevronUp className="w-3 h-3" /> Mostrar menos</>
                          : <><ChevronDown className="w-3 h-3" /> +{mod.items.length - 3} itens</>
                        }
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* Botão de Importar */}
          {!duplicateInfo && (
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={handleClear} disabled={importing}>
                Cancelar
              </Button>
              <Button
                onClick={handleImport}
                disabled={importing}
                className="gap-2 bg-[#2d9c4a] hover:bg-[#25813d] text-white"
              >
                {importing
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Importando…</>
                  : <><CheckCircle className="w-4 h-4" /> Confirmar Importação</>
                }
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Componentes auxiliares ───────────────────────────────────
function InfoField({ label, value }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium text-foreground">{value || '—'}</p>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, accent }) {
  return (
    <div className={cn(
      'rounded-xl p-3 border flex items-center gap-3',
      accent === 'amber'
        ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/40'
        : 'bg-secondary/30 border-border/40'
    )}>
      <Icon className={cn(
        'w-4 h-4 shrink-0',
        accent === 'amber' ? 'text-amber-600' : 'text-[#2d9c4a]'
      )} />
      <div>
        <p className="text-xs text-muted-foreground leading-none">{label}</p>
        <p className={cn(
          'text-base font-bold mt-0.5',
          accent === 'amber' ? 'text-amber-800 dark:text-amber-300' : 'text-foreground'
        )}>{value ?? '—'}</p>
      </div>
    </div>
  );
}
