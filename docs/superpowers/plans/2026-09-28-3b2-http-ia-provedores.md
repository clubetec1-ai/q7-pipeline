# 3B-2 — Bloco HTTP, ferramentas da IA e provedor por agente

Spec: `docs/superpowers/specs/2026-09-24-construtor-de-fluxo-design.md` §7, §8.

## Entregue
- **HTTP** (`_shared/flow/http.ts`): só https/443, DNS resolvido e qualquer IP interno recusado (v4/v6, mapeado, NAT64),
  sem redirecionamento, 10 s, 256 KB, só JSON; variáveis como valores JSON no corpo e `encodeURIComponent` na URL;
  `{{segredo.nome}}` só no bloco HTTP, do Vault (`org:<org>:http:<nome>`); 60 chamadas/min por org (`service_http_take`);
  URLs registradas no `audit_log` ao publicar. Motor puro: estado `http` → executor chama → `success`/`error`.
- **IA com ferramentas** (`_shared/flow/ai-agent.ts`): transferir, finalizar, mover etapa, salvar campo — só itens
  marcados no bloco, com enum; revalidação contra bloco + banco; auditoria sem conteúdo do cliente.
- **Provedores** (`_shared/ai-chat.ts`): Groq (failover de modelos), OpenAI, OpenRouter, Gemini, Anthropic, DeepSeek;
  chaves por `set_org_secret`, status por `ai_keys_status` (só booleanos).
- Correção: run termina sempre que o atendimento sai do robô (antes, falha da IA podia deixar o run em `ai`).

## Fora (fica para depois)
- `send_file` da IA (depende da biblioteca de arquivos), modo depuração do HTTP (corpo no log), campos personalizados.

## Verificação
- deno test 17/17 (motor + guarda HTTP); isolamento caso 28; guarda testada no runtime real (metadados, localhost,
  DNS para 127.0.0.1, redirect e não-JSON recusados); ferramenta chamada pela Groq de verdade.
