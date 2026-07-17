import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Upload, FileText, CheckCircle, AlertTriangle, RefreshCw, X, Download
} from 'lucide-react';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';

export default function PcpImportTab({ preselectedFile, clearPreselected }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  // Se houver um arquivo pré-selecionado (passado por auto-detecção da aba Promob)
  useEffect(() => {
    if (preselectedFile) {
      setFile(preselectedFile);
      handleFilePreview(preselectedFile);
      if (clearPreselected) clearPreselected();
    }
  }, [preselectedFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      handleFilePreview(droppedFile);
    }
  }, []);

  const handleFileChange = useCallback((e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      handleFilePreview(selectedFile);
    }
  }, []);

  const cleanCell = (val) => {
    if (val === undefined || val === null) return "";
    let s = String(val).trim();
    if (s.startsWith('"') && s.endsWith('"')) {
      s = s.substring(1, s.length - 1).trim();
    }
    return s;
  };

  // Processa a leitura e validação do arquivo localmente
  const handleFilePreview = async (selectedFile) => {
    setLoading(true);
    setPreview(null);
    try {
      const extension = selectedFile.name.split('.').pop().toLowerCase();
      const isBinary = ['xlsx', 'xls'].includes(extension);

      let rawRows = [];

      if (isBinary) {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        // Reconstrói as linhas considerando a "Fragmentação por TAB no XLSX"
        for (let i = 0; i < sheetData.length; i++) {
          const rowData = sheetData[i];
          if (!rowData || rowData.length === 0) continue;
          
          // Unir células com espaço e depois dividir por ponto e vírgula
          const joined = rowData.map(c => String(c ?? '')).join(' ');
          if (joined.trim() === '') continue;

          const cols = joined.split(';');
          rawRows.push(cols);
        }
      } else {
        // Arquivos de texto (CSV, TSV, TXT, HTML, XML)
        const arrayBuffer = await selectedFile.arrayBuffer();
        let text = "";
        try {
          const decoder = new TextDecoder("utf-8", { fatal: true });
          text = decoder.decode(arrayBuffer);
          if (text.includes("\uFFFD")) {
            throw new Error("Caracteres corrompidos.");
          }
        } catch (_) {
          const decoder = new TextDecoder("iso-8859-1");
          text = decoder.decode(arrayBuffer);
        }

        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          if (line.trim() === '') continue;
          const delimiter = line.includes('\t') ? '\t' : ';';
          const cols = line.split(delimiter);
          rawRows.push(cols);
        }
      }

      // Filtrar e validar as linhas do PCP
      const validRows = [];
      const errorRows = [];
      const seenBarcodes = new Set();

      // Coleta todos os barcodes únicos para consulta rápida de colisão no banco
      const fileBarcodes = [...new Set(rawRows.map(cols => {
        const colsClean = cols.map(cleanCell);
        return colsClean[14] || "";
      }).filter(Boolean))];

      const dbBarcodes = new Set();
      if (fileBarcodes.length > 0) {
        const chunkSize = 500;
        for (let i = 0; i < fileBarcodes.length; i += chunkSize) {
          const chunk = fileBarcodes.slice(i, i + chunkSize);
          const { data: dbPieces } = await supabase
            .from("production_pieces")
            .select("piece_uid")
            .in("piece_uid", chunk);
          
          if (dbPieces) {
            dbPieces.forEach(p => dbBarcodes.add(p.piece_uid));
          }
        }
      }

      let orderCode = "";
      let lotCode = "";
      let customer = "";
      let projectName = "";

      for (let i = 0; i < rawRows.length; i++) {
        const cols = rawRows[i];
        const rowNum = i + 1;
        const colsClean = cols.map(cleanCell);
        const barcode = colsClean[14] || "";
        const checkBarcode = colsClean[24] || "";
        const route = colsClean[26] || "";

        if (orderCode === "" && colsClean[1] !== "") orderCode = colsClean[1];
        if (lotCode === "" && colsClean[0] !== "") lotCode = colsClean[0];
        if (customer === "" && colsClean[2] !== "") customer = colsClean[2];
        if (projectName === "" && colsClean[3] !== "") projectName = colsClean[3];

        const rowPayload = {
          row_number: rowNum,
          raw_cells: cols,
          lotCode: colsClean[0] || "",
          orderCode: colsClean[1] || "",
          customer: colsClean[2] || "",
          projectName: colsClean[3] || "",
          environmentName: colsClean[4] || "",
          moduleName: colsClean[5] || "",
          pieceCode: colsClean[6] || "",
          pieceName: colsClean[7] || "",
          material: colsClean[8] || "",
          color: colsClean[9] || "",
          thickness: colsClean[10] || "",
          width: colsClean[11] || "",
          height: colsClean[12] || "",
          quantity: colsClean[13] || "",
          barcode: barcode,
          checkBarcode: checkBarcode,
          route: route,
        };

        const errors = [];

        if (barcode === "") {
          errors.push("Código de barras (Coluna O) ausente ou vazio.");
        } else {
          if (barcode !== checkBarcode) {
            errors.push(`Código de barras da Coluna O (${barcode}) divergente da Coluna Y (${checkBarcode}).`);
          }
          if (seenBarcodes.has(barcode)) {
            errors.push(`Código de barras duplicado no arquivo: ${barcode}.`);
          } else {
            seenBarcodes.add(barcode);
          }
          if (dbBarcodes.has(barcode)) {
            errors.push(`Código de barras já cadastrado no banco de dados: ${barcode}.`);
          }
        }

        if (errors.length > 0) {
          errorRows.push({
            row_number: rowNum,
            errors: errors,
            payload: rowPayload,
          });
        } else {
          validRows.push(rowPayload);
        }
      }

      setPreview({
        total_lines: rawRows.length,
        valid_lines: validRows.length,
        error_lines: errorRows.length,
        errors: errorRows,
        lot_code: lotCode,
        order_code: orderCode,
        customer: customer,
        project_name: projectName,
        validRows: validRows
      });

      toast.success('Arquivo lido com sucesso! Analise o preview antes de confirmar.');
    } catch (err) {
      toast.error(`Falha ao ler arquivo: ${err.message}`);
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  // Salva o lote de importação e chama a RPC commit_pcp_import de forma transacional no banco
  const handleImportCommit = async () => {
    if (!file || !preview || !preview.validRows) return;

    setImporting(true);
    try {
      const userRes = await supabase.auth.getUser();
      const userId = userRes.data.user?.id;

      // 1. Criar cabeçalho de lote
      const { data: batch, error: batchError } = await supabase
        .from("promob_import_batches")
        .insert({
          file_name: file.name,
          file_size: file.size,
          status: "pending",
          source_type: "xml_upload",
          imported_by: userId,
        })
        .select()
        .single();

      if (batchError) throw batchError;

      // 2. Chamar RPC transacional
      const { data: commitRes, error: commitError } = await supabase.rpc(
        "commit_pcp_import",
        {
          p_batch_id: batch.id,
          p_order_code: preview.order_code || `PED-${Date.now()}`,
          p_lot_code: preview.lot_code || `LOTE-${Date.now()}`,
          p_customer: preview.customer || "Consumidor Final",
          p_project_name: preview.project_name || "Projeto Manual",
          p_mapping_profile: "pcp_padrao_v1",
          p_mapping_version: 1,
          p_rows: preview.validRows,
        }
      );

      if (commitError) throw commitError;

      toast.success(`Importação realizada com sucesso! ${commitRes.pieces_created} peças importadas.`);
      
      setPreview(prev => ({
        ...prev,
        committed: true
      }));
    } catch (err) {
      toast.error(`Erro ao salvar importação: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const downloadErrorCsv = () => {
    if (!preview || !preview.errors || preview.errors.length === 0) return;

    const headers = ["Linha", "Lote", "Pedido", "Código de Barras O", "Código de Barras Y", "Erros"];
    const rows = preview.errors.map(err => [
      err.row_number,
      err.payload?.lotCode || "",
      err.payload?.orderCode || "",
      err.payload?.barcode || "",
      err.payload?.checkBarcode || "",
      err.errors.join(" | ")
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(";"))
      .join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `erros_importacao_${file?.name || 'pcp'}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Arquivo de erros baixado com sucesso!');
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Upload className="w-5 h-5 text-[#2d9c4a]" /> Importador PCP Padrão V1
        </h3>
        <p className="text-xs text-muted-foreground">
          Importe arquivos do PCP (XLSX, XLS, CSV, TSV, TXT, HTML ou XML) contendo dados de rastreabilidade unitária da produção.
        </p>
      </div>

      {!file ? (
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-border/60 hover:border-[#2d9c4a]/50 rounded-2xl p-10 text-center cursor-pointer transition-colors bg-card hover:bg-[#2d9c4a]/5"
        >
          <input
            type="file"
            ref={fileRef}
            onChange={handleFileChange}
            accept=".xlsx,.xls,.csv,.tsv,.txt,.html,.htm,.xml"
            className="hidden"
          />
          <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
          <p className="font-medium text-foreground text-sm">Arraste e solte o arquivo aqui</p>
          <p className="text-xs text-muted-foreground mt-1">ou clique para selecionar em seu computador</p>
          <p className="text-[10px] text-muted-foreground mt-3">
            Formatos suportados: XLSX, XLS, CSV, TSV, TXT, HTML, XML (limite de 50MB)
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <Card className="p-4 border border-border/60 flex items-center justify-between bg-secondary/15">
            <div className="flex items-center gap-3">
              <FileText className="w-8 h-8 text-blue-500" />
              <div>
                <p className="font-semibold text-sm text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleClear} disabled={loading || importing}>
              <X className="w-4 h-4" />
            </Button>
          </Card>

          {loading && (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#2d9c4a]" />
              <p className="text-xs">Processando e validando dados do arquivo...</p>
            </div>
          )}

          {preview && (
            <div className="space-y-6 animate-in fade-in-50 duration-200">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="p-4 border border-border/60 shadow-sm text-center">
                  <p className="text-xs text-muted-foreground font-medium">Linhas Lidas</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{preview.total_lines || 0}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-green-500/5">
                  <p className="text-xs text-green-700 dark:text-green-400 font-medium">Peças Válidas</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{preview.valid_lines || 0}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-red-500/5">
                  <p className="text-xs text-red-700 dark:text-red-400 font-medium">Erros Detectados</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{preview.error_lines || 0}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-amber-500/5">
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Duplicados/Colisões</p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                    {preview.errors?.filter(e => e.errors?.some(msg => msg.includes("duplicado") || msg.includes("cadastrado"))).length || 0}
                  </p>
                </Card>
              </div>

              {(preview.lot_code || preview.order_code) && (
                <Card className="p-4 border border-border/60 shadow-sm space-y-3">
                  <h4 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-green-500" /> Detalhes do Pedido
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-1">
                    <div>
                      <p className="text-muted-foreground font-medium">Código do Lote</p>
                      <p className="font-bold text-foreground mt-0.5">{preview.lot_code || '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium">Código do Pedido / OP</p>
                      <p className="font-bold text-foreground mt-0.5">{preview.order_code || '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium">Cliente</p>
                      <p className="font-bold text-foreground mt-0.5">{preview.customer || '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium">Projeto</p>
                      <p className="font-bold text-foreground mt-0.5">{preview.project_name || '—'}</p>
                    </div>
                  </div>
                </Card>
              )}

              {preview.error_lines > 0 && (
                <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 text-red-800 dark:text-red-300 font-semibold text-sm">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      <span>{preview.error_lines} Linhas possuem problemas de validação</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={downloadErrorCsv}
                      className="h-8 text-xs gap-1.5 text-red-700 hover:text-red-800 border-red-200 hover:bg-red-50"
                    >
                      <Download className="w-3.5 h-3.5" /> Exportar Erros (CSV)
                    </Button>
                  </div>

                  <div className="max-h-60 overflow-y-auto space-y-2 border border-red-150/40 rounded-xl p-2 bg-white/50 dark:bg-black/20">
                    {preview.errors.map((err, i) => (
                      <div key={i} className="text-xs flex flex-col md:flex-row md:items-center justify-between border-b border-red-100 last:border-0 pb-2 mb-2 last:pb-0 last:mb-0">
                        <div className="space-y-1">
                          <span className="font-bold text-red-600 mr-2">Linha {err.row_number}:</span>
                          <span className="text-muted-foreground">
                            Peça: {err.payload?.pieceName || "Sem Nome"} ({err.payload?.pieceCode || "—"})
                          </span>
                          <p className="text-red-700 font-medium">{err.errors.join(" | ")}</p>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-1 md:mt-0">
                          O: {err.payload?.barcode || "Vazio"} | Y: {err.payload?.checkBarcode || "Vazio"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={handleClear} disabled={importing}>
                  Cancelar / Limpar
                </Button>
                {preview.committed ? (
                  <Badge className="bg-green-600 text-white hover:bg-green-600 gap-1 px-4 py-2 text-sm rounded-lg font-bold">
                    <CheckCircle className="w-4 h-4" /> Importação Concluída
                  </Badge>
                ) : (
                  <Button
                    onClick={handleImportCommit}
                    disabled={importing || preview.valid_lines === 0}
                    className="gap-2 bg-[#2d9c4a] hover:bg-[#25813d] text-white"
                  >
                    {importing ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Salvando...</>
                    ) : (
                      <><CheckCircle className="w-4 h-4" /> Confirmar Importação ({preview.valid_lines} peças)</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
