import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Copy, Check, FolderOpen, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import leoLogoUrl from '@/assets/leo-madeiras-logo.jpg';

export default function AboutModal({ open = false, onOpenChange = null }) {
  const [info, setInfo] = useState({
    name: 'Leo Flow — Controle de Produção',
    version: '1.3.2',
    platform: 'Navegador Web / PWA',
    arch: 'x64',
    author: 'Gil Santos',
    electronVersion: 'N/A',
    chromeVersion: 'N/A',
    nodeVersion: 'N/A'
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && typeof window !== 'undefined' && window.leoFlow?.app?.getVersion) {
      window.leoFlow.app.getVersion()
        .then((data) => {
          if (data) setInfo((prev) => ({ ...prev, ...data }));
        })
        .catch((err) => console.warn('Erro ao obter versão do app:', err));
    }
  }, [open]);

  const handleCopyTechInfo = () => {
    const text = `
=== LEO FLOW — INFORMAÇÕES TÉCNICAS ===
Sistema: ${info.name}
Versão: ${info.version}
Autor: ${info.author}
Plataforma: ${info.platform} (${info.arch})
Electron: ${info.electronVersion}
Chrome: ${info.chromeVersion}
Node.js: ${info.nodeVersion}
Data: ${new Date().toLocaleString('pt-BR')}
=======================================
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Informações técnicas copiadas para a área de transferência!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenLogs = async () => {
    if (window.leoFlow?.system?.openLogs) {
      try {
        const path = await window.leoFlow.system.openLogs();
        toast.info(`Pasta de logs aberta: ${path}`);
      } catch (err) {
        toast.error('Não foi possível abrir a pasta de logs.');
      }
    } else {
      toast.info('Logs do sistema estão disponíveis nas ferramentas de desenvolvedor do navegador.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] rounded-2xl p-6 bg-card border border-border/80 shadow-2xl">
        <DialogHeader className="text-center sm:text-left">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-xl bg-[#043820] p-0.5 border border-amber-400/40 shadow-md flex items-center justify-center shrink-0 overflow-hidden">
              <img
                src={leoLogoUrl}
                alt="Leo Flow Logo"
                className="w-full h-full object-cover rounded-lg"
              />
            </div>
            <div>
              <DialogTitle className="text-base font-extrabold text-foreground">
                Leo Flow
              </DialogTitle>
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                Controle de Produção & Rastreabilidade MES
              </p>
            </div>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Sistema integrado para gestão de ordens de produção, rastreamento de peças, indicadores de OEE e coletores de chão de fábrica.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-3 border-y border-border/40 text-xs">
          <div className="grid grid-cols-2 gap-2 bg-secondary/30 rounded-xl p-3 border border-border/30">
            <div>
              <span className="text-[10px] uppercase font-bold text-muted-foreground block">Versão do Sistema</span>
              <span className="font-extrabold text-foreground text-sm">{info.version}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-muted-foreground block">Desenvolvido por</span>
              <span className="font-bold text-foreground">{info.author}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-muted-foreground block">Plataforma</span>
              <span className="font-medium text-foreground">{info.platform} ({info.arch})</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-muted-foreground block">Status do Banco</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> Supabase Realtime
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-0 pt-1">
          {window.leoFlow && (
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenLogs}
              className="text-xs font-semibold rounded-xl flex items-center gap-1.5 text-muted-foreground"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Abrir Logs
            </Button>
          )}

          <Button
            type="button"
            onClick={handleCopyTechInfo}
            className="text-xs font-bold bg-[#043820] hover:bg-[#064e2c] text-white rounded-xl flex items-center gap-1.5 shadow"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copiado!' : 'Copiar Info Técnica'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
