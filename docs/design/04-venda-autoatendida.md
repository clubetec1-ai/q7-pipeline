# 04 — Venda autoatendida (Fase 2, item 7)

> 04/10/2026 · aprovado pelo dono ("pode começar pela venda autoatendida e depois 3").
> Preços são configuráveis pela Clubetec (sugestão em docs/marketing/02); nada fica fixo no código.

## Jornada
1. **Página pública de planos** (`/planos`, sem login): planos públicos com preço, módulos e "Começar teste grátis".
2. **Criar conta** (`/login?modo=cadastro&plano=x`): e-mail + senha; confirmação por e-mail (Supabase Auth).
3. **Criar a empresa** (tela de quem ainda não tem empresa): nome, tipo (modelo: cartório, software, genérico…) e
   plano → `self_signup_org`: cria a empresa com o modelo, a pessoa como dona, a assinatura em **teste grátis**
   (`trial_days` do plano) e os **módulos do plano ligados sozinhos**.
4. **Configurações → Plano e assinatura**: situação (teste até dd/mm, ativa, em atraso, vencida), uso de IA do mês ×
   franquia, trocar de plano e **Assinar** (Asaas da Clubetec: o cliente escolhe PIX, boleto ou cartão na página do
   Asaas — nenhum dado de cartão passa pelo sistema).
5. **Pagamento confirmado** (webhook) → assinatura ativa até o fim do período; atraso → aviso; vencida → módulos
   desligados e tela "Assinatura vencida" (os dados ficam guardados; ao pagar, tudo volta).

## Dados
- `plans` (Clubetec edita em Plataforma → Planos): key, nome, descrição, preço mensal e de implantação (centavos),
  módulos, limites (`ai_calls_mes`, `numeros`, `membros`, `analises_mes`, `manual_dia`), dias de teste, público, ativo.
- `subscriptions` (1 por empresa): plano, status (`trial`, `active`, `past_due`, `canceled`, `expired`), fim do
  teste, fim do período, ids do Asaas, e-mail de cobrança. Escrita só pelo servidor/RPC.
- `private.apply_plan(org, plano)`: liga exatamente os módulos do plano e copia a franquia do cérebro.
- Franquia de IA: `service_ai_take` passa a recusar quando a IA **da plataforma** passa de `ai_calls_mes` no mês
  (chave própria da empresa não conta).

## Segurança
- Criar empresa sozinho: só com e-mail confirmado; no máximo 1 teste grátis por pessoa e 3 empresas por dono;
  auditado. Nome e modelo validados. Nada de criar empresa em nome de outra pessoa.
- Plano, assinatura e franquia: só a Clubetec (operador) e o servidor gravam; o dono só lê e pede para assinar.
- Webhook do Asaas da Clubetec com token próprio no Vault; cada evento só mexe na assinatura cujo id bate.
- 🙋 Supabase Auth: para o cadastro público, "Allow new users to sign up" ligado com **confirmação de e-mail**
  obrigatória (ajuste do dono no painel do Supabase).

## Fatias
V1 banco (planos, assinaturas, aplicar plano, criar empresa sozinho, franquia de IA, testes) → V2 telas (planos
públicos, criar empresa, Plano e assinatura, Plataforma → Planos) → V3 cobrança (Asaas da Clubetec, webhook, rotina
diária de teste/atraso/vencimento, tela de assinatura vencida).
