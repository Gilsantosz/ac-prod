import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Trophy } from 'lucide-react';
import { motion } from 'framer-motion';

export default function HighPerformerPanel({ performers }) {
  if (!performers.length) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="p-6 border-2 border-green-500/40 bg-green-500/5">
        <div className="flex items-center gap-2 mb-1">
          <Trophy className="w-5 h-5 text-green-600" />
          <h3 className="font-semibold">Desempenho acima da média</h3>
          <Badge className="bg-green-600 hover:bg-green-600 text-white ml-1">≥ 95% da meta</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Células que atingiram ou superaram 95% da meta diária.</p>

        <div className="space-y-4">
          {performers.map((p) => (
            <div key={p.key}>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="font-medium">{p.key}</span>
                <span className="tabular-nums text-green-700 font-semibold">
                  {p.efficiency}% · {p.produced}/{p.target}
                </span>
              </div>
              <Progress value={Math.min(p.efficiency, 100)} className="h-2 [&>div]:bg-green-600" />
            </div>
          ))}
        </div>
      </Card>
    </motion.div>
  );
}