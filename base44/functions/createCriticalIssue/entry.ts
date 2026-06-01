import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { owner, repo, title, body, labels } = await req.json();
        if (!owner || !repo || !title) {
            return Response.json({ error: 'owner, repo e title são obrigatórios' }, { status: 400 });
        }

        const { accessToken } = await base44.asServiceRole.connectors.getConnection('github');

        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({
                title,
                body: body || '',
                labels: labels && labels.length ? labels : ['falha-crítica', 'produção']
            })
        });

        const data = await res.json();
        if (!res.ok) {
            return Response.json({ error: data.message || 'Erro ao criar issue', details: data }, { status: res.status });
        }

        return Response.json({ success: true, issue_url: data.html_url, number: data.number });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});