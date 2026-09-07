# Estado da implantação das camadas MES

Verificado em 7 de setembro de 2026, projeto Supabase `ac-prod` (`uozuzdfvnufsjsonswag`).

| Componente | Estado comprovado |
| --- | --- |
| Aplicativo React existente | Publicado no GitHub Pages; coleta existente preservada |
| Camada 1 | Sete tabelas criadas no Supabase, com restrições, índices e acesso restrito |
| Equipamentos | Cinco máquinas ativas copiadas do cadastro existente, preservando seus IDs |
| Cadastros associados | 2.155 produtos e 2.157 peças copiados com as identidades existentes, sem inventar tempos padrão |
| Camada 2 | `oee_tempo_real`, aprendizado de ciclos e atualização automática instalados no Supabase |
| API | Publicada em [ac-mes-api.onrender.com](https://ac-mes-api.onrender.com), no plano gratuito do Render; gravações exigem autenticação |
| Streamlit | Publicado em [ac-oee.streamlit.app](https://ac-oee.streamlit.app), no Streamlit Community Cloud gratuito; painel protegido por senha |
| Serviços preparados para aprendizado | API aceita medições explícitas; painel distingue referência estimada e padrão informado; testes aprovados |
| Alimentação pela fábrica | Coleta existente preservada; ainda não envia seus eventos e tempos reais para a nova API |
| k6 | Instalado e validado; teste completo executado somente em ambiente local descartável |

Os serviços de API e painel foram publicados sem contratar planos pagos. O Render gratuito suspende a API após 15 minutos sem tráfego; o próximo acesso pode levar cerca de um minuto, inclusive mais de 50 segundos, para acordá-la. A disponibilidade contínua e a capacidade industrial em nuvem ainda não foram validadas. [Limites oficiais do Render gratuito](https://render.com/docs/free).

A API conecta pelo Supavisor Transaction na porta 6543, com até 30 conexões de cliente por processo e fila limitada. O Supavisor foi verificado com pool de 15 conexões físicas por combinação de usuário/banco e limite de 200 clientes. O papel da API também tem limite de 30 conexões físicas; o papel do dashboard, que lê pelo pool de sessão na porta 5432, tem limite de 5.

O cálculo considera um turno fixo de 480 minutos por equipamento por dia em `America/Sao_Paulo`, conforme o contrato solicitado. Só paradas encerradas entram na duração. Sem produção, o dashboard mostra N/D. O OEE não é um cálculo por turno em andamento.

As migrações de aprendizado e associação de identidades foram aplicadas em produção como `20260907015138_mes_cycle_learning` e `20260907015149_mes_existing_piece_identities`. Após a aplicação havia **zero amostras de ciclo**. A cópia dos cadastros não criou apontamentos nem transformou scans antigos em duração de fabricação.

O aprendizado depende de início e fim reais da operação, origem da medição e indicação de interrupção/retrabalho. Só operações elegíveis alimentam a estimativa. O banco exige pelo menos 20 amostras em três dias por produto/equipamento e sinaliza a referência como estimada; ela não sobrescreve um padrão definido pela engenharia. Sem referência suficiente, desempenho e OEE permanecem desconhecidos.

Os códigos atuais são quase individuais por peça. Produtos fabricados uma única vez podem não atingir essas amostras. Ainda falta definir identidades recorrentes ou famílias industriais válidas e conectar a coleta à medição real; agrupar apenas por nome ou usar intervalo entre scans produziria tempos sem fundamento. A mesma operação física também não pode alimentar simultaneamente as duas origens, apontamento e histórico, pois a deduplicação atual é separada por origem.

As credenciais estão configuradas nos serviços de hospedagem e em arquivos locais privados ignorados pelo Git. Nenhum segredo integra o repositório. TLS é verificado nas duas conexões; `supabase-ca.crt` é um certificado público. O parâmetro `pgbouncer=true` não é necessário para o driver `pg`.

O teste k6 confirmou **2.401 novos apontamentos em 60 segundos**, com p95 de **2,791 ms**, somente na API e no PostgreSQL locais. Isso não comprova a mesma capacidade no Render/Supavisor nem com mil computadores conectados. Não foi executada carga de teste em produção. Os resultados completos estão no [relatório do k6 local](teste-k6-local-2026-09-07.md).
