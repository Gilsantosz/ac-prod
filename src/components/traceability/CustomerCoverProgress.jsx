import { Layers, Package, ClipboardCheck, Truck } from 'lucide-react';

export default function CustomerCoverProgress({ covers = [] }) {
  const stats = {
    total: covers.length,
    packing: covers.filter(c => ['ready_to_pack', 'packing', 'in_production'].includes(c.status)).length,
    packed: covers.filter(c => c.status === 'packed').length,
    shipped: covers.filter(c => c.status === 'shipped').length,
  };

  const items = [
    { key: 'total', label: 'Total Capas', icon: Layers, color: 'text-sky-600 bg-sky-50 dark:bg-sky-950/20' },
    { key: 'packing', label: 'Em Embalagem', icon: Package, color: 'text-orange-600 bg-orange-50 dark:bg-orange-950/20' },
    { key: 'packed', label: 'Prontas (Embaladas)', icon: ClipboardCheck, color: 'text-green-600 bg-green-50 dark:bg-green-950/20' },
    { key: 'shipped', label: 'Expedidas', icon: Truck, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map(({ key, label, icon: Icon, color }) => (
        <div key={key} className="bg-card border border-border/40 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">{stats[key] || 0}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
