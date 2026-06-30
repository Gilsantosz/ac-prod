import { supabase } from '@/lib/supabaseClient';
import { parseIntent } from './aiIntentParser';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function findRecipientByEmail(email, user) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(cleanEmail)) return null;

  // 1. Procurar em report_recipients
  const { data: rec } = await supabase
    .from('report_recipients')
    .select('*')
    .eq('email', cleanEmail)
    .limit(1);

  if (rec && rec.length > 0) return rec[0];

  // 2. Procurar em profiles
  const { data: prof } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', cleanEmail)
    .limit(1);

  if (prof && prof.length > 0) {
    return {
      name: prof[0].name,
      email: cleanEmail,
      role_label: prof[0].role === 'admin' ? 'Administrador' : 'Gestor',
      recipient_group: 'manager',
      profile_id: prof[0].id,
      active: true,
    };
  }

  return null;
}

export async function ensureRecipientsForEmail(recipients = [], user) {
  const resolved = [];
  for (const rec of recipients) {
    const email = String(rec.email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) continue;

    const existing = await findRecipientByEmail(email, user);
    if (existing && existing.id) {
      resolved.push(existing);
      continue;
    }

    // Criar destinatário em report_recipients com recipient_group = 'other'
    const name = rec.name || email.split('@')[0];
    const { data: inserted, error } = await supabase
      .from('report_recipients')
      .insert({
        name,
        email,
        role_label: 'Destinatário externo/manual',
        recipient_group: 'other',
        active: true,
      })
      .select()
      .single();

    if (!error && inserted) {
      resolved.push(inserted);
    }
  }
  return resolved;
}

export async function findRecipientsByName(name, user) {
  const cleanName = String(name || '').trim().replace(/[%_]/g, '');
  if (cleanName.length < 2) return [];

  const [recipientsResult, profilesResult, operatorsResult] = await Promise.all([
    supabase.from('report_recipients').select('*').eq('active', true).ilike('name', `%${cleanName}%`).limit(10),
    supabase.from('profiles').select('*').eq('active', true).in('role', ['admin', 'manager']).ilike('name', `%${cleanName}%`).limit(10),
    supabase.from('operators').select('*').eq('active', true).ilike('name', `%${cleanName}%`).limit(10),
  ]);

  const candidates = [];
  const emailsSeen = new Set();

  const addCandidate = (item) => {
    const email = String(item.email || '').trim().toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email) || emailsSeen.has(email)) return;
    emailsSeen.add(email);
    candidates.push(item);
  };

  if (recipientsResult.data) {
    recipientsResult.data.forEach(r => addCandidate({ ...r, source: 'recipient' }));
  }
  if (profilesResult.data) {
    profilesResult.data.forEach(p => addCandidate({ ...p, source: 'profile', role_label: p.role === 'admin' ? 'Administrador' : 'Gestor' }));
  }
  if (operatorsResult.data) {
    operatorsResult.data.forEach(o => addCandidate({ ...o, source: 'operator', role_label: 'Operador' }));
  }

  return candidates;
}

export async function findRecipientsByRole(role, user) {
  const cleanRole = String(role || '').trim().toLowerCase();
  const targetRoles = [];
  if (cleanRole === 'admin' || cleanRole === 'administrador' || cleanRole === 'administradores') {
    targetRoles.push('admin');
  } else if (cleanRole === 'manager' || cleanRole === 'gestor' || cleanRole === 'gestores' || cleanRole === 'gerente' || cleanRole === 'gerência') {
    targetRoles.push('manager', 'admin');
  } else {
    targetRoles.push(cleanRole);
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .eq('active', true)
    .in('role', targetRoles);

  return profiles || [];
}

export async function findRecipientsByCell(cellName, user) {
  const cleanCell = String(cellName || '').trim().toLowerCase();
  
  // 1. Encontrar profiles cujas managed_cells contêm esta célula
  const { data: allProfiles } = await supabase
    .from('profiles')
    .select('*')
    .eq('active', true);
  
  const matchedProfiles = (allProfiles || []).filter(p => {
    const cells = Array.isArray(p.managed_cells) ? p.managed_cells : [];
    return cells.some(c => String(c).trim().toLowerCase() === cleanCell);
  });

  // 2. Encontrar report_recipients que possuem filtro de célula para esta célula
  const { data: recs } = await supabase
    .from('report_recipients')
    .select('*')
    .eq('active', true);
  
  const matchedRecs = (recs || []).filter(r => {
    const cells = Array.isArray(r.cell_filter) ? r.cell_filter : [];
    return cells.some(c => String(c).trim().toLowerCase() === cleanCell);
  });

  const unique = [];
  const emails = new Set();
  const add = (r) => {
    if (r.email && !emails.has(r.email.toLowerCase())) {
      emails.add(r.email.toLowerCase());
      unique.push(r);
    }
  };

  matchedProfiles.forEach(add);
  matchedRecs.forEach(add);

  return unique;
}

export async function resolveRecipientsFromPrompt(prompt, user) {
  const intent = parseIntent(prompt);
  const candidates = intent.recipients || [];
  const resolved = [];
  const ambiguous = [];
  const notFound = [];

  for (const cand of candidates) {
    // 1. E-mail direto
    if (EMAIL_PATTERN.test(cand)) {
      const ensured = await ensureRecipientsForEmail([{ email: cand }], user);
      if (ensured.length > 0) resolved.push(ensured[0]);
      continue;
    }

    // 2. Todos os gestores
    if (cand.toLowerCase() === 'todos os gestores' || cand.toLowerCase() === 'gerencia' || cand.toLowerCase() === 'diretoria') {
      const gestores = await findRecipientsByRole('manager', user);
      gestores.forEach(g => {
        if (!resolved.some(r => r.email.toLowerCase() === g.email.toLowerCase())) {
          resolved.push({
            id: g.id,
            name: g.name,
            email: g.email,
            recipient_group: 'manager',
            active: true,
          });
        }
      });
      continue;
    }

    // 3. Gestores por célula
    if (cand.toLowerCase().startsWith('gestores da ') || cand.toLowerCase().startsWith('gestores do ')) {
      const cell = cand.replace(/^(gestores da |gestores do )/i, '').trim();
      const cellRecs = await findRecipientsByCell(cell, user);
      cellRecs.forEach(r => resolved.push(r));
      continue;
    }

    // 4. Busca por nome
    const matches = await findRecipientsByName(cand, user);
    if (matches.length === 1) {
      resolved.push(matches[0]);
    } else if (matches.length > 1) {
      ambiguous.push({ requested: cand, matches });
    } else {
      notFound.push(cand);
    }
  }

  return {
    resolved,
    ambiguous,
    notFound,
  };
}
