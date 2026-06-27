import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Upload, FileText, CheckCircle, AlertTriangle, Eye, ChevronDown, ChevronUp,
  RefreshCw, X, Edit3
} from 'lucide-react';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';

// Helper para converter string base64 em Uint8Array
function base64ToUint8Array(base64) {
  const clean = base64.replace(/^data:.*;base64,/, "");
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Parser client-side para planilhas para evitar timeouts na nuvem
function parseSheetOnClient(content, fileType) {
  let workbook;
  if (fileType === "xlsx") {
    const bytes = base64ToUint8Array(content);
    workbook = XLSX.read(bytes, { 
      type: "array",
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      cellText: false,
      cellNF: false
    });
  } else {
    workbook = XLSX.read(content, { type: "string" });
  }

  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  return parseRowsToNormalizedJson(rows);
}

function parseRowsToNormalizedJson(rows) {
  if (rows.length === 0) {
    throw new Error("A planilha está vazia");
  }

  const sampleRow = rows[0];
  const keys = Object.keys(sampleRow);
  const mapping = {};

  const colMaps = {
    orderCode: ["pedido", "ordem", "ordem de producao", "ordem de produção", "order", "order code", "order_code", "op"],
    customer: ["cliente", "customer", "customer name", "customer_name", "razao social", "razao_social", "razaosocial", "razao_social_cliente", "nome_fantasia_cliente"],
    projectName: ["projeto", "project", "project name", "project_name"],
    environmentName: ["ambiente", "environment", "room", "environment_name"],
    moduleName: ["modulo", "módulo", "module", "module_name", "celula_destino"],
    pieceCode: ["codigo", "código", "codigo peca", "código peça", "code", "part code", "piece code", "piece_code", "item_code", "id", "peca_id"],
    pieceName: ["nome", "nome peca", "nome peça", "descricao", "descrição", "description", "name", "piece_name", "piece name", "item_name", "peca_name", "peca_nome"],
    material: ["material", "board", "chapa"],
    color: ["cor", "color", "padrao", "padrão", "grain", "cor_padrao"],
    thickness: ["espessura", "esp", "thickness", "espessura_mm"],
    width: ["comprimento", "comp", "length", "comprimento (mm)", "length_mm", "width", "comprimento_mm"],
    height: ["largura", "larg", "height", "largura (mm)", "height_mm", "largura_mm"],
    quantity: ["quantidade", "qtd", "quantity", "qty", "qtde"],
    edgeFront: ["frente", "borda frente", "fita frente", "edge front", "borda 1", "borda_frontal", "frontal", "fita_borda_frente"],
    edgeBack: ["tras", "trás", "traseira", "borda tras", "borda trás", "fita tras", "fita trás", "edge back", "borda 2", "borda_traseira", "fita_borda_tras"],
    edgeLeft: ["esquerda", "borda esquerda", "fita esquerda", "edge left", "borda 3", "borda_esquerda", "fita_borda_esquerda"],
    edgeRight: ["direita", "borda direita", "fita direita", "edge right", "borda 4", "borda_direita", "fita_borda_direita"],
    requiresCut: ["corte", "requires cut", "cut", "corte_obrigatorio"],
    requiresEdge: ["bordo", "requires edge", "edge", "bordo_obrigatorio"],
    requiresCnc: ["usinagem", "requires cnc", "cnc", "usinagem_obrigatoria", "usinagem_cnc"],
    requiresJoinery: ["marcenaria", "requires joinery", "joinery", "marcenaria_obrigatoria"]
  };

  for (const [normKey, aliases] of Object.entries(colMaps)) {
    for (const key of keys) {
      const cleanKey = key.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (aliases.some(alias => {
        const cleanAlias = alias.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return cleanKey === cleanAlias;
      })) {
        mapping[normKey] = key;
        break;
      }
    }
  }

  const getValue = (row, normKey, fallback = "") => {
    const key = mapping[normKey];
    if (key === undefined) return fallback;
    return row[key] ?? fallback;
  };

  const firstRow = rows[0];
  const orderCode = String(getValue(firstRow, "orderCode") || `OP-${Date.now()}`);
  const customer = String(getValue(firstRow, "customer") || "Cliente Geral");
  const projectName = String(getValue(firstRow, "projectName") || `Importação Planilha ${orderCode}`);
  const projectCode = String(getValue(firstRow, "orderCode") || orderCode);
  const date = new Date().toISOString().split("T")[0];
  const deliveryDate = "";

  const project = { code: projectCode, name: projectName, customer, orderCode, date, deliveryDate };

  const environmentsMap = new Map();
  const allItems = [];

  for (const row of rows) {
    const pieceCode = String(getValue(row, "pieceCode") || "").trim();
    const pieceName = String(getValue(row, "pieceName") || "").trim();
    if (!pieceCode && !pieceName) continue;

    const finalPieceCode = pieceCode || `PEC-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const finalPieceName = pieceName || finalPieceCode;

    const envName = String(getValue(row, "environmentName") || "Ambiente Geral").trim();
    const modName = String(getValue(row, "moduleName") || "Módulo Geral").trim();

    const material = String(getValue(row, "material") || "").trim();
    const color = String(getValue(row, "color") || "").trim();
    
    const thickness = parseFloat(String(getValue(row, "thickness") || "0").replace(",", ".")) || 0;
    const width = parseFloat(String(getValue(row, "width") || "0").replace(",", ".")) || 0;
    const height = parseFloat(String(getValue(row, "height") || "0").replace(",", ".")) || 0;
    const quantity = parseInt(String(getValue(row, "quantity") || "1")) || 1;

    const cleanEdge = (val) => {
      const s = String(val ?? "").trim();
      return (s.toUpperCase() === "SEM FITA" || s === "0" || s === "-") ? "" : s;
    };
    const edgeFront = cleanEdge(getValue(row, "edgeFront"));
    const edgeBack = cleanEdge(getValue(row, "edgeBack"));
    const edgeLeft = cleanEdge(getValue(row, "edgeLeft"));
    const edgeRight = cleanEdge(getValue(row, "edgeRight"));

    const hasEdge = [edgeFront, edgeBack, edgeLeft, edgeRight].some(e => !!e);

    const getBool = (val, fallback) => {
      if (val === undefined || val === "") return fallback;
      const s = String(val).trim().toUpperCase();
      return s === "S" || s === "SIM" || s === "T" || s === "TRUE" || s === "1";
    };

    const requiresCut = getBool(getValue(row, "requiresCut", undefined), true);
    const requiresEdge = getBool(getValue(row, "requiresEdge", undefined), hasEdge);
    const requiresCnc = getBool(getValue(row, "requiresCnc", undefined), false);
    const requiresJoinery = getBool(getValue(row, "requiresJoinery", undefined), false);

    const item = {
      code: finalPieceCode,
      name: finalPieceName,
      material,
      color,
      thickness,
      width,
      height,
      quantity,
      edgeFront,
      edgeBack,
      edgeLeft,
      edgeRight,
      requiresCut,
      requiresEdge,
      requiresCnc,
      requiresJoinery,
      requiresSeparation: true,
      requiresPackaging: true,
      requiresShipping: true,
      environmentName: envName,
      moduleName: modName,
      rawAttributes: {}
    };

    if (!environmentsMap.has(envName)) {
      environmentsMap.set(envName, new Map());
    }
    const modulesMap = environmentsMap.get(envName);
    if (!modulesMap.has(modName)) {
      modulesMap.set(modName, []);
    }
    modulesMap.get(modName).push(item);
    allItems.push(item);
  }

  const environments = [];
  for (const [envName, modulesMap] of environmentsMap.entries()) {
    const modules = [];
    for (const [modName, items] of modulesMap.entries()) {
      modules.push({
        id: modName,
        name: modName,
        items
      });
    }
    environments.push({
      id: envName,
      name: envName,
      modules
    });
  }

  let totalPieces = 0;
  let requiresJoinery = false;

  for (const item of allItems) {
    totalPieces += item.quantity || 1;
    if (item.requiresJoinery) requiresJoinery = true;
  }

  return {
    project,
    environments,
    allItems,
    summary: {
      totalPieces,
      totalItems: allItems.length,
      requiresJoinery,
      requiresCnc: allItems.some(i => i.requiresCnc),
      requiresEdge: allItems.some(i => i.requiresEdge),
      environments: environments.length,
      modules: environments.reduce((a, e) => a + e.modules.length, 0)
    }
  };
}

export default function XmlImportTab() {
  const [file, setFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [fileType, setFileType] = useState('xml');
  const [parsed, setParsed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [expandedItems, setExpandedItems] = useState({});
  const fileRef = useRef(null);
  const [duplicateInfo, setDuplicateInfo] = useState(null);

  // Campos do PCP customizáveis
  const [sourceType, setSourceType] = useState('promob_xml'); // 'promob_xml' | 'csv_manual' | 'other_xml'
  const [clientName, setClientName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [externalOpCode, setExternalOpCode] = useState('');
  const [notes, setNotes] = useState('');

  // Erros e alertas de validação
  const [errors, setErrors] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [validationStatus, setValidationStatus] = useState('Aguardando validação');

  // Estatísticas detalhadas
  const [stats, setStats] = useState({
    totalParts: 0,
    partsWithEdge: 0,
    partsWithCnc: 0,
    partsWithJoinery: 0,
    partsWithoutOps: 0,
    materials: new Set(),
    thicknesses: new Set()
  });

  // Executa validações client-side do Portal PCP
  const runPcpValidation = useCallback((parsedData) => {
    const errs = [];
    const warns = [];
    
    if (!parsedData) return;

    if (!parsedData.project?.orderCode && !externalOpCode) {
      errs.push('Código da OP Externa / Pedido não identificado no arquivo.');
    }
    if (!parsedData.allItems || parsedData.allItems.length === 0) {
      errs.push('Arquivo vazio: nenhuma peça encontrada.');
    }

    const matSet = new Set();
    const thickSet = new Set();
    let partsWithEdge = 0;
    let partsWithCnc = 0;
    let partsWithJoinery = 0;
    let partsWithoutOps = 0;

    parsedData.allItems?.forEach((item, idx) => {
      const name = item.name || item.code || `Item ${idx + 1}`;
      
      if (!item.code && !item.name) {
        errs.push(`Linha ${idx + 1}: Peça sem identificação (sem código ou descrição).`);
      }
      
      // Validação de dimensões
      if (parseFloat(item.width) <= 0 || parseFloat(item.height) <= 0 || parseFloat(item.thickness) <= 0) {
        errs.push(`Peça "${name}": Sem dimensões válidas (${item.width}x${item.height}x${item.thickness}).`);
      }

      if (item.material) matSet.add(item.material);
      if (item.thickness) thickSet.add(item.thickness);

      if (item.requiresEdge) partsWithEdge += item.quantity || 1;
      if (item.requiresCnc) partsWithCnc += item.quantity || 1;
      if (item.requiresJoinery) partsWithJoinery += item.quantity || 1;

      if (!item.requiresCut && !item.requiresEdge && !item.requiresCnc && !item.requiresJoinery) {
        partsWithoutOps += item.quantity || 1;
      }
    });

    setStats({
      totalParts: parsedData.summary?.totalPieces || 0,
      partsWithEdge,
      partsWithCnc,
      partsWithJoinery,
      partsWithoutOps,
      materials: matSet,
      thicknesses: thickSet
    });

    setErrors(errs);
    setWarnings(warns);

    if (errs.length > 0) {
      setValidationStatus('Reprovado por erro estrutural');
    } else if (warns.length > 0) {
      setValidationStatus('Validado com alertas');
    } else {
      setValidationStatus('Validado com sucesso');
    }
  }, [externalOpCode]);

  // Atualiza validação quando os inputs editados mudam
  useEffect(() => {
    if (parsed) {
      runPcpValidation(parsed);
    }
  }, [externalOpCode, clientName, projectName, parsed, runPcpValidation]);

  // ─── Leitura do arquivo ─────────────────────────────────────
  const handleFileChange = useCallback(async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const name = f.name.toLowerCase();
    
    // Bloquear arquivos perigosos
    const blockedExtensions = ['.exe', '.zip', '.rar', '.js'];
    if (blockedExtensions.some(ext => name.endsWith(ext)) || !name.includes('.')) {
      toast.error('Arquivo bloqueado por questões de segurança. Formato inválido.');
      return;
    }

    let type = '';
    if (name.endsWith('.xml')) type = 'xml';
    else if (name.endsWith('.xlsx')) type = 'xlsx';
    else if (name.endsWith('.csv')) type = 'csv';
    else if (name.endsWith('.tsv')) type = 'tsv';
    else {
      toast.error('Selecione um arquivo .xml, .xlsx, .csv ou .tsv');
      return;
    }
    setFile(f);
    setFileType(type);
    setDuplicateInfo(null);
    setParsed(null);
    setErrors([]);
    setWarnings([]);
    setValidationStatus('Aguardando validação');

    let content = '';
    if (type === 'xlsx') {
      content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(f);
      });
    } else {
      content = await f.text();
    }
    setFileContent(content);
    await parseFile(content, type, f.name);
  }, []);

  // ─── Parse via Edge Function ou local ──────────────────────
  const parseFile = async (content, type, name) => {
    setLoading(true);
    try {
      let result;
      if (type === 'xml') {
        const resp = await supabase.functions.invoke('promob-parse-order', {
          body: { fileContent: content, fileType: type, fileName: name },
        });
        if (resp.error) throw new Error(resp.error.message);
        result = resp.data?.data;
      } else {
        // XLSX, CSV, TSV: parse local rápido para evitar limite de CPU na Edge Function
        result = parseSheetOnClient(content, type);
      }

      setParsed(result);

      // Preenche os metadados do formulário
      setSourceType(type === 'xml' ? 'promob_xml' : 'csv_manual');
      setClientName(result?.project?.customer || '');
      setProjectName(result?.project?.name || '');
      setExternalOpCode(result?.project?.orderCode || '');
      setNotes('');

      // Executa validações do PCP
      runPcpValidation(result);

    } catch (err) {
      setValidationStatus('Reprovado por erro estrutural');
      setErrors([`Falha crítica no parse do arquivo: ${err.message}`]);
      toast.error(`Erro ao ler arquivo: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ─── Importar (via Edge Function segura) ────────────────────
  const handleImport = async () => {
    if (!fileContent || !parsed) return;

    if (errors.length > 0) {
      toast.error('Não é possível importar arquivos com erros críticos.');
      return;
    }

    setImporting(true);
    setDuplicateInfo(null);
    try {
      // Mescla edições manuais nos dados estruturados enviados
      const finalizedParsed = {
        ...parsed,
        project: {
          ...parsed.project,
          customer: clientName,
          name: projectName,
          orderCode: externalOpCode,
        }
      };

      const resp = await supabase.functions.invoke('promob-import-xml', {
        body: {
          fileContent,
          fileType,
          fileName: file?.name,
          integrationId: null,
          parsedData: finalizedParsed,
          totalErrors: errors.length,
          totalWarnings: warnings.length,
        },
      });

      const result = resp.data;

      if (result?.duplicate) {
        setDuplicateInfo(result);
        setValidationStatus('Reprovado por erro estrutural');
        setErrors([result.message]);
        return;
      }

      if (result?.success) {
        await auditLog(AUDIT_ACTIONS.PROMOB_XML_IMPORT, 'production_order',
          result.data.productionOrderId,
          { orderCode: result.data.orderCode, fileName: file?.name }
        );
        toast.success(`✅ Ordem ${result.data.orderCode} importada com sucesso! ${result.data.totalItems} peças criadas.`);
        setValidationStatus('Importado');
        handleClear();
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
    setFile(null); setFileContent(null); setParsed(null); setDuplicateInfo(null);
    setErrors([]); setWarnings([]); setValidationStatus('Aguardando validação');
    setClientName(''); setProjectName(''); setExternalOpCode(''); setNotes('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const toggleItem = (idx) => setExpandedItems(p => ({ ...p, [idx]: !p[idx] }));

  return (
    <div className="space-y-6">
      {/* ── Formulário PCP de Origem e Metadados ───────────────── */}
      <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center gap-2 border-b border-border/60 pb-3 mb-2">
          <Edit3 className="w-5 h-5 text-[#2d9c4a]" />
          <h3 className="font-semibold text-foreground">Metadados da Entrada de Produção</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="sourceType">Tipo de Origem</Label>
            <select
              id="sourceType"
              value={sourceType}
              onChange={e => setSourceType(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="promob_xml">Promob XML</option>
              <option value="csv_manual">CSV manual</option>
              <option value="other_xml">Outro XML estruturado</option>
            </select>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="notes">Observação Técnica</Label>
            <Input
              id="notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Observações adicionais para a produção..."
            />
          </div>
        </div>
      </div>

      {/* ── Upload Zone ──────────────────────────────────────── */}
      <div
        className={cn(
          'border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center transition-all duration-200 shadow-sm',
          'hover:border-[#76FB91]/60 hover:bg-[#76FB91]/5 cursor-pointer',
          file ? 'border-[#76FB91]/50 bg-[#76FB91]/5' : 'border-border/60 bg-card'
        )}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xml,.xlsx,.csv,.tsv"
          className="hidden"
          onChange={handleFileChange}
        />
        {!file ? (
          <>
            <div className="mx-auto w-12 h-12 rounded-2xl bg-[#76FB91]/10 border border-[#76FB91]/20 flex items-center justify-center mb-3">
              <Upload className="w-5 h-5 text-[#2d9c4a]" />
            </div>
            <h3 className="font-semibold text-foreground text-sm mb-1">Selecionar plano de corte/produção</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Arraste ou clique para escolher arquivos do Promob ou planilhas estruturadas (.xml, .xlsx, .csv, .tsv)
            </p>
          </>
        ) : (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 py-2">
            <div className="flex items-center gap-3">
              <FileText className="w-6 h-6 text-[#2d9c4a] shrink-0" />
              <div className="text-left">
                <p className="font-semibold text-foreground text-sm truncate max-w-xs">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                type="button"
                id="btn-import-uploadzone"
                onClick={(e) => {
                  e.stopPropagation();
                  handleImport();
                }}
                disabled={importing || errors.length > 0 || !parsed}
                className="gap-2 bg-[#2d9c4a] hover:bg-[#25813d] text-white h-9 px-4 text-xs font-semibold rounded-lg"
              >
                {importing ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Importando…</>
                ) : (
                  <><CheckCircle className="w-4 h-4" /> Importar Arquivo</>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); handleClear(); }}
                className="p-0 h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Loading ──────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center gap-3 p-4 bg-card border border-border/60 rounded-2xl">
          <RefreshCw className="w-5 h-5 text-[#2d9c4a] animate-spin" />
          <span className="text-sm text-muted-foreground">Lendo e interpretando arquivo PCP…</span>
        </div>
      )}

      {/* ── Painel de Pré-Validação ──────────────────────────── */}
      {parsed && !loading && (
        <div className="space-y-5">
          <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-2 flex-wrap gap-2">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Eye className="w-4 h-4 text-[#2d9c4a]" /> Painel de Pré-Validação PCP
              </h3>
              <Badge className={cn(
                'px-2.5 py-1 text-xs font-semibold',
                validationStatus === 'Validado com sucesso' && 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
                validationStatus === 'Validado com alertas' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
                validationStatus.startsWith('Reprovado') && 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
                validationStatus === 'Aguardando validação' && 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
              )}>
                {validationStatus}
              </Badge>
            </div>

            {/* Dados do Projeto extraídos do arquivo */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-secondary/30 p-3 rounded-xl border border-border/40 text-xs">
              <div>
                <span className="text-muted-foreground font-semibold">Cliente:</span>{' '}
                <span className="text-foreground font-medium">{clientName || '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground font-semibold">Projeto:</span>{' '}
                <span className="text-foreground font-medium">{projectName || '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground font-semibold">OP Externa / Pedido:</span>{' '}
                <span className="text-foreground font-medium font-mono">{externalOpCode || '—'}</span>
              </div>
            </div>

            {/* Estatísticas e Informações do Arquivo */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground leading-none">Peças Encontradas</p>
                <p className="text-lg font-bold text-foreground">{stats.totalParts}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground leading-none">Com Borda de Fita</p>
                <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{stats.partsWithEdge}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground leading-none">Com Furação/CNC</p>
                <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{stats.partsWithCnc}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground leading-none">Com Marcenaria</p>
                <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{stats.partsWithJoinery}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-border/60 text-xs">
              <div>
                <p className="font-semibold text-muted-foreground mb-1">Materiais Detectados:</p>
                <div className="flex flex-wrap gap-1">
                  {stats.materials.size > 0 ? (
                    Array.from(stats.materials).map((mat, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">{mat}</Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground italic">Nenhum material encontrado</span>
                  )}
                </div>
              </div>
              <div>
                <p className="font-semibold text-muted-foreground mb-1">Espessuras Detectadas:</p>
                <div className="flex flex-wrap gap-1">
                  {stats.thicknesses.size > 0 ? (
                    Array.from(stats.thicknesses).map((thick, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">{thick} mm</Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground italic">Nenhuma espessura encontrada</span>
                  )}
                </div>
              </div>
            </div>

            {stats.partsWithoutOps > 0 && (
              <div className="p-3 bg-secondary/35 rounded-xl text-xs text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Existem <strong>{stats.partsWithoutOps} peças</strong> sem operações (borda, furação ou marcenaria) definidas. Elas passarão apenas pelo Corte.</span>
              </div>
            )}
          </div>

          {/* Erros Críticos */}
          {errors.length > 0 && (
            <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 rounded-2xl space-y-2">
              <div className="flex items-center gap-2 text-red-800 dark:text-red-300 font-semibold text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>Erros Críticos de Estrutura</span>
              </div>
              <ul className="list-disc pl-5 text-xs text-red-700 dark:text-red-400 space-y-1">
                {errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Alertas/Warnings */}
          {warnings.length > 0 && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-2xl space-y-2">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-semibold text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>Alertas do Portal PCP</span>
              </div>
              <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                {warnings.map((warn, i) => (
                  <li key={i}>{warn}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Listagem de Ambientes e Módulos */}
          {parsed.environments?.map((env, eIdx) => (
            <div key={eIdx} className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-sm">
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

          {/* Botões de Ação */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={handleClear} disabled={importing}>
              Cancelar / Limpar
            </Button>
            <Button
              onClick={handleImport}
              disabled={importing || errors.length > 0}
              className="gap-2 bg-[#2d9c4a] hover:bg-[#25813d] text-white"
            >
              {importing ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Importando…</>
              ) : (
                <><CheckCircle className="w-4 h-4" /> Confirmar Importação</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
