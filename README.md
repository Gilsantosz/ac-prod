# Leo Flow MES

Sistema de produção com coleta/bipagem, rastreabilidade por peça, importação PCP, KPIs e gráficos em tempo real.

## Início rápido

```bash
npm install
npm run dev
```

Crie `.env.local` a partir de `.env.example` e informe as credenciais públicas do Supabase.

## Verificações

```bash
npm run typecheck
npm test -- --run
npm run build
```

## Implantação da versão de coleta multioperador

Antes de publicar esta versão, aplique `supabase/migrations/032_collection_realtime_multi_operator.sql` no Supabase.

Leia [GUIA_IMPLANTACAO_COLETA_PCP.md](./GUIA_IMPLANTACAO_COLETA_PCP.md) para o mapeamento do arquivo PCP, fluxo das peças especiais de Marcenaria e checklist de homologação.
