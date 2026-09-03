# Runbook — falha em Workers Builds: ac-prod2

Status em 2026-09-02: **integração Cloudflare falhando; build local válido; último
deploy publicado não foi substituído**.

## Impacto

O check `Workers Builds: ac-prod2` é um pipeline de publicação, não o worker
assíncrono do Collection Fabric no Supabase. Uma falha nele:

- bloqueia a publicação do novo frontend no Cloudflare;
- não remove nem derruba automaticamente a versão anterior;
- não explica, por si só, falhas nas Edge Functions `process-collection-v3` e
  `project-collection-v3`;
- é crítica para release se o domínio oficial aponta para o Cloudflare, mas não
  causa indisponibilidade imediata enquanto a versão anterior responde.

## Evidência atual

- PR 63, commit `3e477a2c3b367ce89257b50e5ff79ff45339b917`:
  build Cloudflare `c4281e56-033e-4bd7-bd3c-b5406e9cffa6` falhou imediatamente.
- O mesmo comportamento ocorreu nos commits `8f49c7ce...` e `111501f5...`, mesmo
  com os workflows GitHub e a publicação GitHub Pages aprovados.
- `npm ci`, `npm run build` e `npx wrangler@latest deploy --dry-run` passaram. O
  dry-run leu 30 arquivos de `dist` e validou `wrangler.jsonc`.
- A API de checks do GitHub não expõe o log interno do Cloudflare; o diagnóstico
  final exige abrir o Build ID no dashboard da conta.

Essa combinação aponta para configuração/permissão da integração Cloudflare ou
do ambiente remoto, e não para erro de compilação reproduzível no repositório.

## Diagnóstico no dashboard

1. Abra o Build ID com falha e capture a primeira mensagem de erro e o horário,
   sem copiar tokens ou variáveis secretas.
2. Confirme o repositório `Gilsantosz/ac-prod`, branch de produção e permissão do
   aplicativo GitHub da Cloudflare para ler commits e publicar checks.
3. Confirme diretório raiz do projeto `/`, comando de build `npm run build` e
   diretório de assets `dist`. O `wrangler.jsonc` já aponta para `./dist`.
4. Confirme uma versão Node compatível com o lockfile e que `npm ci` é usado sem
   alteração do lock.
5. Revise variáveis de build obrigatórias. Nunca coloque `service_role`, JWT de
   usuário ou segredo de cron no frontend/Cloudflare.
6. Se o log indicar autorização Git, reconecte a integração/reinstale o acesso
   somente ao repositório. Se indicar comando/diretório, alinhe com os valores do
   item 3.

## Reteste e gate

1. Reexecute o build do mesmo commit; não crie uma mudança vazia para mascarar o
   problema.
2. Exija os checks GitHub, o check Cloudflare e o dry-run locais verdes.
3. Abra a URL de preview e valide `build-info.json`, navegação SPA, login, refresh
   de token e reconexão Realtime.
4. Só promova a produção depois de resolver também o NO-GO de capacidade do
   Collection Fabric. Um Cloudflare build verde não substitui os testes de SLO.

## Contenção/rollback

Mantenha a versão Cloudflare anterior ativa e não apague deployments. Se um novo
deploy chegar a ser publicado e apresentar regressão, selecione a última versão
conhecida como boa no histórico do Worker e valide o domínio. Os flags v3 do
Supabase devem permanecer desligados durante o diagnóstico atual.

