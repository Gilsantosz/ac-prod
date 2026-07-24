import { Eye, Pencil, ShieldCheck } from 'lucide-react';
import { pageAccessCatalog, routeGroups, getDefaultPermissions } from '@/config/appRoutes';
import { cn } from '@/lib/utils';

const checked = (permissions, role, page, mode) => {
  const permission = mode === 'view' ? page.viewPermission : page.editPermission;
  if (!permission) return false;
  if (role === 'admin') return true;
  if (permissions?.[permission] !== undefined) return permissions[permission] === true;

  const fallback = mode === 'view'
    ? (page.legacyViewPermission || page.editPermission)
    : null;
  if (fallback && permissions?.[fallback] !== undefined) return permissions[fallback] === true;

  const defaults = getDefaultPermissions(role);
  if (defaults[permission] !== undefined) return defaults[permission] === true;
  return fallback ? defaults[fallback] === true : false;
};

export function normalizePagePermissions(permissions, role) {
  const normalized = { ...getDefaultPermissions(role), ...(permissions || {}) };
  pageAccessCatalog.forEach((page) => {
    normalized[page.viewPermission] = checked(normalized, role, page, 'view');
    if (page.editPermission) {
      normalized[page.editPermission] = checked(normalized, role, page, 'edit');
      if (normalized[page.editPermission]) normalized[page.viewPermission] = true;
    }
  });
  return normalized;
}

export default function PageAccessMatrix({ role, permissions, onChange, disabled = false }) {
  const normalized = normalizePagePermissions(permissions, role);

  const setMode = (page, mode, value) => {
    if (disabled) return;
    const next = { ...normalized };
    if (mode === 'view') {
      next[page.viewPermission] = value;
      if (!value && page.editPermission) next[page.editPermission] = false;
    } else if (page.editPermission) {
      next[page.editPermission] = value;
      if (value) next[page.viewPermission] = true;
    }
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold text-foreground">Acesso por página e ação</p>
          <p className="text-xs text-muted-foreground">
            “Visualizar” libera a página em modo de consulta. “Editar” libera cadastros, alterações e ações operacionais.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60">
        <div className="grid grid-cols-[minmax(0,1fr)_88px_88px] bg-muted/40 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <span>Página</span>
          <span className="text-center">Visualizar</span>
          <span className="text-center">Editar</span>
        </div>
        {Object.keys(routeGroups).map((groupKey) => {
          const pages = pageAccessCatalog.filter((page) => page.group === groupKey);
          if (!pages.length) return null;
          return (
            <div key={groupKey}>
              <div className="border-y border-border/50 bg-muted/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {routeGroups[groupKey]}
              </div>
              {pages.map((page) => {
                const Icon = page.icon;
                const canView = checked(normalized, role, page, 'view');
                const canEdit = checked(normalized, role, page, 'edit');
                return (
                  <div
                    key={page.path}
                    className="grid grid-cols-[minmax(0,1fr)_88px_88px] items-center border-b border-border/40 px-3 py-2.5 last:border-b-0"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{page.label}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{page.description}</p>
                      </div>
                    </div>
                    <AccessToggle
                      label={`Visualizar ${page.label}`}
                      active={canView}
                      disabled={disabled || (page.adminOnly && role !== 'admin')}
                      icon={Eye}
                      onClick={() => setMode(page, 'view', !canView)}
                    />
                    {page.editPermission ? (
                      <AccessToggle
                        label={`Editar ${page.label}`}
                        active={canEdit}
                        disabled={disabled || (page.adminOnly && role !== 'admin')}
                        icon={Pencil}
                        onClick={() => setMode(page, 'edit', !canEdit)}
                      />
                    ) : (
                      <span className="text-center text-xs text-muted-foreground/60">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccessToggle({ label, active, disabled, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'mx-auto flex h-8 w-12 items-center justify-center rounded-lg border transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-muted',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
