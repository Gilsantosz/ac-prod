# Resultado do teste k6 local

Ensaio executado em 7 de setembro de 2026, de 01:45:36 a 01:46:36 UTC,
com k6 2.2.0, API Node.js real em HTTP e PostgreSQL descartável local.

| Verificação | Resultado |
| --- | --- |
| Novos apontamentos oferecidos | 40 por segundo durante 60 segundos |
| Novos apontamentos confirmados | 2.401 |
| Repetições idênticas confirmadas com HTTP 200 | 301 |
| Conflitos esperados com HTTP 409 | 301 |
| Requisições HTTP, incluindo a preparação | 3.024 |
| Falhas HTTP inesperadas | 0 |
| Iterações descartadas por falta de usuários virtuais | 0 |
| Tempo de resposta p95 dos novos apontamentos | 2,791 ms |
| Critérios automatizados aprovados | 5.709 verificações, nenhuma falha |
| Pico de conexões abertas pela API | 16 de 30 permitidas |
| Pico de conexões simultaneamente ocupadas | 12 |
| Limite global do papel PostgreSQL `mes_api` | 30 conexões |

O cenário usou até 120 usuários virtuais disponíveis. O agendamento de chegada
constante pode iniciar uma iteração na fronteira do intervalo, por isso os
totais superam em uma unidade os 2.400 novos eventos e as 300 repetições/conflitos
nominais. O teste exigiu pelo menos esses totais, sem descartar iterações.

A preparação enviou 20 requisições concorrentes com a mesma chave: houve uma
gravação e 19 respostas de repetição. Ao final, o banco continha exatamente
**2.402 eventos distintos**: os 2.401 apontamentos novos e esse único evento de
preparação. As quantidades armazenadas também foram conferidas. Nenhuma
repetição ou conflito duplicou ou alterou a produção registrada.

Foram aplicadas as migrações MES de tabelas, OEE, logins de serviço e aprendizado
de ciclo, incluindo os índices, permissões, políticas RLS e triggers reais.
As referências ao cadastro legado usaram tabelas vazias exclusivas desse banco.
O papel da API foi impedido de atualizar/apagar apontamentos e ler amostras.

O payload da carga não continha duração de operação. Após atualizar as views,
o estado permaneceu **Aprendendo**, com OEE/desempenho desconhecidos e nenhuma
amostra de ciclo inventada. O cron local foi substituído por uma função sem
agendamento. O banco temporário foi encerrado e removido ao terminar.

Este resultado valida o caminho local da API, sua gravação e idempotência, com
as estruturas novas do PostgreSQL. Não mede Render, Supavisor, cron em produção,
cálculos com ciclos medidos ou 1.000 computadores simultâneos. Nenhuma carga foi
enviada à produção e nenhum serviço pago de teste foi utilizado.

Os relatórios completos `k6-summary.json` e `verification.json` foram guardados
localmente em `.mes-runtime/k6-full`. O segundo registra os hashes das migrações
utilizadas. O cenário e seu runner estão em `services/mes-api/load-tests`.
