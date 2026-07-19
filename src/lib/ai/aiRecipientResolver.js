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

function isCurrentUserRecipient(value) {
  return CURRENT_USER_RECIPIENTS.has(normalizeText(value));
}

function promptRequestsCurrentUser(prompt) {
  const normalized = normalizeText(prompt);
  return /\b(para\s+mim|para\s+meu\s+e-?\s?mail|meu\s+e-?\s?mail|remetente|solicitante|usuario\s+atual)\b/.test(normalized)
    || /\b(me\s+envie|envie-?\s?me|me\s+mande|mande-?\s?me)\b/.test(normalized);
}

function fromCurrentUser(user = {}) {
  const eligible = ['admin', 'manager', 'supervisor'].includes(user.role) || user.report_delivery_enabled === true;
  if (!eligible || !isValidEmail(user.email) || !user.id) return null;
  const base = {
    id: `profile:${user.id}`,
    profile_id: user.id,
    recipient_id: null,
    source: 'profile',
    source_label: user.role === 'admin' ? 'Usuário Admin' : 'Usuário Gestor',
    name: user.name || user.email,
    email: String(user.email).trim().toLowerCase(),
    role_label: user.role === 'admin' ? 'Administrador' : user.role === 'manager' ? 'Gestor' : 'Solicitante',
    recipient_group: 'manager',
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
    .select('id,name,email,role,cell,managed_cells,active,report_delivery_enabled')
    .ilike('email', cleanEmail)
    .eq('active', true);

  if (profilesError) throw new Error(`Não foi possível consultar Usuários/Gestores: ${profilesError.message}`);
  
  if (profiles?.length) {
    const p = profiles[0];
    if (['admin', 'manager', 'supervisor'].includes(p.role) || p.report_delivery_enabled) {
      return fromProfile(p);
    }
  }

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
  }
  return resolved;
}

export async function findRecipientsByName(name, _user) {
  const cleanName = String(name || '').trim().replace(/[%_]/g, '');
  if (cleanName.length < 2) return [];

  const profilesResult = await supabase
      .from('profiles')
      .select('id,name,email,role,cell,managed_cells,active,report_delivery_enabled')
      .eq('active', true)
      .or(`role.in.(admin,manager,supervisor),report_delivery_enabled.eq.true`)
      .ilike('name', `%${cleanName}%`)
      .limit(10);

  if (profilesResult.error) throw new Error(`Não foi possível consultar Usuários/Gestores: ${profilesResult.error.message}`);

  return dedupeRecipients((profilesResult.data || []).map(fromProfile));
}

export async function findRecipientsByRole(role, _user) {
  const cleanRole = String(role || '').trim().toLowerCase();
  const targetRoles = [];
  if (cleanRole === 'admin' || cleanRole === 'administrador' || cleanRole === 'administradores') {
    targetRoles.push('admin');
  } else if (cleanRole === 'manager' || cleanRole === 'gestor' || cleanRole === 'gestores' || cleanRole === 'gerente' || cleanRole === 'gerência') {
    targetRoles.push('manager', 'admin');
  } else if (cleanRole === 'supervisor' || cleanRole === 'lider' || cleanRole === 'líder' || cleanRole === 'supervisores') {
    targetRoles.push('supervisor');
  } else {
    targetRoles.push(cleanRole);
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id,name,email,role,cell,managed_cells,active,report_delivery_enabled')
    .eq('active', true)
    .in('role', targetRoles);

  return (profiles || []).map(fromProfile);
}

export async function findRecipientsByCell(cellName, _user) {
  const cleanCell = String(cellName || '').trim().toLowerCase();
  
  // 1. Encontrar profiles cujas managed_cells contêm esta célula
  const { data: allProfiles } = await supabase
    .from('profiles')
    .select('id,name,email,role,cell,managed_cells,active,report_delivery_enabled')
    .eq('active', true)
    .or(`role.in.(admin,manager,supervisor),report_delivery_enabled.eq.true`);
  
  const matchedProfiles = (allProfiles || []).filter(p => {
    const cells = Array.isArray(p.managed_cells) ? p.managed_cells : [];
    return cells.some(c => String(c).trim().toLowerCase() === cleanCell);
  });

  return dedupeRecipients(matchedProfiles.map(fromProfile));
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
      else notFound.push(cand);
      continue;
    }

    // 2. Todos os gestores
    if (cand.toLowerCase() === 'todos os gestores' || cand.toLowerCase() === 'gerencia' || cand.toLowerCase() === 'diretoria' || cand.toLowerCase() === 'gestores') {
      const gestores = await findRecipientsByRole('manager', user);
      gestores.forEach(g => {
        pushUnique(resolved, g);
      });
      continue;
    }

    // 3. Gestores por célula
    if (cand.toLowerCase().startsWith('gestores da ') || cand.toLowerCase().startsWith('gestores do ')) {
      const cell = cand.replace(/^(gestores da |gestores do |gestor da |gestor do )/i, '').trim();
      const cellRecs = await findRecipientsByCell(cell, user);
      cellRecs.forEach(r => pushUnique(resolved, r));
      continue;
    }

    // 4. Busca por grupo de e-mail no banco
    const { data: matchedGroups } = await supabase
      .from('email_recipient_groups')
      .select('id, name')
      .ilike('name', cand)
      .eq('active', true)
      .limit(1);

    if (matchedGroups && matchedGroups.length > 0) {
      const groupId = matchedGroups[0].id;
      const { data: members } = await supabase
        .from('email_recipient_group_members')
        .select('profile_id')
        .eq('group_id', groupId);

      if (members) {
        for (const m of members) {
          if (m.profile_id) {
            const { data: prof } = await supabase
              .from('profiles')
              .select('id,name,email,role,cell,managed_cells,active,report_delivery_enabled')
              .eq('id', m.profile_id)
              .single();
            if (prof) pushUnique(resolved, fromProfile(prof));
          }
        }
      }
      continue;
    }

    // 5. Busca por nome
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
