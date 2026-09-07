# Estado da implantação das camadas MES

Verificado em 7 de setembro de 2026, projeto Supabase `ac-prod` (`uozuzdfvnufsjsonswag`).

| Componente | Estado comprovado |
| --- | --- |
| Aplicativo React existente | Publicado no GitHub Pages; coleta existente preservada |
| Camada 1 | Sete tabelas criadas no Supabase, com restrições, índices e acesso restrito |
| Equipamentos | Cinco máquinas ativas copiadas do cadastro existente, preservando seus IDs |
| Camada 2 | `oee_tempo_real` criada; cron `atualiza_oee_minuto` executou com sucesso |
| API | Código e configuração reais preparados; leitura autenticada validada pelo Supavisor 6543 |
| Streamlit | Código e secrets privados preparados; leitura validada no pool de sessão 5432 |
| Hospedagem da API e Streamlit | Pendente de autenticação nas contas de hospedagem; ainda não são serviços públicos |
| Alimentação pela fábrica | Nova API ainda não substitui a coleta atual; integração final depende da publicação e do cadastro industrial |

A API usa até 30 conexões de cliente por processo, com fila limitada e autenticação. O Supavisor foi verificado com pool de 15 conexões físicas por combinação de usuário/banco e limite de 200 clientes. O papel da API também tem limite de 30 conexões físicas; o papel do dashboard tem limite de 5. Réplicas precisam respeitar o orçamento global. A capacidade do serviço de nuvem ainda requer medição após sua publicação.

O cálculo considera um turno fixo de 480 minutos por equipamento por dia em `America/Sao_Paulo`, conforme o contrato solicitado. Só paradas encerradas entram na duração. Sem produção, o dashboard mostra N/D. O OEE não é um cálculo por turno em andamento.

O cadastro anterior não contém tempo de ciclo padrão por produto; as entradas antigas consultadas não possuem SKU preenchido. Nenhum ciclo foi inventado, e dados em metros/chapas não foram transformados automaticamente em contagens de peças. O resumo novo permanecerá sem medições até que produtos reais e apontamentos vinculados estejam disponíveis. A coleta atual continua em seu fluxo existente.

As credenciais de `mes_api` e `mes_leitura`, a chave da API e a senha do dashboard ficam em arquivos privados ignorados pelo Git. O certificado `supabase-ca.crt` é público, obtido no endereço oficial exibido pelo Supabase e válido até 26/04/2031. TLS é verificado nas duas conexões. O parâmetro `pgbouncer=true` não é necessário para o driver `pg`.

Testes realizados: SQL em PostgreSQL 17 isolado; oito testes unitários de API; 1.000 inserções concorrentes em banco descartável com pico de 50 conexões; repetição idempotente, conflitos, permissões e recuperação de timeout; sete testes Streamlit. No banco real foram feitas somente leituras para validar os serviços, sem inserir produção de teste.
