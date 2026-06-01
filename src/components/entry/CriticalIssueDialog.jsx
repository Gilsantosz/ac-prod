import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Loader2, ExternalLink } from 'lucide-react';
import { useState } from 'react';

export default function CriticalIssueDialog({ open, onOpenChange, entry, onCreateIssue }) {
  const [owner, setOwner] = useState(localStorage.getItem('gh_owner') || '');
  const [repo, setRepo] = useState(localStorage.getItem('gh_repo') || '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleCreate = async () => {
    setLoading(true);
    setResult(null);
    localStorage.setItem('gh_owner', owner);
    localStorage.setItem('gh_repo', repo);
    const res = await onCreateIssue({ owner, repo, entry });
    setResult(res);
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" /> Falha crítica detectada
          </DialogTitle>
        </DialogHeader>

        {entry && (
          <div className="bg-secondary rounded-xl p-4 text-sm space-y-1">
            <p><strong>{entry.cell}</strong> · {entry.shift} · {entry.hour}</p>
            <p className="text-muted-foreground">
              Produzido {entry.produced} de meta {entry.target || '—'} · Parada {entry.downtime || 0}min
            </p>
          </div>
        )}

        <p className="text-sm text-muted-foreground">Criar uma issue no GitHub para acompanhar esta falha:</p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Owner / Org</Label>
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="minha-empresa" />
          </div>
          <div className="space-y-2">
            <Label>Repositório</Label>
            <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="producao" />
          </div>
        </div>

        {result?.issue_url && (
          <a href={result.issue_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-accent hover:underline">
            <ExternalLink className="w-4 h-4" /> Issue #{result.number} criada
          </a>
        )}
        {result?.error && <p className="text-sm text-destructive">{result.error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Ignorar</Button>
          <Button onClick={handleCreate} disabled={loading || !owner || !repo} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
            Criar issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}