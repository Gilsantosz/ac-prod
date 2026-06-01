import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export default function KpiCard({ title, value, unit, icon: Icon, accent = 'accent', sub, index = 0 }) {
  const accentMap = {
    accent: 'bg-accent/15 text-accent',
    primary: 'bg-primary/10 text-primary',
    warning: 'bg-chart-3/15 text-chart-3',
    danger: 'bg-destructive/15 text-destructive',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className="h-full"
    >
      <Card className="p-5 border-border/60 hover:shadow-md transition-shadow h-full">
        <div className="flex items-start justify-between h-full">
          <div className="flex flex-col h-full">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold mt-2 tabular-nums">
              {value}
              {unit && <span className="text-base font-medium text-muted-foreground ml-1">{unit}</span>}
            </p>
            <p className="text-xs text-muted-foreground mt-1 min-h-[1rem]">{sub || '\u00A0'}</p>
          </div>
          {Icon && (
            <div className={cn('p-2.5 rounded-xl', accentMap[accent])}>
              <Icon className="w-5 h-5" />
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}