import { supabase } from '@/lib/supabaseClient';
import { parseIntent } from './aiIntentParser';
import { normalizeText } from '@/lib/assistant/assistantEngine';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENT_USER_RECIPIENTS = new Set([
  'mim',
  'me',
  'eu',
  'meu email',
  'meu e mail',
  'meu e-mail',
  'remetente',
  'solicitante',
  'usuario atual',
  'usuário atual',
]);

function isValidEmail(email) {
  return EMAIL_PATTERN.test(String(email || '').trim());
}

function normalizeCells(row = {}) {
  if (Array.isArray(row.managed_cells) && row.managed_cells.length) return row.managed_cells;
  if (Array.isArray(row.cell_filter)) return row.cell_filter;
  if (Array.isArray(row.cell)) return row.cell;
  if (typeof row.cell === 'string' && row.cell.trim()) {
    try {
      const parsed = JSON.parse(row.cell);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // perfil legado com célula simples em texto
    }
    return [row.cell];
  }
  return [];
}

function fromProfile(profile) {
  return {
    ...profile,
    id: `profile:${profile.id}`,
    profile_id: profile.id,
    recipient_id: null,
    source: 'profile',
    source_label: profile.role === 'admin' ? 'Usuário Admin' : 'Usuário Gestor',
    name: profile.name || profile.email,
    email: String(profile.email || '').trim().toLowerCase(),
    role_label: profile.role === 'admin' ? 'Administrador' : 'Gestor',
    recipient_group: 'manager',
    cell_filter: normalizeCells(profile),
    active: profile.active !== false,
  };
}

function fromLegacyRecipient(recipient) {
  return {
    ...recipient,
    id: `recipient:${recipient.id}`,
    profile_id: null,
    recipient_id: recipient.id,
    source: 'report_recipients',
    source_label: 'Legado IA',
    name: recipient.name || recipient.email,
    email: String(recipient.email || '').trim().toLowerCase(),
    role_label: recipient.role_label || 'Destinatário',
    recipient_group: recipient.recipient_group || 'manager',
    cell_filter: normalizeCells(recipient),
    active: recipient.active !== false,
  };
}

function fromDirectEmail(email, name = '') {
  const cleanEmail = String(email || '').trim().toLowerCase();
  return {
    id: null,
    profile_id: null,
    recipient_id: null,
    source: 'direct',
    source_label: 'E-mail direto',
    name: name || cleanEmail.split('@')[0],
    email: cleanEmail,
    role_label: 'Destinatário direto',
    recipient_group: 'other',
    active: true,
  };
}

function isCurrentUserRecipient(value) {
  return CURRENT_USER_RECIPIENTS.has(normalizeText(value));
}

function promptRequestsCurrentUser(prompt) {
  const normalized = normalizeText(prompt);
  return /\b(para\s+mim|para\s+meu\s+e-?\s?mail|meu\s+e-?\s?mail|remetente|solicitante|usuario\s+atual)\b/.test(normalized)
    || /\b(me\s+envie|envie-?\s?me|me\s+mande|mande-?\s?me)\b/.test(normalized);
}

function fromCurrentUser(user = {}) {
  if (!isValidEmail(user.email)) return null;
  const base = {
    id: ['admin', 'manager'].includes(user.role) && user.id ? `profile:${user.id}` : null,
    profile_id: ['admin', 'manager'].includes(user.role) ? user.id || null : null,
    recipient_id: null,
    source: ['admin', 'manager'].includes(user.role) ? 'profile' : 'direct',
    source_label: user.role === 'admin' ? 'Usuário Admin' : user.role === 'manager' ? 'Usuário Gestor' : 'Usuário atual',
    name: user.name || user.email,
    email: String(user.email).trim().toLowerCase(),
    role_label: user.role === 'admin' ? 'Administrador' : user.role === 'manager' ? 'Gestor' : 'Solicitante',
    recipient_group: ['admin', 'manager'].includes(user.role) ? 'manager' : 'other',
    cell_filter: normalizeCells(user),
    active: user.active !== false,
  };
  return base;
}

function dedupeRecipients(items = []) {
  const byEmail = new Map();
  items
    .filter((item) => item?.active !== false && isValidEmail(item?.email))
    .forEach((item) => {
      const email = item.email.toLowerCase();
      const current = byEmail.get(email);
      if (!current || item.source === 'profile') byEmail.set(email, item);
    });
  return [...byEmail.values()];
}

function pushUnique(target, item) {
  if (!item?.email) return;
  if (!target.some((current) => current.email?.toLowerCase() === item.email.toLowerCase())) {
    target.push(item);
  }
}

export async function findRecipientByEmail(email, _user) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(cleanEmail)) return null;

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id,name,email,role,cell,managed_cells,active')
    .ilike('email', cleanEmail)
    .eq('active', true)
    .in('role', ['admin', 'manager'])
    .limit(1);

  if (profilesError) throw new Error(`Não foi possível consultar Usuários/Gestores: ${profilesError.message}`);
  if (profiles?.length) return fromProfile(profiles[0]);

  const { data: recipients } = await supabase
    .from('report_recipients')
    .select('id,name,email,role_label,recipient_group,cell_filter,active')
    .ilike('email', cleanEmail)
    .eq('active', true)
    .limit(1);

  if (recipients?.length) return fromLegacyRecipient(recipients[0]);

  return null;
}

export async function ensureRecipientsForEmail(recipients = [], user) {
  const resolved = [];
  for (const rec of recipients) {
    const email = String(rec.email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) continue;

    const existing = await findRecipientByEmail(email, user);
    if (existing) {
      resolved.push(existing);
      continue;
    }
    resolved.push(fromDirectEmail(email, rec.name));
  }
  return resolved;
}

export async function findRecipientsByName(name, _user) {
  const cleanName = String(name || '').trim().replace(/[%_]/g, '');
  if (cleanName.length < 2) return [];

  const [profilesResult, recipientsResult, operatorsResult] = await Promise.all([
    supabase.from('profiles').select('id,name,email,role,cell,managed_cells,active').eq('active', true).in('role', ['admin', 'manager']).ilike('name', `%${cleanName}%`).limit(10),
    supabase.from('report_recipients').select('id,name,email,role_label,recipient_group,cell_filter,active').eq('active', true).ilike('name', `%${cleanName}%`).limit(10),
    supabase.from('operators').select('id,name,email,active').eq('active', true).ilike('name', `%${cleanName}%`).limit(10),
  ]);

  if (profilesResult.error) throw new Error(`Não foi possível consultar Usuários/Gestores: ${profilesResult.error.message}`);

  return dedupeRecipients([
    ...(profilesResult.data || []).map(fromProfile),
    ...(recipientsResult.data || []).map(fromLegacyRecipient),
    ...(operatorsResult.data || []).map((operator) => fromDirectEmail(operator.email, operator.name)),
  ]);
}

export async function findRecipientsByRole(role, _user) {
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
    .select('id,name,email,role,cell,managed_cells,active')
    .eq('active', true)
    .in('role', targetRoles);

  return (profiles || []).map(fromProfile);
}

export async function findRecipientsByCell(cellName, _user) {
  const cleanCell = String(cellName || '').trim().toLowerCase();
  
  // 1. Encontrar profiles cujas managed_cells contêm esta célula
  const { data: allProfiles } = await supabase
    .from('profiles')
    .select('id,name,email,role,cell,managed_cells,active')
    .eq('active', true)
    .in('role', ['admin', 'manager']);
  
  const matchedProfiles = (allProfiles || []).filter(p => {
    const cells = Array.isArray(p.managed_cells) ? p.managed_cells : [];
    return cells.some(c => String(c).trim().toLowerCase() === cleanCell);
  });

  // 2. Encontrar report_recipients que possuem filtro de célula para esta célula
  const { data: recs } = await supabase
    .from('report_recipients')
    .select('id,name,email,role_label,recipient_group,cell_filter,active')
    .eq('active', true);
  
  const matchedRecs = (recs || []).filter(r => {
    const cells = Array.isArray(r.cell_filter) ? r.cell_filter : [];
    return cells.some(c => String(c).trim().toLowerCase() === cleanCell);
  });

  return dedupeRecipients([
    ...matchedProfiles.map(fromProfile),
    ...matchedRecs.map(fromLegacyRecipient),
  ]);
}

export async function resolveRecipientsFromPrompt(prompt, user, options = {}) {
  const intent = parseIntent(prompt);
  const explicitRecipients = Array.isArray(options.explicitRecipients) ? options.explicitRecipients : [];
  const candidates = [...explicitRecipients, ...(intent.recipients || [])];
  if (!candidates.length && promptRequestsCurrentUser(prompt)) candidates.push('remetente');
  const resolved = [];
  const ambiguous = [];
  const notFound = [];

  for (const cand of candidates) {
    if (isCurrentUserRecipient(cand)) {
      const currentUser = fromCurrentUser(user);
      if (currentUser) pushUnique(resolved, currentUser);
      else notFound.push(cand);
      continue;
    }

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
        pushUnique(resolved, g);
      });
      continue;
    }

    // 3. Gestores por célula
    if (cand.toLowerCase().startsWith('gestores da ') || cand.toLowerCase().startsWith('gestores do ')) {
      const cell = cand.replace(/^(gestores da |gestores do )/i, '').trim();
      const cellRecs = await findRecipientsByCell(cell, user);
      cellRecs.forEach(r => pushUnique(resolved, r));
      continue;
    }

    // 4. Busca por nome
    const matches = await findRecipientsByName(cand, user);
    if (matches.length === 1) {
      pushUnique(resolved, matches[0]);
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
