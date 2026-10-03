# ClubeCRM — Painel do projeto

> Documento vivo do **gerente de projetos + CEO**. Atualizado a cada entrega.
> Detalhe de cada pedido: [ROADMAP.md](ROADMAP.md). Última revisão: **30/09/2026 (Revisão de fase 1)**.

## 1. Onde estamos

| Área | Situação | Comentário |
|---|---|---|
| Produto (funcionalidades) | 🟢 Avançado | Atendimento WhatsApp/e-mail, IA, fluxos, Kanban, Diagnóstico 3.0, marca, setores, campanhas, cobranças, ramal/Nvoip, relatórios, avaliações, melhoria contínua, chat interno, módulos por empresa |
| Segurança e isolamento | 🟢 Forte | RLS em todas as tabelas, cofre para segredos, MFA, travas de módulo no banco, 61 grupos de testes de isolamento (~500 verificações). Falta a varredura completa antes da produção |
| Layout e usabilidade | 🟡 Em evolução | Menu reorganizado, central de Configurações, Início guiado, painel de resultados, cor da marca. Faltam itens 5, 6, 9–12 da auditoria e um guia visual |
| Documentação técnica | 🔴 Fraca | Só o ROADMAP e o CLAUDE.md (desatualizado: ainda fala do Q7 Pipeline single-tenant) |
| Testes | 🟡 Parcial | Banco: forte (isolamento). Telas: conferência manual no Chrome. Sem testes automáticos de tela |
| Operação (confiabilidade) | 🔴 Fraca | Sem painel de saúde das funções/crons, sem alerta de falha, backup só o padrão do Supabase |
| Comercial (SaaS) | 🟡 Base pronta | Módulos por empresa prontos; faltam planos, assinatura, teste grátis, limites e contrato/termos (LGPD) |

## 2. Fases

| Fase | Objetivo | Situação |
|---|---|---|
| 1. Fundação multiempresa | Isolamento, permissões, MFA, cofre, canais | ✅ Concluída |
| 2. Atendimento completo | WhatsApp, e-mail, fluxos, IA, Kanban, etiquetas, relatórios, campanhas, cobranças | ✅ Concluída |
| 3. Consultoria guiada | Diagnóstico 3.0, marca, setores/processos, plano, melhoria contínua | 🟡 Falta: Sistemas e dados, Pós-venda, **Testar o agente**, outros modelos por nicho, convite ao responsável do setor |
| 4. Telefonia | Ramal, MicroSIP, Nvoip | 🟡 Falta: histórico Nvoip (403 — depende da Nvoip), WSS/WebRTC, gravação/transcrição |
| 5. Repaginação e auditoria | Menu, Configurações, Início, painel, correções da auditoria | ✅ Concluída (auditoria 1–5) |
| 6. Venda (SaaS) | Planos, assinatura, teste grátis, limites, termos/LGPD, entrada autoatendida | ⬜ Próxima |
| 7. Produção | Varredura de segurança completa, backups, monitoramento, documentação | ⬜ Antes do 1º cliente pagante |

## 3. Riscos e decisões pendentes

| # | Risco | Impacto | Ação |
|---|---|---|---|
| R1 | Dono com MFA e **0 códigos de recuperação** | Perder o acesso | Gerar em Conta → Segurança (ação do usuário) |
| R2 | E-mails automáticos viram atendimento/lead | Fila suja, métricas erradas | ✅ Resolvido (filtro + "Não é atendimento"); limpar os 7 atuais com o botão |
| R3 | Sem monitoramento de falhas (funções, crons, webhook) | Problema só aparece quando o cliente reclama | Painel de saúde + alertas (fase 7) — agente "Monitor de saúde" |
| R4 | Documentação técnica ausente | Dependência de uma pessoa/IA para manter | Criar ARQUITETURA, SEGURANCA, OPERACAO (em andamento) |
| R5 | Teste 55 de isolamento intermitente | Falso alarme ou falha real escondida | Investigar |
| R6 | Nvoip: histórico negado (403) | Ligações não entram sozinhas | Resposta do suporte Nvoip |
| R7 | Termos de uso / contrato de dados (LGPD) inexistentes | Não dá para vender | Fase 6 |

## 4. Checklist de "pronto" (toda entrega)

- [ ] **Segurança:** testes de isolamento passam; permissão e módulo conferidos no servidor (não só na tela); segredos só no cofre; nada sensível no navegador.
- [ ] **LGPD:** dados mínimos na IA; sensível marcado; quem vê o quê está claro.
- [ ] **Usabilidade:** tela no padrão (cabeçalho único, cartões, cores); texto claro e guiado; estados vazios explicam o que fazer; sem termo técnico para o cliente.
- [ ] **Autogerenciável:** o dono consegue fazer sozinho; erro com mensagem que diz como resolver.
- [ ] **Qualidade:** tipos e lint sem erro; build ok; funções publicadas; migration aplicada.
- [ ] **Verificação:** conferido no Chrome depois de publicar (telas que mudaram).
- [ ] **Registro:** ROADMAP e este painel atualizados; documentação técnica, se mudou arquitetura/segurança.

## 4.1 Teste de ponta a ponta — empresa fictícia "Auto Center Teste" (01/10)

Criada pela Plataforma como um cliente novo (modelo Prestação de serviços), com a conta do dono.

| # | Achado | Gravidade | Situação |
|---|---|---|---|
| E1 | Dono convidado **não conseguia aceitar o convite** ("apenas um owner pode alterar outro owner") — nenhum cliente novo entraria | 🔴 Crítico | ✅ Corrigido (+ teste 63) |
| E2 | Empresa nova **não conseguia fazer o 1º passo** (Diagnóstico) sem cadastrar chave de IA; mensagem apontava para lugar antigo | 🔴 Crítico | ✅ "IA da Clubetec incluída" (chave da plataforma no cofre, usada quando a empresa não tem a própria) + mensagens corrigidas |
| E3 | Com mais de uma empresa, o cabeçalho se sobrepõe (seletor de empresa + menu) | 🟠 Alto | ✅ Itens do topo só com ícone abaixo de 1536 px; seletor compacto |
| E4 | Depois de aceitar o convite, o sistema ficava na empresa antiga | 🟠 Médio | ✅ Vai direto para a empresa nova, no Início |
| E5 | Convite pendente não aparecia para quem já estava logado | 🟠 Médio | ✅ Botão "Convite (n)" no cabeçalho |
| E6 | Etiquetas padrão apareciam como "Pendente" | 🟡 Baixo | ✅ Contam como configuradas |
| E7 | Dois sistemas de "modelo" separados (Plataforma: Clínica, Escola, Loja… / Diagnóstico: Software) | 🟡 Médio | ✅ Parcial (02/10): o Diagnóstico abre sozinho no modelo da empresa; Software e Cartório nos dois lugares. Falta: etiquetas e fluxos por nicho |
| E8 | Horário de atendimento vazio na empresa nova; configurações de horário e palavras LGPD dentro de Fluxos | 🟡 Médio | ✅ (02/10): horário sugerido a partir da etapa Empresa do Diagnóstico (o dono só liga/desliga os dias e usa); tela Configurações → Horário e LGPD |
| E9 | Modelos prontos de fluxo e agente dependem da IA (dependiam da chave) | 🟡 | ✅ Resolvido com E2 |
| E10 | Sem número de WhatsApp de teste, não dá para testar o atendimento real ponta a ponta | ℹ️ | "Testar o agente" (conversa simulada) cobre a IA; WhatsApp exige um chip de teste |
| E11 | 🔴 Aprovar a etapa Empresa do Diagnóstico era recusado pelo banco (etapas novas Clientes, Marca e Regras fora da lista permitida) — nenhuma empresa nova passava do 1º passo | 🔴 Crítico | ✅ (02/10) lista corrigida + teste automático 65 |
| E12 | Agente respondeu com tabela (o WhatsApp não mostra tabela) | 🟡 Médio | ✅ (02/10) regra de formato de conversa no atendimento |
| E13 | Cartório: a lista de documentos veio do conhecimento geral da IA, não da empresa | 🟠 Alto | ⏳ base de conhecimento modelo do cartório (lista oficial por ato e tabela de emolumentos) |
| E14 | Depois de aprovar a etapa Empresa, a tela pulava para a próxima e o horário sugerido só aparecia ao voltar | 🟡 Médio | ✅ (02/10) fica na etapa com o horário pronto para usar |

**Agentes que precisam estar em produção desde o 1º dia (visão CEO):**
1. **Agente de atendimento** (com Regras e limites + Testar o agente) — é o que o cliente compra.
2. **Entrevistador/Diagnóstico** — é a porta de entrada e a implantação autoatendida.
3. **Avaliador de atendimentos** (qualidade) — prova valor e alimenta a melhoria contínua.
4. **Assistente do cliente no app** ("como faço…?") — reduz suporte humano (a construir).
5. **Monitor de saúde** (número caiu, chave inválida, fila parada) — avisa antes do cliente reclamar (a construir).

## 5. Papéis ("agentes") do projeto

| Papel | Quando | Como |
|---|---|---|
| Gerente de projetos + CEO | Toda entrega e fim de fase | Este painel, checklist de pronto, revisão de fase, prioridades pelo impacto no negócio |
| Revisor de segurança e LGPD | 1× por fase (com ok do dono) e varredura completa antes da produção | Agente `revisor-seguranca-qualidade` (.claude/agents) e plugin claude-security |
| Testador (QA) de usabilidade | Toda entrega (telas alteradas) e passada completa por fase | Chrome, roteiro por tela |
| Designer de interface | 1× guia visual; revisão por fase | Guia de cores, tipografia e componentes |
| Redator técnico | Toda entrega | docs/ e textos de ajuda |
| Confiabilidade (DevOps) | Fase 7 | Painel de saúde, alertas, backup e restauração testada |
| Assistente do cliente (no app) | Produto | "Como faço…?" dentro do sistema |
| Controle de custos de IA | Fase 6 | Custo por empresa, margem e alertas de limite |

## 6. Revisão de fase 1 — 30/09/2026

**O que está certo:** base multiempresa sólida e testada; muitas funcionalidades entregues e verificadas; travas no banco e no servidor
(não só na tela); organização do menu e da configuração muito melhor que no início do mês.

**O que falta (por prioridade de negócio):**
1. Terminar a auditoria (passos 3–5): e-mails automáticos, setor padrão, Equipe, Plataforma, acabamentos.
2. **Testar o agente** (conversa simulada) — dá segurança para o cliente ligar a IA sozinho.
3. Documentação técnica mínima (ARQUITETURA, SEGURANCA, OPERACAO) e atualizar o CLAUDE.md para o ClubeCRM multiempresa.
4. Fase 6 (venda): planos, assinatura, teste grátis, termos e contrato de dados.
5. Fase 7 (produção): varredura de segurança completa, monitoramento e backups.

**Decisões para o dono:** ordem entre (2) Testar o agente e (4) Venda; quando rodar a revisão de segurança por agente desta fase (custo ~140 mil tokens).
