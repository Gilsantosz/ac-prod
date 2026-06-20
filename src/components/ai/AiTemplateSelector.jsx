import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const templates = [
  { value: 'manager-summary', label: 'Resumo para gestores' },
  { value: 'lot-status', label: 'Situação de lote' },
  { value: 'cell-performance', label: 'Desempenho da célula' },
  { value: 'critical-alert', label: 'Alerta operacional' },
];

export default function AiTemplateSelector({ value, onChange }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Selecione o modelo" /></SelectTrigger><SelectContent>{templates.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>;
}

