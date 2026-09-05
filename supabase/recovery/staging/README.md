# Recuperação aditiva do staging

Alvo exclusivo: `capacity-test`, ref `smnsihksrhzbkhcbdjfu`, branch ID
`cf279f17-5cdd-4ec5-b0e4-467f87215ed9`. Esta pasta não pertence à cadeia de
deploy de produção. Aplique cada arquivo explicitamente, após conferir o alvo.

Estado: foundation já aplicada como `20260905005442` /
`collection_schema_foundation_staging_v1`, sem alteração dos bytes do arquivo.
Consulte [evidência e correspondência de versões](../../../docs/audits/2026-09-04-mes-vnext/14-staging-foundation-applied.md).
Não reaplicar o artefato usando seu prefixo local planejado.

`20260905003000_collection_schema_foundation.sql` materializa 23 tabelas
ausentes, 39 colunas, 125 constraints e três índices únicos a partir das
definições qualificadas capturadas do catálogo. Cria também um journal de
recuperação. Índices não únicos aguardam análise de planos. O contrato
incompatível de `capacity_test_runs` e diferenças nos campos existentes ficam
fora desta etapa.

Todas as tabelas novas possuem RLS e acesso revogado para os papéis da API.
As quatro flags v3 são inseridas como `false`. A lease v3 é somente uma estrutura
histórica recuperada: nenhum executor, trigger, cron, segredo ou RPC é instalado
ou ativado por esta migration. O pool v4 ainda deverá substituí-la.

## Pré-condições e execução

1. Conferir branch ID/ref, backup e catálogo prévio; registrar commit e SHA-256.
2. Exigir zero executor de capacidade ativo, zero lock aguardando e zero
   `idle in transaction`.
3. Registrar contagens e hashes de identidade das tabelas existentes.
4. Executar `npm run test:mes:guards` e os ensaios abaixo.
5. Aplicar por `apply_migration` com **project_id explícito do staging**, em uma
   única transação. Não usar `--linked` nem aplicar esta pasta em produção.
6. Confirmar o journal, ledger da migration, RLS, privilégios, flags desligadas
   e preservação das contagens/hashes anteriores.

Em resposta incerta, consultar o ledger e `private.mes_recovery_journal` antes
de qualquer retry. O guard rejeita reaplicação com `55000`. Ausência do recibo e
presença de `capacity_test_runs.synthetic_prefix` são verificadas antes do DDL;
o projeto produtivo existente não passa esse preflight.

## Ensaios locais reproduzíveis

```sh
node scripts/mes/prove-historical-replay-blockers.mjs /absolute/postgresql17/bin
node scripts/mes/test-recovery-foundation.mjs /absolute/postgresql17/bin
node scripts/mes/test-recovery-parsers.mjs /absolute/postgresql17/bin
```

O primeiro reproduz `42601` nas funções históricas incompletas sem editar seus
arquivos. O segundo cria duas instâncias locais, injeta uma falha no final da
migration, comprova rollback total do DDL, aplica a migration, verifica RLS e
flags, rejeita reaplicação e confirma preservação de um registro sintético.
Cada instância usa socket Unix privado, não escuta TCP, ignora variáveis de
conexão herdadas e é encerrada ao fim. Artefatos e diretórios são preservados.

O fixture reproduz formatos de tabela/coluna/PK, com uma âncora Auth sintética.
Não representa teste dos serviços Supabase, políticas, regras de produção ou
capacidade. `REPLAY_PASS_ONLY` não é GO de rollout.

## Rollback

Falha antes do commit reverte a transação inteira, conforme ensaiado. Depois do
commit, manter as estruturas e flags desligadas e corrigir por migration nova.
Não excluir tabelas nem fatos para desfazer esta etapa. O journal e as evidências
devem permanecer disponíveis. Nenhuma aplicação produtiva depende das
estruturas criadas por esta recuperação.

O estado global permanece **NO-GO** até recuperar rotinas, políticas, extensões,
lineage completa e health, classificar os dados históricos e homologar v4.
