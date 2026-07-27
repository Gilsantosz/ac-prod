import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default class CollectionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('CollectionErrorBoundary capturou um erro de renderização:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 space-y-4 my-4">
          <div className="flex items-center gap-3 font-bold text-lg">
            <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0" />
            <span>Ocorreu um erro ao carregar o painel da célula</span>
          </div>
          <p className="text-sm font-mono text-rose-200/80 bg-rose-950/40 p-3 rounded-xl border border-rose-500/20 overflow-x-auto">
            {this.state.error?.message || 'Erro inesperado de renderização.'}
          </p>
          <Button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              if (this.props.onReset) this.props.onReset();
            }}
            className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs gap-2 rounded-xl"
          >
            <RefreshCw className="w-4 h-4" />
            Tentar Novamente
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
