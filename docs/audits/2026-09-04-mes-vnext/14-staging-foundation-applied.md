# Recuperação aditiva aplicada — NO-GO permanece

Aplicação: 2026-09-05 00:54:42 UTC (04/09, 21:54:42 em São Paulo).
Commit de origem: `cdd6ab3e9771fe2b339eea66d1cf90b095f33ec5`.
Alvo: staging persistente `capacity-test / smnsihksrhzbkhcbdjfu`, não default.

## Resultado verificado

A migration nova recuperou 23 tabelas ausentes, 39 colunas, 125 constraints
e três índices únicos, usando definições literais do catálogo qualificado.
Criou também um journal de recuperação. Os 103 conjuntos preexistentes mantêm
contagem e hash ordenado das chaves primárias: 246.167 registros, zero
divergências. Esse teste verifica identidade e contagem, não conteúdo completo
de cada linha. Nenhum dado produtivo foi copiado.

As 24 tabelas criadas estão presentes, com RLS, sem grants de tabela para
PUBLIC, anon, authenticated ou service_role e sem triggers de aplicação.
As definições das 39 novas colunas e 125 constraints foram comparadas campo a
campo com o catálogo de origem: 164 objetos conferidos, zero diferenças.
As quatro flags v3 permanecem false; não há recibos, tentativas nem outbox nas
estruturas recuperadas. Não foram instalados workers, rotinas, cron, políticas,
wakeups HTTP ou flags v4.

O ledger do staging passou de cinco para seis migrations. O parent produtivo
continua com 154, última `20260903165317`, quatro flags v3 false e sem o journal
de recuperação. Não houve reset, restore, rebase, deploy de Edge Function,
carga ou DDL produtivo.

## Identidade da migration

| Campo | Valor |
|---|---|
| Arquivo revisado | `supabase/recovery/staging/20260905003000_collection_schema_foundation.sql` |
| Nome aplicado | `collection_schema_foundation_staging_v1` |
| Versão atribuída pelo serviço | `20260905005442` |
| SHA-256 do arquivo e statements aplicados | `cedc858cb918a5b300bfbece3f7a15dafaa8b69f3a30154fee18375bf0f543a0` |
| SHA-256 da seleção do catálogo | `d740353826e364449dd765cf9d4589ca0c98623d0f453c13717d60281fee5ecc` |

O prefixo local é a identificação planejada do artefato; o serviço atribuiu a
versão efetiva acima. Essa correspondência explícita é obrigatória para
reconciliação de lineage. Não renomear nem reaplicar o arquivo para “alinhar”
timestamps, e não alterar seus bytes após aplicação.

## Ensaios e limites

- Dois clusters PostgreSQL 17.11 locais: aplicação, falha injetada, rollback
  transacional integral e rejeição de reaplicação (`55000`) aprovados.
- Reprodução real dos erros históricos em 033 e 036: SQLSTATE `42601`.
- Guards Node: 6/6; regressão Vitest: 104 arquivos, 463 testes aprovados.
- Pós-aplicação: zero lock aguardando e zero sessão idle in transaction.

Uma consulta inicial de hash de linha completa excedeu seu limite de tempo e
foi substituída por sete consultas menores de contagem/chave primária. Isso é
evidência de auditoria, não ensaio de capacidade, e não autoriza declarar
`statement_timeouts_delta=0` para homologação.

## Bloqueios remanescentes da Fase 1

O status da branch continua **MIGRATIONS_FAILED**, com preview database
`ACTIVE_HEALTHY`. Não há alegação de migration pipeline verde nem de catálogo
integralmente reproduzível.

A comparação de overloads por tipos de argumentos, sem confundir renomeação de
parâmetros com nova assinatura, encontrou 115 rotinas ausentes, 58 com definição
diferente e 14 exclusivas de staging. Seus hashes e dependências estão no
inventário anexo. Dependências dentro de corpos PL/pgSQL literais não são
integralmente rastreadas pelo catálogo: precisam de revisão e teste de execução,
conforme a [documentação do PostgreSQL 17](https://www.postgresql.org/docs/17/ddl-depend.html).

Permanecem contratos de colunas divergentes (inclusive capacity_test_runs),
rotinas, grants/policies, views, índices não únicos, PGMQ, pg_cron, jobs,
lineage de cold replay e ensaio de restore físico.

Advisor após aplicação: 119 avisos de segurança e 390 de performance.
Incluem 13 rotinas SECURITY DEFINER executáveis por anon e 78 por authenticated,
uma view SECURITY DEFINER, seis grupos de índice duplicado e Auth com orçamento
absoluto. As contagens não representam vulnerabilidades distintas nem delta
isolado da migration. RLS sem policy nas novas tabelas é bloqueio intencional
até concluir os contratos de acesso, não motivo para remover RLS.
Referências: [RLS sem policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
e [Advisors](https://supabase.com/docs/guides/database/database-advisors).

## Próximo gate

### Lacuna de defaults identificada na revisão independente

A preservação de chaves não prova neutralidade semântica dos novos defaults.
Os 83 operadores existentes agora têm horário padrão 06:00–14:00 e timezone
America/Sao_Paulo em colunas novas. Isso **não comprova seus turnos reais**.
Nenhuma sessão existia e nenhuma rotina nova de login/turno foi habilitada.
O próximo gate deve exigir proveniência/validação dos horários antes de usar
esses operadores em teste produtivo; não se inferirá turno a partir do default.

A coluna occurred_at não reescreveu timestamps históricos de eventos nesta
aplicação porque production_collection_events tinha e continua tendo zero
registros. Os novos campos state_version=0 e legal_hold=false dos 40 lotes
também são defaults de schema, não autorização para retenção/arquivamento.
Nenhuma rotina de archive foi instalada ou executada.

Verificamos privilégios efetivos (incluindo herança) dos quatro papéis anon,
authenticated, service_role e authenticator: sem privilégio de tabela nas
24 tabelas, sem USAGE/CREATE em private e sem acesso à sequência de attempts.
Isso complementa a primeira verificação de ACL direta.

O guard SQL da migration detecta a lineage esperada, mas não constitui atestado
criptográfico do projeto. A identidade operacional foi conferida pela API
usando project_id explícito; o journal mantém a associação da recuperação.
Um clone pode carregar o mesmo journal: a ferramenta de deploy deve validar
também parent/ref/default antes de qualquer execução.

Os snapshots são multipágina, não atômicos. Por isso o gerador passa a ser
somente reprodutor dos bundles imutáveis revisados, com hash integral fixado,
e não conversor genérico de catálogos. O pin detecta adulteração; não transforma
uma captura multipágina em snapshot transacional. Novas migrations exigem
revalidação do runtime e revisão própria.

Recuperar dependências restantes em migrations específicas e testadas, sem
substituir cegamente as 58 rotinas divergentes ou expor implementações
privilegiadas. Depois: health estrutural, reconciliação histórica e hardening.
Nenhum replay histórico, v4 produtivo, canário ou merge está autorizado pelo
resultado desta etapa. Rollback pós-commit conserva estruturas/evidências e
flags false; correções somente forward-only.
