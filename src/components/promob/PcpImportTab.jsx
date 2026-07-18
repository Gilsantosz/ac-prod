import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Upload, FileText, CheckCircle, AlertTriangle, RefreshCw, X, Download
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function PcpImportTab({ preselectedFile, clearPreselected }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ processed: 0, total: 0 });
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

  const buildManualJoineryUid = (colsClean, rowNumber) => {
    const raw = [
      'MARCENARIA',
      colsClean[25] || 'SEM-LOTE-GERAL',
      colsClean[28] || 'SEM-LOTE-CLIENTE',
      colsClean[13] || `LINHA-${rowNumber}`,
    ].join('-');
    return raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
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
          
          // O exportador PCP pode armazenar a linha inteira em uma célula ou
          // fragmentá-la em células vizinhas. Não insere espaços artificiais.
          const joined = rowData.map(c => String(c ?? '')).join('');
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
        } catch {
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
      const normalizedRows = [];
      const seenBarcodes = new Set();
      const clientLotCustomers = new Map();

      // Coleta todos os barcodes únicos para consulta rápida de colisão no banco
      const fileBarcodes = [...new Set(rawRows.flatMap((cols, rowIndex) => {
        const colsClean = cols.map(cleanCell);
        const barcode = colsClean[14] || buildManualJoineryUid(colsClean, rowIndex + 1);
        return barcode ? [barcode] : [];
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
      let generalLotCode = "";
      let customer = "";
      let projectName = "";

      for (let i = 0; i < rawRows.length; i++) {
        const cols = rawRows[i];
        const rowNum = i + 1;
        const colsClean = cols.map(cleanCell);
        const physicalBarcode = colsClean[14] || "";
        const checkBarcode = colsClean[24] || "";
        const route = colsClean[26] || "";
        const rowGeneralLotCode = colsClean[25] || "";
        const rowClientLotCode = colsClean[28] || "";
        const manualJoinery = !physicalBarcode && Boolean(colsClean[13]);
        const traceabilityCode = physicalBarcode || buildManualJoineryUid(colsClean, rowNum);

        if (orderCode === "" && rowClientLotCode !== "") orderCode = rowClientLotCode;
        if (generalLotCode === "" && rowGeneralLotCode !== "") generalLotCode = rowGeneralLotCode;
        if (customer === "" && colsClean[2] !== "") customer = colsClean[2];
        if (projectName === "" && colsClean[1] !== "") projectName = colsClean[1];

        const rowPayload = {
          row_number: rowNum,
          raw_cells: cols,
          generalLotCode: rowGeneralLotCode,
          clientLotCode: rowClientLotCode,
          orderCode: rowClientLotCode,
          customer: colsClean[2] || "",
          projectName: colsClean[1] || "",
          environmentName: colsClean[1] || "",
          moduleName: colsClean[15] || colsClean[16] || "",
          pieceCode: colsClean[13] || traceabilityCode,
          pieceName: colsClean[11] || "",
          materialCode: colsClean[8] || "",
          material: colsClean[10] || "",
          color: colsClean[21] || colsClean[32] || "",
          thickness: colsClean[7] || "",
          width: colsClean[5] || "",
          height: colsClean[6] || "",
          quantity: 1,
          manualJoinery,
          manualJoineryReason: manualJoinery ? 'Peça especial sem código de barras — baixa manual na Marcenaria' : '',
          sourceGroup: colsClean[0] || "",
          lineSequence: colsClean[12] || "",
          barcode: traceabilityCode,
          physicalBarcode,
          checkBarcode: checkBarcode,
          route: route,
          sourceFormat: extension,
        };

        const errors = [];

        if (!rowPayload.generalLotCode) {
          errors.push('Lote geral PCP (campo 26 / valor de 5 dígitos) não informado.');
        } else if (generalLotCode && rowPayload.generalLotCode !== generalLotCode) {
          errors.push(`Lote geral divergente: esperado ${generalLotCode}, recebido ${rowPayload.generalLotCode}.`);
        }

        if (!rowPayload.clientLotCode) {
          errors.push('Lote do cliente (código de 6 dígitos) não informado.');
        } else if (!rowPayload.customer) {
          errors.push(`Cliente não informado para o lote ${rowPayload.clientLotCode}.`);
        } else {
          const normalizedCustomer = rowPayload.customer.trim().toUpperCase();
          const existingCustomer = clientLotCustomers.get(rowPayload.clientLotCode);
          if (existingCustomer && existingCustomer !== normalizedCustomer) {
            errors.push(`Lote ${rowPayload.clientLotCode} possui clientes diferentes no arquivo.`);
          } else {
            clientLotCustomers.set(rowPayload.clientLotCode, normalizedCustomer);
          }
        }

        if (!physicalBarcode && !manualJoinery) {
          errors.push("Linha sem código de barras e sem código de peça para identificação manual.");
        } else {
          if (physicalBarcode && physicalBarcode !== checkBarcode) {
            errors.push(`Código de barras da Coluna O (${physicalBarcode}) divergente da Coluna Y (${checkBarcode}).`);
          }
          if (seenBarcodes.has(traceabilityCode)) {
            errors.push(`Identificação de peça duplicada no arquivo: ${traceabilityCode}.`);
          } else {
            seenBarcodes.add(traceabilityCode);
          }
          const collisions = dbBarcodes.has(traceabilityCode) ? [traceabilityCode] : [];
          if (collisions.length > 0) {
            errors.push(`Código(s) já cadastrado(s) no banco: ${collisions.slice(0, 5).join(', ')}${collisions.length > 5 ? '…' : ''}.`);
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
        normalizedRows.push({ ...rowPayload, validationErrors: errors });
      }

      // Regra PCP: cada ocorrência/linha representa exatamente uma peça.
      const totalPieces = normalizedRows.length;
      const groupMap = new Map();
      normalizedRows.forEach((row) => {
        const key = row.clientLotCode || `linha-sem-lote-${row.row_number}`;
        const current = groupMap.get(key) || {
          generalLotCode: row.generalLotCode || 'Sem lote geral',
          clientLotCode: row.clientLotCode || 'Sem lote cliente',
          orderCode: row.orderCode || 'Sem pedido',
          customer: row.customer || 'Cliente não informado',
          pieces: 0,
          validPieces: 0,
          manualJoineryPieces: 0,
        };
        current.pieces += 1;
        if (row.validationErrors.length === 0) current.validPieces += 1;
        if (row.manualJoinery) current.manualJoineryPieces += 1;
        groupMap.set(key, current);
      });
      const validCustomers = new Set();
      const emptyCustomerLots = new Set();
      normalizedRows.forEach((row) => {
        const customerClean = (row.customer || '').trim();
        if (!customerClean || customerClean === 'Cliente não informado') {
          if (row.clientLotCode) {
            emptyCustomerLots.add(row.clientLotCode);
          }
        } else {
          validCustomers.add(customerClean);
        }
      });
      const coversCount = validCustomers.size + emptyCustomerLots.size;

      const groups = [...groupMap.values()].sort((a, b) => b.pieces - a.pieces);

      setPreview({
        general_lot_code: generalLotCode || selectedFile.name.replace(/\.[^.]+$/, ''),
        total_lines: rawRows.length,
        valid_lines: validRows.length,
        total_pieces: totalPieces,
        valid_pieces: validRows.length,
        error_lines: errorRows.length,
        manual_joinery_lines: normalizedRows.filter(row => row.manualJoinery).length,
        errors: errorRows,
        lot_code: generalLotCode,
        order_code: orderCode,
        customer: customer,
        project_name: projectName,
        validRows: validRows,
        groups,
        lots_count: new Set(normalizedRows.map(row => row.clientLotCode).filter(Boolean)).size,
        orders_count: new Set(normalizedRows.map(row => row.orderCode).filter(Boolean)).size,
        customers_count: new Set(normalizedRows.map(row => row.customer).filter(Boolean)).size,
        covers_count: coversCount,
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
    setImportProgress({ processed: 0, total: preview.validRows.length });
    let batchId = preview.import_batch_id || null;
    try {
      const userRes = await supabase.auth.getUser();
      const userId = userRes.data.user?.id;

      // 1. Criar o cabeçalho ou retomar o mesmo batch após uma falha de rede.
      // A RPC é idempotente dentro do batch, então os blocos já confirmados
      // não geram peças duplicadas ao retomar.
      if (batchId) {
        const { error: resumeError } = await supabase
          .from('promob_import_batches')
          .update({ status: 'pending', error_message: null })
          .eq('id', batchId);
        if (resumeError) throw resumeError;
      } else {
        const { data: batch, error: batchError } = await supabase
          .from("promob_import_batches")
          .insert({
            file_name: file.name,
            general_lot_code: preview.general_lot_code || file.name.replace(/\.[^.]+$/, ''),
            file_size: file.size,
            status: "pending",
            source_type: "xml_upload",
            source_format: file.name.split('.').pop()?.toLowerCase() || 'xlsx',
            mapping_profile: "pcp_promob_semicolon_v2",
            mapping_version: 2,
            total_lines: preview.total_lines,
            valid_lines: preview.valid_lines,
            imported_by: userId,
          })
          .select()
          .single();

        if (batchError) throw batchError;
        batchId = batch.id;
        setPreview(current => ({ ...current, import_batch_id: batchId }));
      }

      // 2. Enviar em blocos para não impor limite fixo de peças ao lote geral.
      // Todos os blocos usam o mesmo batchId e o servidor só finaliza o último.
      const chunkSize = 400;
      const chunks = [];
      for (let index = 0; index < preview.validRows.length; index += chunkSize) {
        chunks.push(preview.validRows.slice(index, index + chunkSize));
      }

      let commitRes = null;
      let processed = 0;
      for (let index = 0; index < chunks.length; index += 1) {
        const { data, error: commitError } = await supabase.rpc(
          "commit_pcp_import",
          {
            p_batch_id: batchId,
            p_order_code: preview.order_code || `PED-${Date.now()}`,
            p_lot_code: preview.lot_code || `LOTE-${Date.now()}`,
            p_customer: preview.customer || "Consumidor Final",
            p_project_name: preview.project_name || "Projeto Manual",
            p_mapping_profile: "pcp_promob_semicolon_v2",
            p_mapping_version: 2,
            p_rows: chunks[index],
            p_finalize: index === chunks.length - 1,
          }
        );

        if (commitError) throw commitError;
        commitRes = data;
        processed += chunks[index].length;
        setImportProgress({ processed, total: preview.validRows.length });
      }

      toast.success(`Importação realizada com sucesso! ${commitRes.pieces_created} peças importadas.`);
      
      setPreview(prev => ({
        ...prev,
        committed: true,
        import_batch_id: batchId,
        import_error: null,
      }));
    } catch (err) {
      if (batchId) {
        await supabase
          .from('promob_import_batches')
          .update({ status: 'error', error_message: err.message })
          .eq('id', batchId);
      }
      setPreview(current => current ? ({
        ...current,
        import_batch_id: batchId,
        import_error: err.message,
      }) : current);
      toast.error(`Erro ao salvar importação: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setPreview(null);
    setImportProgress({ processed: 0, total: 0 });
    if (fileRef.current) fileRef.current.value = '';
  };

  const downloadErrorCsv = () => {
    if (!preview || !preview.errors || preview.errors.length === 0) return;

    const headers = ["Linha", "Lote Geral PCP", "Lote do Cliente", "Cliente", "Código da Peça", "Código de Barras O", "Código de Barras Y", "Erros"];
    const rows = preview.errors.map(err => [
      err.row_number,
      err.payload?.generalLotCode || "",
      err.payload?.clientLotCode || "",
      err.payload?.customer || "",
      err.payload?.pieceCode || "",
      err.payload?.physicalBarcode || "",
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
          <Upload className="w-5 h-5 text-[#2d9c4a]" /> Importador PCP Padrão V2
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
            Formatos suportados: XLSX, XLS, CSV, TSV, TXT, HTML e XML · sem limite fixo de peças
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
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
                <Card className="p-4 border border-border/60 shadow-sm text-center">
                  <p className="text-xs text-muted-foreground font-medium">Peças no Arquivo</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{preview.total_lines || 0}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-green-500/5">
                  <p className="text-xs text-green-700 dark:text-green-400 font-medium">Aptas a Importar</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{preview.valid_pieces || 0}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-blue-500/5">
                  <p className="text-xs text-blue-700 dark:text-blue-400 font-medium">Lotes de Clientes</p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{preview.lots_count || 0}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-purple-500/5">
                  <p className="text-xs text-purple-700 dark:text-purple-400 font-medium">Capas de Cliente</p>
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">{preview.covers_count || 0}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-amber-500/5">
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Marcenaria Manual</p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{preview.manual_joinery_lines || 0}</p>
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
                    <CheckCircle className="w-4 h-4 text-green-500" /> Agrupamento PCP detectado
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs pt-1">
                    <div>
                      <p className="text-muted-foreground font-medium">Lotes</p>
                      <p className="font-bold text-foreground mt-0.5">{preview.lots_count || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium">Capas de Cliente</p>
                      <p className="font-bold text-purple-600 dark:text-purple-400 mt-0.5">{preview.covers_count || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium">Pedidos / OPs</p>
                      <p className="font-bold text-foreground mt-0.5">{preview.orders_count || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium">Clientes</p>
                      <p className="font-bold text-foreground mt-0.5">{preview.customers_count || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium">Linhas válidas</p>
                      <p className="font-bold text-foreground mt-0.5">{preview.valid_lines || 0}</p>
                    </div>
                  </div>
                  <label className="block text-xs text-muted-foreground">
                    Lote geral / carga PCP detectado no arquivo
                    <input
                      value={preview.general_lot_code || ''}
                      readOnly
                      className="mt-1 w-full h-9 rounded-lg border border-input bg-secondary/40 px-3 font-mono font-bold text-foreground"
                      placeholder="Ex.: 15587"
                    />
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    A quantidade de cada lote de cliente é a contagem de ocorrências desse código nas linhas do arquivo.
                  </p>
                  <div className="max-h-44 overflow-y-auto rounded-xl border border-border/40 divide-y divide-border/40">
                    {preview.groups?.slice(0, 100).map((group) => (
                      <div key={`${group.clientLotCode}-${group.customer}`} className="grid grid-cols-4 gap-2 px-3 py-2 text-[11px]">
                        <span className="font-bold text-foreground truncate" title={group.clientLotCode}>{group.clientLotCode}</span>
                        <span className="col-span-2 text-muted-foreground truncate" title={group.customer}>{group.customer}</span>
                        <span className="font-bold text-right text-emerald-600">
                          {group.validPieces === group.pieces ? `${group.pieces} peças` : `${group.validPieces}/${group.pieces} aptas`}
                          {group.manualJoineryPieces > 0 && (
                            <span className="block text-[9px] text-amber-600">{group.manualJoineryPieces} Marcenaria</span>
                          )}
                        </span>
                      </div>
                    ))}
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
                          O: {err.payload?.physicalBarcode || "Vazio"} | Y: {err.payload?.checkBarcode || "Vazio"}
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
                    disabled={importing || preview.valid_lines === 0 || preview.error_lines > 0}
                    className="gap-2 bg-[#2d9c4a] hover:bg-[#25813d] text-white"
                  >
                    {importing ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Salvando {importProgress.processed}/{importProgress.total} linhas...</>
                    ) : (
                      preview.error_lines > 0 ? (
                        <><AlertTriangle className="w-4 h-4" /> Corrija as {preview.error_lines} linhas com erro</>
                      ) : (
                        <><CheckCircle className="w-4 h-4" /> {preview.import_batch_id ? 'Retomar' : 'Confirmar'} Importação ({preview.valid_pieces || preview.valid_lines} peças)</>
                      )
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
