import { useState, useEffect } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Bell, Save } from 'lucide-react';
import { toast } from 'sonner';

export default function NotificationSettings() {
  const queryClient = useQueryClient();
  const { data: configs = [] } = useQuery({
    queryKey: ['notificationConfig'],
    queryFn: () => base44.entities.NotificationConfig.list('-created_date', 1),
    initialData: [],
  });

  const current = configs[0] || null;
  const [form, setForm] = useState({ webhookUrl: '', webhookEnabled: false, emailEnabled: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (current) {
      setForm({
        webhookUrl: current.webhookUrl || '',
        webhookEnabled: current.webhookEnabled === true,
        emailEnabled: current.emailEnabled !== false,
      });
    }
  }, [current]);

  const save = async () => {
    setSaving(true);
    if (current) {
      await base44.entities.NotificationConfig.update(current.id, form);
    } else {
      await base44.entities.NotificationConfig.create(form);
    }
    queryClient.invalidateQueries({ queryKey: ['notificationConfig'] });
    setSaving(false);
    toast.success('Configuração de notificações salva');
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Card className="p-6 border-border/60 space-y-5">
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-semibold">Notificações de Eficiência Crítica</h3>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Os gestores são alertados automaticamente quando uma célula opera abaixo de 60% por 3+ horas consecutivas
        ou quando uma parada superior a 30 minutos é registrada.
      </p>

      <div className="flex items-center justify-between border border-border/60 rounded-xl px-4 py-3">
        <div>
          <p className="font-medium text-sm">Alertas por e-mail</p>
          <p className="text-xs text-muted-foreground">Envia e-mail aos gestores responsáveis pela célula.</p>
        </div>
        <Switch checked={form.emailEnabled} onCheckedChange={(v) => set('emailEnabled', v)} />
      </div>

      <div className="border border-border/60 rounded-xl px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">Alertas via Webhook / Slack</p>
            <p className="text-xs text-muted-foreground">Envia uma mensagem para um canal do Slack ou endpoint HTTP.</p>
          </div>
          <Switch checked={form.webhookEnabled} onCheckedChange={(v) => set('webhookEnabled', v)} />
        </div>
        {form.webhookEnabled && (
          <div className="space-y-1.5">
            <Label className="text-xs">URL do Webhook (Slack Incoming Webhook)</Label>
            <Input
              placeholder="https://hooks.slack.com/services/..."
              value={form.webhookUrl}
              onChange={(e) => set('webhookUrl', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Crie em api.slack.com/messaging/webhooks e cole a URL aqui.
            </p>
          </div>
        )}
      </div>

      <Button onClick={save} disabled={saving} className="gap-2">
        <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar configuração'}
      </Button>
    </Card>
  );
}