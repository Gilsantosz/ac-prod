# Guards fail-closed e recuperação de parsers privados

Aplicado exclusivamente ao staging em 05/09/2026 01:36:26 UTC, a partir do
commit 2ccc6f7d3958b67123075dcbb76845b6b6bdd801.
Esta etapa não conclui a Fase 1 nem autoriza replay/homologação.

Versão efetiva: `20260905013626_collection_private_parsers_staging_v1`.
O serviço atribuiu o timestamp efetivo; o arquivo planejado abaixo permanece
imutável. O SHA-256 do ledger é idêntico ao arquivo testado.
O staging passou a sete migrations. Conversões e hashes das três funções
conferem com a origem; todas são SECURITY INVOKER sem execução para papéis API.
Flags false, recibos/outbox zero e nenhum lock aguardando/idle in transaction.
Produção permanece com 154 migrations, última 20260903165317, flags false e
sem journal de recuperação.

O novo probe contabiliza 112 rotinas ausentes e 58 divergentes (170 diferenças).
O estado da Fase 1 permanece HOLD. Evidências completas:
[aplicação e comparação antes/depois](staging-private-parsers-application.json).

## Proteções implementadas

O reprodutor da foundation verifica SHA-256 integral dos dois bundles revisados
e do SQL já aplicado. Modificação de identidade, default, corpo, hash declarado,
ref ou indicador de atomicidade é rejeitada antes da interpolação.
As 167 migrations históricas permanecem intocadas.

assess-staging-recovery.mjs exige evidências explícitas e rejeita valores
ausentes, null, strings numéricas, negativos e fracionários. Ref produtivo,
flags ativas, drift, status de migration não reconhecido, restore ausente,
privilégios inesperados e proveniência de turno não validada produzem
HOLD_PHASE1. Seu único resultado positivo é READY_FOR_PHASE2_ONLY,
nunca GO produtivo. O input é evidência de auditoria, não atestado assinado.

```sh
npm run test:mes:guards
node scripts/mes/assess-staging-recovery.mjs docs/audits/2026-09-04-mes-vnext/staging-phase1-gate-input.json
```

O segundo comando retorna exit 2 no estado atual — comportamento esperado de
parada, não teste a “corrigir” relaxando a condição.

## Migration nova de parsers

Arquivo: supabase/recovery/staging/20260905013000_collection_private_parsers.sql.
SHA-256: `9eb0a5ce09b572a3b8b09c55e328b36f4d27a4f3c843eb9d95c8ea880a1e8eb1`.

Somente três funções privadas SECURITY INVOKER, literalmente capturadas de
pg_get_functiondef, são recuperadas:

- private.try_collection_uuid_v3(text);
- private.try_collection_bigint_v3(text);
- private.try_collection_timestamptz_v3(text).

Não há acesso a tabelas produtivas, fila, rede, KPI, Broadcast ou Auth dentro
desses corpos. Grants de execução são revogados de PUBLIC e dos quatro papéis
da API na mesma transação. O guard exige journal correto, as quatro flags false
e ausência das três assinaturas antes de criar qualquer função.

Nenhum classificador de retry ou cálculo de backoff foi copiado. Tampouco
foram restaurados wakeup/lease/worker v3, rotinas de turno, login, archive,
delete/reset ou wrappers públicos. O parser de data v3 preserva a semântica
existente, inclusive interpretação dependente de timezone quando o input não
explicita offset; não será tomado como contrato de validação estrita da v4.

## Teste real local

```sh
node scripts/mes/test-recovery-parsers.mjs /absolute/postgresql17/bin
```

Quinze passos PostgreSQL 17.11 passaram: fixture mínimo; alvo incorreto;
rejeição 55000; ausência de DDL parcial; alvo corrigido; flag ligada;
rejeição 55000; ausência de DDL parcial; flags false; falha injetada P0001;
rollback integral; aplicação; validação de conversões/privilégios;
reaplicação rejeitada 55000; reconferência.

O primeiro initdb foi bloqueado pelo sandbox antes de iniciar o servidor. O
artefato local foi preservado; o ensaio aprovado foi executado com permissão
para o processo local, sem TCP e sem credenciais remotas, e encerrou o cluster.
Não representa teste do Supabase Auth, UI, produção ou capacidade.

## Rollback e aplicação

Aplicar somente com project_id explícito de staging, revalidando parent,
non-default, journal, hash do arquivo e ausência de executores ativos.
Falha antes do commit reverte DDL e journal. Resposta incerta exige consulta
ao ledger/journal antes de retry. Após commit, preservar funções sem grants e
flags false; qualquer correção será nova migration. Nenhum DROP/replay de
fatos/limpeza de evidências integra esta etapa.
