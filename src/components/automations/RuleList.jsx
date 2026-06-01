import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Trash2, Bell, FileWarning, Zap } from 'lucide-react';
import { describeRule, ACTION_LABELS } from '@/lib/automationRules';

export default function RuleList({ rules, onToggle, onDelete }) {
  if (!rules.length) {
    return (
      <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
        Nenhuma regra criada. Crie uma regra acima para automatizar alertas e ocorrências.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rules.map((rule) => (
        <Card key={rule.id} className="p-4 flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${rule.active ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground'}`}>
            {rule.action === 'alert' ? <Bell className="w-5 h-5" /> : <FileWarning className="w-5 h-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{rule.name}</p>
              <Badge variant="outline" className="gap-1"><Zap className="w-3 h-3" /> {ACTION_LABELS[rule.action]}</Badge>
              {rule.cell && <Badge variant="secondary">{rule.cell}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">Quando {describeRule(rule)}</p>
          </div>
          <Switch checked={rule.active} onCheckedChange={() => onToggle(rule)} />
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(rule.id)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </Card>
      ))}
    </div>
  );
}