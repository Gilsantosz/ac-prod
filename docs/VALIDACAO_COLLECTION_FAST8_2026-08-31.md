# Validação técnica — coleta imediata de 8 dígitos AC.Prod2 v8.5

## Problema observado

O campo de coleta aguardava um debounce de 160 ms e permanecia ocupado até a conclusão da gravação local e da resposta do Supabase. Quando o operador realizava outra leitura rapidamente, o sistema podia ainda estar processando a leitura anterior.

O caminho antigo também consultava o contexto produtivo antes de chamar a RPC transacional, acrescentando uma ida extra à rede.

## Novo comportamento

Para Scanner físico, Câmera e Digitação manual produtiva:

```text
1º ao 7º dígito → apenas preenche o campo
8º dígito       → captura imediata
campo            → limpo antes da rede
leitura           → gravada na fila local durável
sincronização     → processada em FIFO
próximo código    → pode ser lido imediatamente
```

Exemplo válido:

```text
09950001
```

Regras:

- exatamente 8 dígitos numéricos;
- zeros à esquerda preservados;
- Enter, Tab e espaços enviados pelo coletor são ignorados;
- 7 dígitos não são enviados;
- 9 ou mais dígitos são bloqueados, sem truncamento silencioso;
- letras e símbolos são bloqueados;
- Enter depois da leitura não cria uma segunda submissão;
- RFID e integrações por API mantêm o comportamento anterior.

## Redução do caminho crítico

### Antes

```text
leitura → debounce 160 ms → resolução de contexto na rede → fila → RPC → resposta → limpar campo
```

### Depois

```text
8º dígito → limpar campo → IndexedDB → RPC transacional única
```

O servidor continua sendo a fonte de verdade para:

- identificação da peça;
- célula e etapa esperadas;
- ordem da rota;
- bloqueio de duplicidade;
- concorrência entre computadores;
- atualização do lote;
- KPIs;
- auditoria e Realtime.

## Proteções de concorrência

- cada leitura recebe um `client_event_id` exclusivo;
- a fila local é durável no IndexedDB;
- a sincronização permanece FIFO;
- navegadores com Web Locks usam o lock global existente;
- navegadores sem Web Locks usam uma corrente de Promises para manter a ordem;
- uma guarda de 250 ms impede somente a repetição do mesmo código causada pelo Enter do coletor;
- códigos diferentes podem ser capturados enquanto a leitura anterior ainda aguarda o servidor.

## Release do Supabase

```text
Projeto: uozuzdfvnufsjsonswag
Migração: 20260831150725_collection_exact_8_digit_fast_capture_v8_5
Release: 20260831_acprod_collection_fast8_v8_5
ready: true
```

Indicadores novos:

```text
collection_exact_8_digit_scan = true
collection_active_tags_8_digits = true
```

A auditoria da base encontrou todos os códigos produtivos ativos no padrão de 8 dígitos.

## Testes do servidor

### Entradas inválidas

Foram executadas pela RPC real:

| Entrada | Resultado |
|---|---|
| `0995000` | bloqueada — 7 dígitos |
| `099500011` | bloqueada — excedeu 8 dígitos |
| `ABC50001` | bloqueada — formato inválido |
| manual com `1234` | bloqueada — 4 dígitos |

Resultados comuns:

```text
status = invalid
reason_code = INVALID_CODE_LENGTH
expected_code_length = 8
```

Nenhuma entrada inválida criou:

- evento de coleta;
- leitura produtiva;
- entrada de produção.

### Entrada válida com zero inicial

Foi criada uma peça sintética `99000003` na célula Borda, processada pela RPC real e encerrada com `ROLLBACK`.

Resultado:

```text
success = true
status = approved
tag_value = 99000003
leituras aprovadas = 1
entradas produtivas = 1
eventos de coleta = 1
peça concluída = true
lote encerrado = true
```

O teste confirmou que o código permaneceu como texto e preservou todos os oito dígitos.

## Testes automatizados do front-end

Os testes cobrem:

- nenhuma submissão no 7º dígito;
- submissão imediata no 8º;
- campo limpo imediatamente;
- segunda peça aceita enquanto a primeira Promise continua pendente;
- Enter depois do oitavo dígito sem duplicação;
- excesso de dígitos bloqueado;
- caracteres não numéricos bloqueados;
- caminho rápido com uma única RPC;
- ausência da pré-consulta de contexto no caminho rápido;
- fallback FIFO sem Web Locks.

## Rollback e resíduos

Todos os cenários sintéticos do banco foram executados dentro de transações finalizadas com `ROLLBACK`. Nenhum dado de teste permaneceu no ambiente produtivo.
