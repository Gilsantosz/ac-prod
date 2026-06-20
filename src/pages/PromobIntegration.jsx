import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/lib/localDb';
import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/ui/PageHeader';
import {
  Upload, Link2, RefreshCw, CheckCircle, XCircle, AlertTriangle,
  FileText, Eye, ChevronRight, Plug, Settings, Clock, Database,
} from 'lucide-react';

// ─── Sub-componentes ──────────────────────────────────────────
import XmlImportTab    from '@/components/promob/XmlImportTab';
import ApiConfigTab    from '@/components/promob/ApiConfigTab';

export default function PromobIntegration() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="Integração Promob"
        subtitle="Importe ordens de produção via XML manual ou configure a integração automática com a API Promob."
        icon={Plug}
      />

      <Tabs defaultValue="xml" className="space-y-6">
        <TabsList className="bg-card border border-border/60">
          <TabsTrigger value="xml" className="gap-2">
            <Upload className="w-4 h-4" /> Importar XML
          </TabsTrigger>
          <TabsTrigger value="api" className="gap-2">
            <Link2 className="w-4 h-4" /> API Promob
          </TabsTrigger>
        </TabsList>

        <TabsContent value="xml">
          <XmlImportTab />
        </TabsContent>

        <TabsContent value="api">
          <ApiConfigTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
