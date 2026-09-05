# Configurações administrativas de sessão

O menu **Administração → Configurações** reúne a política de tempo de tela. O
acesso e o salvamento são exclusivos de administradores ativos. A configuração
é compartilhada pelo Supabase; cada navegador mede sua própria atividade.

## Operação

- **Geral:** tempo padrão de inatividade em minutos (1–1440) e antecedência do
  aviso em segundos (0–300; zero oculta o aviso). O padrão inicial mantém os
  30 minutos usados pelo sistema, com aviso de 60 segundos.
- **Nível de acesso:** exceção opcional para cada perfil. Em uma estação com
  operador identificado, o perfil considerado é Operador.
- **Célula:** exceção opcional para uma célula produtiva.
- **Setor:** agrupamento nomeado de células para essa política, com tempo
  opcional. Cada célula pode pertencer a um único agrupamento. Este cadastro
  define a política de sessão e não altera o acesso aos dados produtivos.

Para resolver mais de uma regra aplicável, prevalece a primeira nesta ordem:
**célula → nível de acesso → setor → padrão**. Um campo de exceção vazio herda a
próxima regra. A célula é a selecionada na sessão operacional ou a vinculada ao
perfil autenticado. Um gestor sem célula vinculada usa sua regra de acesso ou
o padrão geral; a lista de células gerenciadas não escolhe um setor por ele.

Interação humana e leitura pelo coletor mantêm a tela ativa. Atualizações de
KPIs, Realtime, consultas automáticas e renovação de token não contam como
atividade. Fechar a janela, recarregar ou suspender o aparelho não reinicia o
prazo. As novas configurações são consultadas em até 60 segundos enquanto o
aplicativo está ativo e conectado. Sem rede, permanece a última configuração
conhecida; sem cache, o padrão é 30 minutos.

Ao vencer o prazo, o aplicativo exige novo login, limpa o contexto operacional
local e encerra a sessão de autenticação daquele navegador. As sessões em
outros aparelhos continuam independentes. Registros de coleta no IndexedDB
são preservados. A retomada do envio continua sujeita às regras existentes de
autorização e reconciliação de cada fluxo.

## Persistência e publicação

`public.system_settings` contém uma única linha `id = 'session'`. Leituras
exigem perfil autenticado ativo. O RPC `save_system_settings` valida o perfil
administrador, todos os valores e a versão editada antes de gravar. A auditoria
registra os valores anteriores e novos. Uma edição concorrente recebe conflito
e deve ser recarregada; não sobrescreve silenciosamente a outra edição.

Aplicar a migration aditiva `20260905025625_admin_session_settings.sql` antes
de publicar o front. Não requer alterar as flags de coleta nem o tempo de
expiração dos JWTs. Enquanto a tabela não estiver disponível, a página informa
falha de carregamento e o login conserva a política em cache ou o padrão.

Este recurso controla a tela do aplicativo e utiliza o logout existente. Não
implementa revogação instantânea de todo JWT já emitido: o Supabase distingue a
remoção da sessão local da validade do access token até seu vencimento.
Referências oficiais: [logout e escopo local](https://supabase.com/docs/reference/javascript/auth-signout)
e [sessões e validade dos tokens](https://supabase.com/docs/guides/auth/sessions).

## Verificação para publicação

1. Executar os testes de políticas, cache, autenticação, corridas de sessão e
   formulário, além dos gates normais de lint, tipos e build.
2. Validar a migration em PostgreSQL isolado, incluindo perfis não autorizados,
   payloads inválidos, auditoria e conflito de versão.
3. Conferir a linha padrão, RLS e grants após aplicar a migration.
4. Em uma sessão de homologação, configurar um prazo curto, verificar o aviso,
   testar leitura no scanner e confirmar a exigência de novo login ao vencer.
   Repetir com célula, perfil e setor, incluindo recarga e suspensão.

Para voltar ao comportamento anterior, manter todas as exceções vazias,
configurar 30 minutos e aviso zero. Um rollback do front não deve apagar os
dados de configuração ou auditoria.

### Evidências desta implementação

A suíte completa do aplicativo passou em **527 testes / 109 arquivos**,
incluindo políticas, formulário, sessão operacional, relógio de inatividade e
corridas com o SDK real do Supabase e respostas HTTP simuladas. Lint, tipos,
build, busca de segredos e o contrato estático da coleta passaram. A auditoria
de dependências passou no limite de severidade alta definido pelo projeto;
apontou um aviso moderado preexistente em `fflate`, sem alteração de dependências
nesta implementação.

O script `scripts/test_system_settings_db.mjs` passou em 76 verificações de
DDL, RLS, autorização, validação, auditoria, rollback e versão desatualizada,
usando PostgreSQL 18.3 em PGlite 0.5.8 com dependências mínimas simuladas. O
PostgreSQL 17 nativo não pôde iniciar com um usuário sem privilégios neste
ambiente. Portanto, a execução com duas conexões simultâneas está marcada como
não realizada; o mesmo script oferece essa verificação em um ambiente nativo.
A validação isolada não equivale a uma homologação do banco produtivo completo.

Após autorização explícita, a migration foi aplicada ao projeto `ac-prod` em
05/09/2026, às 02:56 UTC. O arquivo foi alinhado à versão registrada pelo
Supabase: `20260905025625`. O conteúdo SQL permaneceu idêntico ao ensaiado
(SHA-256 `199918f53aeb017d56e7b6a6ff46097e8c0c99b09c557141dc19e84e9753c366`).
A conferência remota confirmou o padrão de 30 minutos e aviso de 60 segundos,
versão 1, RLS nas duas tabelas e acesso de escrita somente pelo RPC autorizado.
Não foram criadas regras específicas nem alterados dados de produção.

A abertura do preview local no navegador foi bloqueada pelo ambiente. A
interação do formulário foi verificada nos testes de componentes; a inspeção
visual e o ensaio de sessão em um aparelho real permanecem para a homologação.
