# Implantação AC.Prod — usuários, operadores, e-mail, Microsoft e segurança

Este pacote contém o frontend e as funções Supabase atualizados. Ele não contém `node_modules`, `.git`, arquivos `.env`, chaves privadas ou senhas.

## O que foi corrigido

- Página `/usuarios`: cadastro, edição, permissões, escopo por célula, destinatários da IA, agendamentos, grupos, histórico e diagnóstico de e-mail.
- Página `/operadores`: acesso dos operadores cadastrados e exclusão definitiva com confirmação, preservando os nomes já gravados no histórico de coletas.
- Fechamento produtivo: seleção de gestor cadastrado, horário, frequência, conteúdo, envio de teste e rastreio do resultado.
- IA operacional: somente resolve e envia relatórios para destinatários cadastrados e autorizados no sistema.
- Login: botão Microsoft/Azure no lugar do Google e bloqueio após autenticação para e-mails sem perfil previamente cadastrado.
- Segurança: operações administrativas movidas para função protegida, validação de permissões, remoção de fallback inseguro e proteção das funções de cron/webhook por autenticação própria.

## Página correta para cadastrar o gestor de e-mail

Use **Administração → Usuários**, rota `/usuarios`:

1. Na aba **Contas**, cadastre ou edite o gestor.
2. Ative **Disponível para relatórios e IA**.
3. Se necessário, ative **Destinatário de fechamento produtivo**.
4. Na aba **Agendamentos**, crie o fechamento, selecione o gestor, horário, frequência, período e relatórios.
5. Na aba **Diagnóstico**, faça um envio de teste e confira os logs.

## 1. Aplicar o ZIP sobre o repositório

No terminal do Antigravity:

```bash
git clone https://github.com/Gilsantosz/ac-prod.git
cd ac-prod
git checkout main
git pull --ff-only origin main
git checkout -b fix/usuarios-operadores-email-microsoft-seguranca

mkdir -p /tmp/acprod-atualizado-usuarios-email
unzip -o /CAMINHO/AC.Prod_Atualizado_Usuarios_Email_Seguranca.zip -d /tmp/acprod-atualizado-usuarios-email
rsync -av --exclude='.git' /tmp/acprod-atualizado-usuarios-email/AC.Prod_Atualizado/ ./
```

Substitua `/CAMINHO/` pelo local em que o Antigravity disponibilizar o ZIP.

## 2. Validar antes de publicar

É necessário Node.js 20 ou superior.

```bash
node --version
npm ci
npm run test:unit
npm run build
git diff --check
git status --short
```

Resultado esperado: todos os testes e o build devem terminar sem erro.

## 3. Supabase de produção

Projeto atual: `uozuzdfvnufsjsonswag`.

As quatro migrações deste pacote **já foram aplicadas nesse banco de produção**. Portanto, no projeto atual, não execute `supabase db push` nem reaplique os SQLs 043–046. Eles permanecem no repositório para versionamento e criação de ambientes novos.

Faça login, vincule o projeto e publique novamente somente as funções:

```bash
npx supabase login
npx supabase link --project-ref uozuzdfvnufsjsonswag

for fn in admin-users sendDailyClosure syncResendContact send-report-email schedule-report-job; do
  npx supabase functions deploy "$fn" --project-ref uozuzdfvnufsjsonswag
done

for fn in generate-productive-backup promob-parse-order send-scheduled-reports; do
  npx supabase functions deploy "$fn" --project-ref uozuzdfvnufsjsonswag --no-verify-jwt
done
```

O segundo grupo usa `--no-verify-jwt` intencionalmente porque essas funções validam internamente o segredo de cron ou outro mecanismo próprio. Não use essa opção em outras funções.

Confirme em **Supabase → Edge Functions → Secrets** que existem, sem copiar valores para o Git:

- `RESEND_API_KEY` e `REPORT_FROM_EMAIL`; ou
- `SMTP_USER` e `SMTP_PASS`.

Nunca coloque `service_role`, senha SMTP, segredo Resend ou Client Secret da Microsoft em `VITE_*`, no código-fonte ou no GitHub Pages.

### Somente para um projeto Supabase novo

Em um ambiente novo e vazio, depois de revisar todas as migrações:

```bash
npx supabase link --project-ref NOVO_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

Não use esses dois comandos de `db push` no projeto de produção atual.

## 4. Ativar login Microsoft

O código do botão já está no pacote, mas o provedor precisa ser configurado com dados da empresa:

1. No Microsoft Entra ID, registre uma aplicação Web.
2. Use como callback: `https://uozuzdfvnufsjsonswag.supabase.co/auth/v1/callback`.
3. No Supabase, abra **Authentication → Providers → Azure (Microsoft)** e informe o Application/Client ID e o valor do Client Secret.
4. Se a aplicação for restrita à empresa, configure a Tenant URL com `https://login.microsoftonline.com/SEU_TENANT_ID`.
5. Em **Authentication → URL Configuration**, mantenha na lista de redirects:
   - `http://localhost:5173/**`
   - `https://gilsantosz.github.io/ac-prod/**`
6. Garanta que o e-mail da pessoa exista primeiro em `/usuarios`; autenticar na Microsoft não concede acesso por si só.

O fluxo solicita o escopo `email`, necessário para o Supabase validar a identidade retornada pela Microsoft.

## 5. Configurar o GitHub Pages

No repositório GitHub, abra **Settings → Secrets and variables → Actions** e confirme:

- `VITE_SUPABASE_URL` = `https://uozuzdfvnufsjsonswag.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = chave pública/anon do projeto (nunca a `service_role`)

Depois publique a branch:

```bash
git add -A
git commit -m "fix: restaurar usuarios operadores emails Microsoft e seguranca"
git push -u origin fix/usuarios-operadores-email-microsoft-seguranca
```

Abra um Pull Request para `main`, revise o build e faça o merge. Com GitHub CLI:

```bash
gh pr create \
  --base main \
  --head fix/usuarios-operadores-email-microsoft-seguranca \
  --title "Corrige usuários, operadores, e-mails, Microsoft e segurança" \
  --body "Restaura a administração de usuários e operadores, o fechamento produtivo por e-mail, a integração da IA, o login Microsoft e o endurecimento de segurança."
```

Após aprovação:

```bash
gh pr merge --merge --delete-branch
git checkout main
git pull --ff-only origin main
```

O workflow `.github/workflows/deploy.yml` é executado automaticamente a cada atualização da `main` e publica o diretório `dist` no GitHub Pages.

## 6. Teste funcional obrigatório

1. Abra `/usuarios` com um administrador e crie/edite um gestor.
2. Ative relatórios/IA, defina permissões e salve.
3. Crie um agendamento e envie um diagnóstico de e-mail.
4. Abra `/operadores`, confirme que os operadores aparecem e teste a exclusão com um operador de teste.
5. Entre na coleta com um operador registrado e valide nome, matrícula e célula.
6. Na `/ia-operacional`, solicite um fechamento para o gestor cadastrado e confira o log.
7. Teste o botão Microsoft com um e-mail cadastrado e depois com um não cadastrado; somente o primeiro deve acessar.
8. Confira **Actions → Deploy para GitHub Pages** e atualize a aplicação com `Ctrl+Shift+R` para eliminar o cache antigo do PWA.

## Critério de conclusão

A implantação só está concluída quando o workflow do GitHub Pages estiver verde e os testes de usuário, operador, envio de e-mail e login Microsoft tiverem sido executados. A única etapa que depende de credenciais externas não incluídas no pacote é a ativação do provedor Microsoft no Entra/Supabase.
