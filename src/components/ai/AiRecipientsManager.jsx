import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, Trash2, UserRoundCog, Info, ShieldCheck, ArrowRight, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { IndustrialEmptyState, IndustrialSectionCard } from '@/components/industrial';

export default function AiRecipientsManager({ items = [], warning = '', canManage, saving, onSave, onDelete }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', roleLabel: 'Contato', recipientGroup: 'other' });

  const submit = async (event) => {
    event.preventDefault();
    await onSave(form);
    setForm({ name: '', email: '', roleLabel: 'Contato', recipientGroup: 'other' });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,420px)_1fr] gap-6">
      {/* Painel Esquerdo: Controle Unificado */}
      <div className="space-y-6">
        <IndustrialSectionCard
          title="Gestão Centralizada"
          subtitle="Integração de Contas e Envios"
          icon={ShieldCheck}
        >
          <div className="space-y-4">
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-900/30 rounded-xl flex gap-3 text-sm text-emerald-800 dark:text-emerald-300">
              <Info className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">Cadastro Unificado de Gestores</p>
                <p className="text-xs text-emerald-700/90 dark:text-emerald-400/90 leading-relaxed">
                  Para evitar duplicidades e inconsistências, gestores com acesso ao sistema devem ser cadastrados na página de <strong>Usuários e Acessos</strong>. Eles são automaticamente sincronizados para receber relatórios.
                </p>
              </div>
            </div>

            <Button
              onClick={() => navigate('/usuarios?tab=managers')}
              className="w-full gap-2 bg-emerald-700 hover:bg-emerald-800 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700"
            >
              Ir para Controle de Acessos
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </IndustrialSectionCard>

        {canManage && (
          <IndustrialSectionCard
            title="Outros Destinatários"
            subtitle="Adicione contatos externos ou e-mails pontuais"
            icon={Plus}
          >
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome do Contato</Label>
                <Input
                  required
                  placeholder="Ex: Diretoria Externa"
                  value={form.name}
                  onChange={(event) => setForm((curr) => ({ ...curr, name: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input
                  type="email"
                  required
                  placeholder="diretoria@parceiro.com"
                  value={form.email}
                  onChange={(event) => setForm((curr) => ({ ...curr, email: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>Cargo / Rótulo</Label>
                <Input
                  placeholder="Ex: Auditor Externo"
                  value={form.roleLabel}
                  onChange={(event) => setForm((curr) => ({ ...curr, roleLabel: event.target.value }))}
                />
              </div>

              <Button type="submit" disabled={saving} className="w-full gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Cadastrar Contato
              </Button>
            </form>
          </IndustrialSectionCard>
        )}
      </div>

      {/* Painel Direito: Lista de Destinatários */}
      <IndustrialSectionCard
        title="Lista de Destinatários Cadastrados"
        subtitle="E-mails autorizados para recebimento de relatórios e alertas industriais."
        icon={UserRoundCog}
      >
        {warning && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-xl text-sm text-amber-800 dark:text-amber-400">
            {warning}
          </div>
        )}

        {!items.length ? (
          <IndustrialEmptyState
            title="Nenhum destinatário"
            description="Todos os gestores cadastrados no controle de acesso e contatos externos aparecerão aqui."
            icon={UserRoundCog}
          />
        ) : (
          <div className="divide-y divide-border/60">
            {items.map((item) => {
              const isSynced = item.recipient_group === 'manager';
              return (
                <div key={item.id} className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <strong className="text-sm font-semibold text-foreground truncate">
                        {item.name}
                      </strong>
                      {isSynced ? (
                        <Badge variant="outline" className="text-[10px] font-normal border-emerald-200 text-emerald-800 bg-emerald-50/50 dark:border-emerald-900/40 dark:text-emerald-400 dark:bg-emerald-950/20">
                          Sincronizado (Perfil)
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-normal border-muted text-muted-foreground bg-muted/20">
                          Contato Externo
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.email} &middot; {item.role_label || item.recipient_group}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {isSynced ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/5"
                        onClick={() => navigate('/usuarios?tab=managers')}
                        title="Ir para edição no controle de acessos"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    ) : (
                      canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          onClick={() => onDelete(item.id)}
                          title="Excluir destinatário"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </IndustrialSectionCard>
    </div>
  );
}
