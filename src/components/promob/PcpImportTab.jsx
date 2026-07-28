import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Upload, FileText, CheckCircle, RefreshCw, X, Plus, Trash2, Layers
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { assertSafeImportFile, assertWorksheetBounds } from '@/lib/spreadsheetSecurity';

export default function PcpImportTab({ preselectedFile, clearPreselected }) {
  const [files, setFiles] = useState([]);
  const [fileItems, setFileItems] = useState([]);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ currentFileIndex: 0, currentFileName: '', processed: 0, total: 0 });
  const fileRef = useRef(null);

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

  // Processa um único arquivo e retorna seu preview
  const parseSingleFile = async (selectedFile) => {
    const extension = assertSafeImportFile(
      selectedFile,
      ['xlsx', 'xls', 'csv', 'tsv', 'txt', 'html', 'htm', 'xml']
    );
    const isBinary = ['xlsx', 'xls'].includes(extension);

    let rawRows = [];

    if (isBinary) {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      assertWorksheetBounds(worksheet, XLSX.utils);
      const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      for (let i = 0; i < sheetData.length; i++) {
        const rowData = sheetData[i];
        if (!rowData || rowData.length === 0) continue;
        const joined = rowData.map(c => String(c ?? '')).join('');
        if (joined.trim() === '') continue;
        const cols = joined.split(';');
        rawRows.push(cols);
      }
    } else {
      const arrayBuffer = await selectedFile.arrayBuffer();
      let text = "";
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        text = decoder.decode(arrayBuffer);
        if (text.includes("\uFFFD")) throw new Error("Caracteres corrompidos.");
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

    const validRows = [];
    const errorRows = [];
    const normalizedRows = [];
    const seenBarcodes = new Set();
    const clientLotCustomers = new Map();

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
        errors.push('Lote geral PCP (campo 26) não informado.');
      } else if (generalLotCode && rowPayload.generalLotCode !== generalLotCode) {
        errors.push(`Lote geral divergente: esperado ${generalLotCode}, recebido ${rowPayload.generalLotCode}.`);
      }

      if (!rowPayload.clientLotCode) {
        errors.push('Lote do cliente não informado.');
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
          errors.push(`Código de barras O (${physicalBarcode}) divergente de Y (${checkBarcode}).`);
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
        if (row.clientLotCode) emptyCustomerLots.add(row.clientLotCode);
      } else {
        validCustomers.add(customerClean);
      }
    });

    const groups = [...groupMap.values()].sort((a, b) => b.pieces - a.pieces);

    return {
      file_name: selectedFile.name,
      file_size: selectedFile.size,
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
      covers_count: validCustomers.size + emptyCustomerLots.size,
    };
  };

  // Atualiza e analisa a lista de arquivos selecionados
  const processFileList = async (newFileList) => {
    if (!newFileList || newFileList.length === 0) {
      setFiles([]);
      setFileItems([]);
      return;
    }

    setLoading(true);
    const uniqueFiles = [];
    const seenNames = new Set();

    newFileList.forEach(f => {
      if (!seenNames.has(f.name)) {
        seenNames.add(f.name);
        uniqueFiles.push(f);
      }
    });

    setFiles(uniqueFiles);

    const items = [];
    for (const f of uniqueFiles) {
      try {
        const preview = await parseSingleFile(f);
        items.push({ id: f.name, file: f, preview, error: null });
      } catch (err) {
        items.push({ id: f.name, file: f, preview: null, error: err.message });
      }
    }

    setFileItems(items);
    setLoading(false);
    toast.success(`${uniqueFiles.length} arquivo(s) lido(s) com sucesso! Analise o preview antes de importar.`);
  };

  // Se houver um arquivo pré-selecionado (passado por auto-detecção da aba Promob)
  useEffect(() => {
    if (preselectedFile) {
      processFileList([preselectedFile]);
      if (clearPreselected) clearPreselected();
    }
  }, [preselectedFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files || []);
    if (droppedFiles.length > 0) {
      processFileList([...files, ...droppedFiles]);
    }
  }, [files]);

  const handleFileChange = useCallback((e) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      processFileList([...files, ...selectedFiles]);
    }
  }, [files]);

  const handleRemoveFile = (fileName) => {
    const updated = files.filter(f => f.name !== fileName);
    processFileList(updated);
  };

  const handleClearAll = () => {
    setFiles([]);
    setFileItems([]);
    setActiveFileIndex(0);
    setImportProgress({ currentFileIndex: 0, currentFileName: '', processed: 0, total: 0 });
    if (fileRef.current) fileRef.current.value = '';
  };

  // Métricas agregadas combinadas de todos os arquivos lidos
  const combinedMetrics = {
    totalFiles: fileItems.length,
    totalPieces: fileItems.reduce((acc, item) => acc + (item.preview?.total_lines || 0), 0),
    validPieces: fileItems.reduce((acc, item) => acc + (item.preview?.valid_pieces || 0), 0),
    manualJoinery: fileItems.reduce((acc, item) => acc + (item.preview?.manual_joinery_lines || 0), 0),
    errorLines: fileItems.reduce((acc, item) => acc + (item.preview?.error_lines || 0), 0),
    lotsCount: fileItems.reduce((acc, item) => acc + (item.preview?.lots_count || 0), 0),
    coversCount: fileItems.reduce((acc, item) => acc + (item.preview?.covers_count || 0), 0),
    generalLots: [...new Set(fileItems.map(item => item.preview?.general_lot_code).filter(Boolean))],
  };

  // Salva e submete todos os arquivos selecionados para produção em lote
  const handleImportCommitAll = async () => {
    const validItems = fileItems.filter(item => item.preview && item.preview.validRows && item.preview.validRows.length > 0 && !item.preview.committed);
    if (validItems.length === 0) {
      toast.error('Nenhum arquivo válido disponível para importação.');
      return;
    }

    setImporting(true);
    let totalPiecesCreatedAll = 0;
    const userRes = await supabase.auth.getUser();
    const userId = userRes.data.user?.id;

    for (let fIdx = 0; fIdx < validItems.length; fIdx++) {
      const item = validItems[fIdx];
      const preview = item.preview;
      const fileObj = item.file;

      setImportProgress({
        currentFileIndex: fIdx + 1,
        totalFiles: validItems.length,
        currentFileName: fileObj.name,
        processed: 0,
        total: preview.validRows.length,
      });

      let batchId = preview.import_batch_id || null;

      try {
        if (batchId) {
          await supabase
            .from('promob_import_batches')
            .update({ status: 'pending', error_message: null })
            .eq('id', batchId);
        } else {
          const { data: batch, error: batchError } = await supabase
            .from("promob_import_batches")
            .insert({
              file_name: fileObj.name,
              general_lot_code: preview.general_lot_code || fileObj.name.replace(/\.[^.]+$/, ''),
              file_size: fileObj.size,
              status: "pending",
              source_type: "xml_upload",
              source_format: fileObj.name.split('.').pop()?.toLowerCase() || 'xlsx',
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
          item.preview.import_batch_id = batchId;
        }

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
          setImportProgress({
            currentFileIndex: fIdx + 1,
            totalFiles: validItems.length,
            currentFileName: fileObj.name,
            processed,
            total: preview.validRows.length,
          });
        }

        totalPiecesCreatedAll += Number(commitRes?.pieces_created || 0);
        item.preview.committed = true;
        item.preview.import_batch_id = batchId;
      } catch (err) {
        if (batchId) {
          await supabase
            .from('promob_import_batches')
            .update({ status: 'error', error_message: err.message })
            .eq('id', batchId);
        }
        item.preview.import_error = err.message;
        toast.error(`Erro ao importar arquivo ${fileObj.name}: ${err.message}`);
      }
    }

    setImporting(false);
    toast.success(`Importação em lote concluída com sucesso! ${totalPiecesCreatedAll} peças criadas para produção.`);
    setFileItems([...fileItems]);
  };

  const currentPreviewItem = fileItems[activeFileIndex] || fileItems[0];
  const activePreview = currentPreviewItem?.preview;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Upload className="w-5 h-5 text-[#2d9c4a]" /> Importador PCP Padrão V2
          </h3>
          <p className="text-xs text-muted-foreground">
            Selecione ou arraste **um ou múltiplos arquivos do PCP** (XLSX, XLS, CSV, TSV, TXT, HTML ou XML) para produção.
          </p>
        </div>
        {files.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={loading || importing}
              className="text-xs gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar Arquivos
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              disabled={loading || importing}
              className="text-xs text-rose-500 hover:text-rose-600 gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Limpar Todos
            </Button>
          </div>
        )}
      </div>

      <input
        type="file"
        ref={fileRef}
        onChange={handleFileChange}
        multiple
        accept=".xlsx,.xls,.csv,.tsv,.txt,.html,.htm,.xml"
        className="hidden"
      />

      {files.length === 0 ? (
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-border/60 hover:border-[#2d9c4a]/50 rounded-2xl p-10 text-center cursor-pointer transition-colors bg-card hover:bg-[#2d9c4a]/5"
        >
          <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
          <p className="font-medium text-foreground text-sm">Arraste e solte seus arquivos aqui</p>
          <p className="text-xs text-muted-foreground mt-1">ou clique para selecionar em seu computador (suporta múltiplos arquivos)</p>
          <p className="text-[10px] text-muted-foreground mt-3">
            Formatos suportados: XLSX, XLS, CSV, TSV, TXT, HTML e XML · sem limite de arquivos ou peças
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Card com a Lista de Arquivos Selecionados */}
          <Card className="p-4 border border-border/60 bg-secondary/15 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#2d9c4a]" /> Arquivos Selecionados para Produção ({files.length})
              </p>
              <Badge variant="outline" className="text-xs font-semibold text-[#2d9c4a] border-[#2d9c4a]/40 bg-[#2d9c4a]/10">
                {combinedMetrics.validPieces} peças aptas totais
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {fileItems.map((item, idx) => (
                <div
                  key={item.id}
                  onClick={() => setActiveFileIndex(idx)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    activeFileIndex === idx
                      ? 'border-[#2d9c4a] bg-card shadow-sm'
                      : 'border-border/60 bg-card/60 hover:bg-card'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <FileText className="w-5 h-5 text-blue-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-xs text-foreground truncate">{item.file.name}</p>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{(item.file.size / 1024).toFixed(1)} KB</span>
                        {item.preview && (
                          <span className="text-[#2d9c4a] font-bold">
                            · {item.preview.valid_pieces} peças
                          </span>
                        )}
                        {item.preview?.committed && (
                          <span className="text-emerald-500 font-bold flex items-center gap-0.5">
                            <CheckCircle className="w-2.5 h-2.5" /> Importado
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-rose-500 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveFile(item.file.name);
                    }}
                    disabled={loading || importing}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          {loading && (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#2d9c4a]" />
              <p className="text-xs font-semibold">Processando e validando arquivos do PCP...</p>
            </div>
          )}

          {importing && (
            <Card className="p-5 border border-[#2d9c4a]/40 bg-[#2d9c4a]/5 space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-2 text-foreground">
                  <RefreshCw className="w-4 h-4 animate-spin text-[#2d9c4a]" />
                  Importando arquivo {importProgress.currentFileIndex} de {importProgress.totalFiles}: {importProgress.currentFileName}
                </span>
                <span className="text-[#2d9c4a] font-bold">
                  {importProgress.processed} / {importProgress.total} peças
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-[#2d9c4a] transition-all duration-300"
                  style={{
                    width: importProgress.total > 0
                      ? `${Math.min(100, Math.round((importProgress.processed / importProgress.total) * 100))}%`
                      : '0%',
                  }}
                />
              </div>
            </Card>
          )}

          {/* Cards de Métricas Consolidadas dos Arquivos */}
          {fileItems.length > 0 && !loading && (
            <div className="space-y-6 animate-in fade-in-50 duration-200">
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
                <Card className="p-4 border border-border/60 shadow-sm text-center">
                  <p className="text-xs text-muted-foreground font-medium">Arquivos Lidos</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{combinedMetrics.totalFiles}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-green-500/5">
                  <p className="text-xs text-green-700 dark:text-green-400 font-medium">Peças Aptas Totais</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{combinedMetrics.validPieces}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-blue-500/5">
                  <p className="text-xs text-blue-700 dark:text-blue-400 font-medium">Lotes de Clientes</p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{combinedMetrics.lotsCount}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-purple-500/5">
                  <p className="text-xs text-purple-700 dark:text-purple-400 font-medium">Capas de Cliente</p>
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">{combinedMetrics.coversCount}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-amber-500/5">
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Marcenaria Manual</p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{combinedMetrics.manualJoinery}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-red-500/5">
                  <p className="text-xs text-red-700 dark:text-red-400 font-medium">Erros Detectados</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{combinedMetrics.errorLines}</p>
                </Card>
                <Card className="p-4 border border-border/60 shadow-sm text-center bg-[#2d9c4a]/10 border-[#2d9c4a]/30">
                  <p className="text-xs text-[#2d9c4a] font-medium">Lotes Gerais</p>
                  <p className="text-lg font-bold text-[#2d9c4a] mt-1 truncate" title={combinedMetrics.generalLots.join(', ')}>
                    {combinedMetrics.generalLots.length ? combinedMetrics.generalLots.join(', ') : '—'}
                  </p>
                </Card>
              </div>

              {/* Botão de Ação Principal: Confirmar e Importar Todos os Arquivos */}
              <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-card border border-border/60 shadow-sm flex-wrap">
                <div>
                  <p className="font-bold text-sm text-foreground">Pronto para Enviar à Produção</p>
                  <p className="text-xs text-muted-foreground">
                    Confirme para criar os lotes, ordens de produção e peças no banco de dados.
                  </p>
                </div>
                <Button
                  onClick={handleImportCommitAll}
                  disabled={importing || loading || combinedMetrics.validPieces === 0}
                  className="bg-[#2d9c4a] hover:bg-[#25823e] text-white font-bold text-sm px-6 h-11 rounded-xl shadow-lg shadow-[#2d9c4a]/20"
                >
                  {importing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                      Importando para Produção...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Importar {combinedMetrics.totalFiles} Arquivo(s) ({combinedMetrics.validPieces} Peças) para Produção
                    </>
                  )}
                </Button>
              </div>

              {/* Visualização Detalhada do Arquivo Selecionado na Lista */}
              {activePreview && (
                <Card className="p-5 border border-border/60 space-y-4">
                  <div className="flex items-center justify-between border-b border-border/40 pb-3">
                    <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-500" />
                      Detalhamento do Arquivo: <span className="text-[#2d9c4a]">{currentPreviewItem.file.name}</span>
                    </h4>
                    <Badge variant="outline" className="text-xs font-semibold">
                      {activePreview.valid_pieces} peças aptas neste arquivo
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground font-medium">Lotes do Cliente</p>
                      <p className="font-bold text-foreground mt-0.5">{activePreview.lots_count || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium">Capas de Cliente</p>
                      <p className="font-bold text-purple-600 dark:text-purple-400 mt-0.5">{activePreview.covers_count || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium">Pedidos / OPs</p>
                      <p className="font-bold text-foreground mt-0.5">{activePreview.orders_count || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium">Clientes</p>
                      <p className="font-bold text-foreground mt-0.5">{activePreview.customers_count || 0}</p>
                    </div>
                  </div>

                  <div className="max-h-52 overflow-y-auto rounded-xl border border-border/40 divide-y divide-border/40">
                    {activePreview.groups?.slice(0, 100).map((group) => (
                      <div key={`${group.clientLotCode}-${group.customer}`} className="grid grid-cols-4 gap-2 px-3 py-2 text-[11px]">
                        <span className="font-mono font-bold text-foreground truncate">{group.clientLotCode}</span>
                        <span className="text-muted-foreground truncate">{group.customer}</span>
                        <span className="text-right font-medium text-foreground">{group.pieces} peças</span>
                        <span className="text-right font-bold text-[#2d9c4a]">{group.validPieces} válidas</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
