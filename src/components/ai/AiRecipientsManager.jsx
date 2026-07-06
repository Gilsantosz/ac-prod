import { Badge } from '@/components/ui/badge';
import { IndustrialEmptyState, IndustrialSectionCard } from '@/components/industrial';
import { Building2, ShieldCheck, UserRoundCog } from 'lucide-react';

function cellsLabel(item) {
  if (!item.cell_filter?.length) return 'Todas as células';
  return item.cell_filter.join(', ');
}

export default function AiRecipientsManager({ items = [], warning = '' }) {
  const profileCount = items.filter((item) => item.source === 'profile').length;
  const legacyCount = items.filter((item) => item.source !== 'profile').length;

  return (
    <div className="space-y-5">
      <IndustrialSectionCard
        title="Fonte oficial de destinatários"
        subtitle="A IA agora consulta diretamente a aba Usuários/Gestores. Não é mais necessário cadastrar o mesmo e-mail dentro da página de IA."
        icon={ShieldCheck}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-border/70 p-3">
            <p className="text-muted-foreground text-xs">Gestores/Admins oficiais</p>
            <strong className="text-2xl text-foreground">{profileCount}</strong>
          </div>
          <div className="rounded-lg border border-border/70 p-3">
            <p className="text-muted-foreground text-xs">Cadastros legados IA</p>
            <strong className="text-2xl text-foreground">{legacyCount}</strong>
          </div>
          <div className="rounded-lg border border-border/70 p-3">
            <p className="text-muted-foreground text-xs">Regra ativa</p>
            <strong className="text-sm text-emerald-700 dark:text-emerald-400">Sem duplicidade</strong>
          </div>
        </div>
        {warning && <p className="mt-4 text-sm text-amber-700 dark:text-amber-400">{warning}</p>}
        <p className="mt-4 text-xs text-muted-foreground">
          Para incluir, alterar ou desativar um destinatário, use <strong>Usuários → Gestores</strong>. A IA usa nome, e-mail, perfil e células monitoradas desse cadastro.
        </p>
      </IndustrialSectionCard>

      <IndustrialSectionCard title="Gestores disponíveis para a IA" subtitle="Destinatários resolvidos automaticamente pelo motor IA." icon={UserRoundCog}>
        {!items.length ? (
          <IndustrialEmptyState title="Nenhum gestor ativo encontrado" description="Cadastre pelo menos um usuário com perfil Gestor ou Administrador na aba Usuários/Gestores." icon={UserRoundCog} />
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <div key={item.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <strong className="block text-sm truncate">{item.name}</strong>
                    <Badge variant={item.source === 'profile' ? 'default' : 'secondary'} className="text-[10px]">
                      {item.source_label || item.role_label || 'Destinatário'}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted-foreground truncate">{item.email}</span>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <Building2 className="w-3.5 h-3.5" /> {cellsLabel(item)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </IndustrialSectionCard>
    </div>
  );
}
