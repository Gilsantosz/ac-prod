import { corsHeaders, json, requireAiUser } from '../_shared/aiOperations.ts';

function esc(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { admin, user, profile } = await requireAiUser(req);
    const { reportJobId, format } = await req.json();
    const { data: job, error } = await admin.from('report_jobs').select('*').eq('id', reportJobId).single();
    if (error || !job) throw new Error('Relatório não encontrado.');
    if (profile.role !== 'admin' && profile.role !== 'manager' && job.requested_by !== user.id) throw new Error('ACCESS_DENIED');
    const snapshot = job.snapshot || {};
    const summary = snapshot.summary || snapshot.analysis?.kpis || {};
    if (format === 'csv') {
      const content = '\uFEFF' + [['Leo Madeiras','AC.Prod'],['Relatório',job.title],['Produzido',summary.produced],['Aprovado',summary.approved],['Reprovado',summary.rejected],['Pendente',summary.pending],['Meta',summary.target],['Eficiência',summary.efficiency],[],['Pedido','Lote','Carga','Cliente','Razão Social','Produto','Roteiro','Finalização','Pallet','Célula','Etapa','Produzido','Aprovado','Reprovado','Pendente','Refugo','Parada','Status'],...(snapshot.entries || []).map((row: any) => [row.order_number,row.lot_code,row.load_number,row.customer_trade_name || row.customer_name,row.customer_legal_name,row.product_name,row.route_name,row.finalization_date,row.pallet_number,row.cell,row.process_step,row.produced,row.approved_quantity,row.rejected_quantity,row.pending_quantity,row.scrap,row.downtime,row.approval_status])].map((row) => row.map(esc).join(';')).join('\n');
      return json({ success: true, fileName: `${job.title}.csv`, mimeType: 'text/csv', contentBase64: btoa(unescape(encodeURIComponent(content))) });
    }
    const html = `<!doctype html><html><body style="font-family:Arial"><header style="background:#00522d;color:#fff;padding:20px"><b style="color:#fff200;font-size:24px">Leo Madeiras</b><div>AC.Prod - Controle e Rastreabilidade</div></header><h1>${job.title}</h1><p>Produzido: ${summary.produced || 0} | Meta: ${summary.target || 0} | Eficiência: ${Number(summary.efficiency || 0).toFixed(1)}%</p></body></html>`;
    return json({ success: true, fileName: `${job.title}.${format === 'xlsx' ? 'xls' : 'html'}`, mimeType: format === 'xlsx' ? 'application/vnd.ms-excel' : 'text/html', contentBase64: btoa(unescape(encodeURIComponent(html))) });
  } catch (error) {
    const status = error.message === 'AUTH_REQUIRED' ? 401 : error.message === 'ACCESS_DENIED' ? 403 : 500;
    return json({ success: false, error: error.message }, status);
  }
});
