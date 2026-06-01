import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Lê registros de produção de uma tabela no projeto Supabase do usuário (read-only)
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const tableName = body.table || 'production_entries';
        const limit = body.limit || 200;

        const { accessToken } = await base44.asServiceRole.connectors.getConnection('supabase');

        // 1. Descobrir o project ref
        const projectsRes = await fetch('https://api.supabase.com/v1/projects', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const projects = await projectsRes.json();
        if (!projectsRes.ok || !Array.isArray(projects) || projects.length === 0) {
            return Response.json({ error: 'Nenhum projeto Supabase encontrado', details: projects }, { status: 400 });
        }
        const projectRef = (body.projectRef && projects.find(p => p.id === body.projectRef)?.id) || projects[0].id;

        // 2. Obter a service_role key
        const keysRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const keys = await keysRes.json();
        if (!keysRes.ok || !Array.isArray(keys)) {
            return Response.json({ error: 'Não foi possível obter as chaves do projeto', details: keys }, { status: 400 });
        }
        const serviceKey = keys.find(k => k.name === 'service_role')?.api_key;
        if (!serviceKey) {
            return Response.json({ error: 'service_role key não encontrada' }, { status: 400 });
        }

        // 3. Ler os dados via PostgREST
        const dataRes = await fetch(`https://${projectRef}.supabase.co/rest/v1/${tableName}?select=*&limit=${limit}`, {
            headers: {
                'apikey': serviceKey,
                'Authorization': `Bearer ${serviceKey}`
            }
        });

        if (!dataRes.ok) {
            const err = await dataRes.text();
            return Response.json({ error: `Erro ao ler tabela "${tableName}"`, details: err }, { status: dataRes.status });
        }

        const rows = await dataRes.json();
        return Response.json({ success: true, projectRef, table: tableName, count: rows.length, rows });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});