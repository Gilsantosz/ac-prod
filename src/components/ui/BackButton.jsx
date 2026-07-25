import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function BackButton({ className, label = 'Voltar', fallbackPath = '/' }) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack = () => {
    if (window.history.length > 1 && location.pathname !== fallbackPath) {
      navigate(-1);
    } else {
      navigate(fallbackPath);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleBack}
      className={cn(
        'h-9 px-3.5 gap-2 text-xs font-bold border-border/80 bg-card hover:bg-secondary active:scale-95 transition-all shadow-sm rounded-xl group text-foreground',
        className
      )}
      title="Voltar para a página anterior"
    >
      <ArrowLeft className="w-4 h-4 text-primary group-hover:-translate-x-1 transition-transform" />
      <span>{label}</span>
    </Button>
  );
}
