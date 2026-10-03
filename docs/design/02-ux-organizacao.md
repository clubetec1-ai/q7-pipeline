# 02 — UX e organização das telas (Deixa com a IA)

> Equipe de design · 03/10/2026 · base: código da branch `docs/prioridade-canais` + capturas de Início, Conversas,
> Chat, Clientes e Kanban. Objetivo do dono: **poucas abas, poucos ícones, linguagem simples, o cliente configura
> sozinho, seguro**. Papéis: **dono/admin** (configura), **supervisor** (acompanha), **atendente** (atende).

---

## 1. Mapa atual

### 1.1 Onde cada tela está hoje

Menu (`src/components/MainNav.tsx`): 4 links soltos + 4 grupos. Em telas médias só aparecem os ícones (o nome some
abaixo de `2xl`/`xl`), então o usuário vê **8 ícones sem texto** + seletor de empresa.

```
Topo (cabeçalho)
├── [seletor de empresa]
├── Início ............................ /inicio            (Inicio.tsx)
├── Conversas ......................... /                  (Conversas.tsx)   ← rota "/" é Conversas, não Início
├── Kanban ............................ /kanban            (Kanban.tsx)
├── Chat .............................. /chat              (Chat.tsx — chat INTERNO da equipe)
├── Clientes ▾
│   ├── Clientes e fichas ............. /clientes
│   ├── Registros ..................... /registros         (visível para TODOS, inclusive atendente)
│   ├── Cobranças ..................... /cobrancas         (módulo)
│   └── Campanhas ..................... /campanhas         (módulo)
├── Gestão ▾
│   ├── Relatórios .................... /relatorios
│   ├── Funil de vendas ............... /funil             (relatório + instalar funil + link de captação)
│   ├── Supervisor .................... /supervisor
│   ├── Avaliações .................... /avaliacoes
│   └── Melhorias ..................... /melhorias
├── Minha empresa ▾
│   ├── Diagnóstico ................... /diagnostico
│   ├── Marca ......................... /diagnostico?pagina=marca   (mesma tela do item de cima)
│   ├── Setores e processos ........... /setores
│   └── Equipe e permissões ........... /equipe  (abas Membros · Departamentos · Grupos · Ramais · Mensagens automáticas)
├── Configurações ..................... /configuracoes     (hub de cartões)
└── Ícones à direita: [presença] [telefone] [? assistente] [sino] [pessoa ▾ Segurança · Plataforma · Tema · Sair]
```

Hub de Configurações (`src/pages/Configuracoes.tsx`), 4 grupos / até 16 cartões:

```
Canais .............. WhatsApp → /numeros · E-mail → /numeros (mesma tela) · Telefonia e ramais → /equipe?tab=ramais
Atendimento ......... Distribuição e saudação → /equipe?tab=departamentos · Horário e LGPD → /configuracoes/atendimento
                      Etiquetas e grupos → /etiquetas · Biblioteca e respostas → /biblioteca
IA e automação ...... Chaves de IA → /configuracoes/ia · Agente de IA e follow-up → /agente · Fluxos → /fluxos
                      Base de conhecimento → /conhecimento
Integrações e conta . Cobranças (Asaas) → /configuracoes/cobrancas · Integrações → /integracoes
                      Uazapi — servidor global (só operador) → /admin/uazapi · Aparência → /configuracoes/aparencia
                      Segurança → /seguranca
```

Fora do menu: `/convite` (botão no cabeçalho quando há convite), `/fluxos/:id`, `/plataforma` (operador).

### 1.2 Problemas encontrados

**Duplicidades**
| # | O quê | Onde |
|---|-------|------|
| D1 | **Kanban** (topo) e **Funil de vendas** (Gestão) mostram as mesmas etapas; o nome "funil" está no relatório, não no quadro | `MainNav.tsx`, `Funil.tsx` |
| D2 | **Setores e processos** (`/setores`) × aba **Departamentos** em Equipe: o mesmo conceito com dois nomes e duas telas | `Setores.tsx`, `equipe/GroupsTab.tsx` |
| D3 | **Grupos** da equipe (aba em Equipe) × **grupos de clientes** (Etiquetas e grupos): mesma palavra, coisas diferentes | `Equipe.tsx`, `EtiquetasGrupos.tsx` |
| D4 | **Marca** (Diagnóstico: cores, logos, tom de voz) × **Aparência** (Configurações: logo e cores) | `Diagnostico.tsx`, `ConfigAparencia.tsx` |
| D5 | **Segurança** no hub de Configurações e no menu da pessoa | `Configuracoes.tsx`, `AppHeader.tsx` |
| D6 | Duas barras de progresso diferentes: "Primeiros passos" (Início, 9 passos) e "x de y essenciais" (hub) | `Inicio.tsx`, `Configuracoes.tsx` |
| D7 | **Relatórios** × **Supervisor** × números do **Início** (Dashboard): três painéis de números | `Relatorios.tsx`, `Supervisor.tsx`, `dashboard/Dashboard.tsx` |
| D8 | Cartões **WhatsApp** e **E-mail** do hub apontam para a mesma tela `/numeros` | `Configuracoes.tsx` |

**Nomes confusos / termos técnicos**
- "**Chat**" ao lado de "**Conversas**": o atendente não sabe qual é o do cliente (Chat é o interno da equipe).
- "**Kanban**", "**Stage**" (placeholder em inglês no seletor de etapa da conversa), "**follow-up**", "**Fila**",
  "**IA**" como aba, "**Devolver à IA**", "**protocolo #2026-000003**" em destaque.
- "**Números**" é o título da tela onde também ficam as **caixas de e-mail** e a lista "Não viram atendimento".
- Conectar WhatsApp: "**Phone Number ID**", "**WABA ID**", "**Access Token permanente**", "**Uazapi**".
- "**Registros**" (genérico demais; na prática é "Conta a receber", "Pedidos", "Contratos").
- "**Chaves de IA**" e "**provedor padrão**": a IA já vem incluída (IA da Clubetec); isso é avançado.
- "**Distribuição e saudação**" leva à aba Departamentos, mas a saudação está na aba **Mensagens automáticas**.
- "Horário e **LGPD**": as palavras para parar mensagens não são "LGPD" para o dono; é "Pedir para não receber mensagens".

**Escondido ou no lugar errado**
- **E-mail** não tem tela própria: fica no rodapé de "Números". O botão "Não é atendimento" diz "desfaça em
  Configurações → E-mail", que não existe com esse nome.
- **Primeiros passos** começam pelo Diagnóstico e Marca; o e-mail **não está** nos passos; WhatsApp é o 3º. O dono
  pediu: WhatsApp → e-mail → empresa → IA → equipe.
- **Convidar atendente** está em Minha empresa → Equipe e permissões → aba Membros → botão (4 cliques, sem atalho
  no Início).
- **Uazapi — servidor global** (só operador Clubetec) aparece dentro do hub do cliente; deveria ficar em Plataforma.
- **Instalar funil pronto** e **link de captação** estão num relatório (Gestão → Funil), não em configuração.
- **Plano de implementação** (passo 9 do Início) aponta para `/setores`, nome que não sugere "plano".
- **Registros** aparece para o atendente (mostrado para todos, `show: true`).

**Bug visível de organização (captura do Kanban)**: ao instalar o funil pronto, as etapas novas entram **depois**
das antigas (`install_sales_funnel` usa `max(position)+1`), e o quadro fica *Novo Lead → Em Negociação → **Fechado**
→ Qualificado → Diagnóstico → Proposta…* — "Fechado" no meio do funil.

**E-mails automáticos virando lead (capturas de Conversas, Clientes e Kanban)**: `pagamento@registro.br`,
`hostmaster@registro.br`, `faturamento@…`, `financeiro@…`, `info@infojobs`, `comunicacao@salesmeet`,
`transacional@catho` entraram como atendimento, como **cliente** e como **Novo Lead** (14 de 14 cards). O filtro
`isAutomated` (`_shared/mail-utils.ts`) não cobre `hostmaster`, `pagamento`, `faturamento`, `cobranca`, `billing`,
`invoice`, `nfe`, `cadastro`, `seguranca`/`security`, `suporte@<plataforma>` etc.; e `sync-email` coloca **toda**
conversa nova de e-mail na 1ª etapa do funil (`stage_id: stage?.id`).

### 1.3 O que cada papel realmente usa

| Tela | Dono/admin | Supervisor | Atendente | Proposta |
|------|:--:|:--:|:--:|------|
| Início | ✔ | ✔ | ✔ | fica (cada papel vê o seu painel) |
| Conversas | ✔ | ✔ | ✔ | fica |
| Kanban | ✔ | ✔ | ✔ | vira **Funil** |
| Chat (interno) | ✔ | ✔ | ✔ | sai do menu → ícone no cabeçalho com contador |
| Clientes / Registros / Cobranças / Campanhas | ✔ | ✔ | Clientes, Cobranças* | juntar em **Clientes** com abas |
| Relatórios / Funil (relatório) / Supervisor / Avaliações / Melhorias | ✔ | ✔ | só "meus números" | juntar em **Resultados** com abas; atendente vê os próprios números no Início |
| Diagnóstico / Marca / Setores / Equipe | ✔ | — | — | vão para **Configurações** |
| Segurança / Plataforma | ✔ | ✔ | ✔ | só no menu da pessoa |

\* quando a empresa permite atendente cobrar.

---

## 2. Nova organização

### 2.1 Menu principal por papel (máx. 6 itens, sempre com texto)

```
DONO / ADMIN                      SUPERVISOR                        ATENDENTE
├── Início                        ├── Início (equipe agora)         ├── Início (meu dia)
├── Conversas                     ├── Conversas                     ├── Conversas
├── Funil                         ├── Funil                         ├── Funil
├── Clientes                      ├── Clientes                      └── Clientes
├── Resultados                    └── Resultados
└── Configurações
Cabeçalho (direita, todos): [💬 Equipe (chat interno, contador)] [🔔] [? Ajuda] [Pessoa ▾]
Pessoa ▾: Meu status (online/pausa) · Segurança da conta · Tema · Sair · (operador: Plataforma)
```

- **Funil** = o quadro Kanban (nome que o dono entende). O relatório "contatos por etapa / origem" vira aba em Resultados.
- **Clientes** (abas): Clientes · Registros (renomear para o nome do tipo, ex.: "Contas a receber") · Cobranças · Campanhas
  — cada aba só aparece se o módulo/permissão existir; atendente vê só Clientes (e Cobranças se permitido).
- **Resultados** (abas): Agora (atual Supervisor) · Relatórios · Funil de vendas · Avaliações · Melhorias.
- O **telefone** (ramal) fica no cabeçalho só quando o módulo de telefonia estiver ativo (já é assim).
- A presença (online/pausa) sai do cabeçalho de Conversas e vai para o menu da pessoa + um ponto de cor no avatar.
- Texto sempre visível nos 6 itens (são poucos, cabem); no celular, tudo no ☰ como hoje.

### 2.2 Hub de Configurações reagrupado (linguagem simples)

```
Configurações
├── 1. Onde seus clientes falam com você
│   ├── WhatsApp ......................... /configuracoes/whatsapp   (atual /numeros, só WhatsApp)
│   ├── E-mail ........................... /configuracoes/email      (caixas + "E-mails que não são atendimento")
│   ├── Facebook e Instagram ............. "Em breve"
│   └── Telefone ......................... só com módulo (ramais saem da aba de Equipe)
├── 2. Sua empresa (o que a IA precisa saber)
│   ├── Conte sobre a empresa ............ /diagnostico               (Diagnóstico)
│   ├── Horário de atendimento ........... /configuracoes/atendimento
│   ├── Marca e aparência ................ junta Marca (tom de voz) + Aparência (logo e cores)
│   ├── Documentos para a IA ............. /conhecimento               (Base de conhecimento)
│   └── Arquivos e respostas prontas ..... /biblioteca
├── 3. Assistente de IA
│   ├── Ligar e testar o assistente ...... /agente   (inclui "Retomar conversas paradas" = follow-up)
│   ├── Menus e respostas automáticas .... /fluxos   (Fluxos)
│   └── Avançado: usar minha própria chave de IA ... /configuracoes/ia
├── 4. Equipe
│   ├── Pessoas e convites ............... /equipe (Membros)
│   ├── Setores e filas .................. junta /setores + aba Departamentos + distribuição
│   ├── Mensagens automáticas ............ saudação e protocolo (sai da aba de Equipe)
│   └── Etiquetas e grupos de clientes ... /etiquetas
├── 5. Vendas e cobrança
│   ├── Etapas do funil .................. editar etapas + "instalar funil pronto" + links de captação
│   ├── Cobranças (Asaas) ................ /configuracoes/cobrancas
│   └── Ligar com outros sistemas ........ /integracoes
└── 6. Privacidade
    └── Quem pediu para não receber mensagens (atual "LGPD" de Horário e LGPD)
```

Saem do hub: **Segurança** (fica no menu da pessoa) e **Uazapi — servidor global** (vai para Plataforma, operador).
Cada cartão mantém o selo Configurado / Pendente / Opcional (já existe e funciona bem).

### 2.3 "Primeiros passos" guiado (Início do dono)

Uma só lista e um só progresso (o hub mostra "Continuar primeiros passos" enquanto faltar algo).

```
Primeiros passos
├── 0. Como vai ser o atendimento?  [Só eu]  [Eu e uma equipe]        (já existe)
├── 1. Conectar o WhatsApp           → QR Code em 2 min; teste: "mande um oi de outro celular"
├── 2. Conectar o e-mail (opcional)  → [Conectar] [Pular por agora]
├── 3. Contar sobre a empresa        → Diagnóstico: etapa Empresa + horário + marca (o resto fica para depois)
├── 4. Ligar o assistente de IA      → testar com 1 pergunta e ligar
├── 5. Convidar a equipe             → (só "com equipe") e-mail + papel + setor
└── Para depois (recolhido): Etiquetas · Menus automáticos (fluxos) · Documentos para a IA · Plano de implementação
```

Regras: o passo seguinte abre já no ponto certo (ex.: `/configuracoes/whatsapp?novo=1` abre o diálogo de conexão);
ao concluir, a tela volta ao Início com "✓ Pronto — próximo: …"; o passo 4 só libera depois do 1 (sem canal a IA não
tem o que responder) e avisa se o 3 estiver vazio.

---

## 3. Fluxos principais revisados

### 3.1 Atender uma conversa (atendente)
**Hoje:** Conversas → abas Meus/Fila/IA/Todos → abrir → cabeçalho com até **8 controles** (seletor "Stage", Ficha,
Não é atendimento, selo, protocolo, Assumir, Transferir, Devolver à IA, Finalizar) + barra de etiquetas + barra
"Agendar follow-up" sempre aberta → digitar.
**Atritos:** muitos botões do mesmo peso; "Stage" em inglês; "follow-up" e "IA" como jargão; o aviso "IA responderá
automaticamente…" fica só no placeholder; e-mails automáticos poluem a lista.
**Correção:**
1. Abas: **Meus · Aguardando · Com a IA · Todos**; abre em "Meus"; "Aguardando" com contador em destaque.
2. Cabeçalho com **um botão principal** que muda com a situação: *Assumir* → *Finalizar*. O resto em **⋯ Mais**:
   Transferir, Devolver para a IA, Agendar retorno, Não é atendimento (e-mail).
3. Seletor de etapa com rótulo **"Etapa do funil"**; Ficha vira ícone de pessoa com texto "Ficha".
4. Faixa acima da caixa de texto quando a IA está atendendo: "O assistente está respondendo esta conversa ·
   [Assumir]". "Agendar follow-up" vira **"Agendar retorno"** dentro do ⋯ (lista só aparece se houver agendamento).
5. Feedback: toast "Você assumiu · o cliente foi avisado" / "Finalizado · protocolo 2026-000003".

### 3.2 Mover lead no funil
**Hoje:** Kanban → arrastar card (horizontal com rolagem) ou seletor "Stage" na conversa.
**Atritos:** ordem de etapas quebrada após instalar o funil pronto; colunas duplicadas por nome parecido; 100% dos
cards são e-mails automáticos; arrastar não funciona bem no celular; sem "desfazer"; sem motivo de perda.
**Correção:** nome **Funil**; instalar funil pronto **reordena** (pergunta "substituir as etapas atuais?" e move os
contatos para a etapa equivalente); menu **"Mover para…"** em cada card (celular/teclado); toast **"Movido para
Proposta enviada · Desfazer"**; ao mover para "Perdido", pedir o motivo (1 clique); só entram leads de verdade (item 4).

### 3.3 Configurar o WhatsApp (dono)
**Hoje:** Início → "Conectar o WhatsApp" → tela "Números" → Adicionar número → escolher "WhatsApp oficial (Meta)"
(Phone Number ID, WABA ID, Access Token) ou "Por QR Code (Uazapi)".
**Atritos:** termos técnicos; a opção "recomendada" é a mais difícil para quem configura sozinho; depois de conectar
não há teste guiado.
**Correção:** tela **WhatsApp**; duas escolhas em linguagem simples — *"Conectar agora pelo QR Code (2 minutos)"* e
*"WhatsApp oficial da Meta (para empresas com conta Meta)"*, sem citar Uazapi; na oficial, passo a passo com
imagens e os IDs/token em "Preencher manualmente" (quando a etapa 4B de `meta-onboard` — "Conectar com Facebook" —
existir, ela vira o caminho principal); ao conectar: **"Conectado! Mande um
'oi' de outro celular"** com a mensagem aparecendo ao vivo e o ✓ voltando ao Início.

### 3.4 Ligar a IA (dono)
**Hoje:** Início → "Ligar o agente de IA" → `/agente` → interruptor; se faltar chave, toast "Configurações → Chaves de
IA" (mesmo com a IA da Clubetec incluída); texto livre "Como o agente se comporta"; teste separado.
**Atritos:** pré-requisitos invisíveis (canal, empresa, horário); "agente", "follow-up", "provedor"; ligar sem testar.
**Correção:** tela **Assistente de IA** com checklist no topo (✓ WhatsApp conectado · ✓ Empresa contada · ✓ Horário);
caixa **"Faça uma pergunta como se fosse um cliente"** (o `AgentTester` já existe) antes do interruptor; interruptor
grande "Assistente respondendo: Ligado/Desligado" com confirmação "a partir de agora ele responde clientes novos";
"Retomar conversas paradas" no lugar de follow-up; chave própria só em "Avançado".

### 3.5 Convidar atendente (dono)
**Hoje:** Minha empresa → Equipe e permissões → aba Membros → Convidar pessoa → e-mail, Papel (lista), Departamentos.
**Atritos:** 4 cliques e sem atalho; papel sem explicação; "Departamentos" × "Setores"; não fica claro o que acontece
depois do envio.
**Correção:** atalho no passo 5 do Início e em Configurações → Equipe; papéis como 3 cartões com uma linha cada
(*Atendente: responde clientes do setor · Supervisor: acompanha e ajuda o setor · Admin: configura tudo*); campo
**Setor** obrigatório para atendente; depois do envio: "Convite enviado para ana@… · aparece como *Aguardando* até ela
entrar · [Reenviar] [Copiar link]".

---

## 4. Lista priorizada

Esforço: **P** ≤ 1 dia · **M** 2–4 dias · **G** 1 semana+. Ordem dentro de cada prioridade = maior ganho / menor esforço.

### P1 — fazer agora
| # | Mudança | Arquivos | Esf. |
|---|---------|----------|:--:|
| 1 | **Menu com 6 itens com texto** (Início, Conversas, Funil, Clientes, Resultados, Configurações); Chat vira ícone "Equipe" no cabeçalho com contador; Minha empresa vai para Configurações; Gestão vira Resultados; Registros some para o atendente | `components/MainNav.tsx`, `components/AppHeader.tsx`, `pages/Inicio.tsx` (atalhos) | P |
| 2 | **E-mails automáticos não viram lead**: (a) ampliar `isAutomated` com `hostmaster`, `postmaster`, `pagamento`, `faturamento`, `cobranca`, `billing`, `invoice`, `nfe`, `boleto`, `cadastro`, `seguranca/security`, `suporte@` de plataformas e cabeçalhos `X-Auto-Response-Suppress`/`Feedback-ID`; (b) e-mail novo entra **sem etapa** (`stage_id = null`) e só vai ao funil quando alguém responde, move ou a IA marca como cliente; (c) botão "Limpar e-mails automáticos" que aplica a regra nos já existentes (com confirmação, só fecha atendimento — nada é apagado) | `supabase/functions/_shared/mail-utils.ts`, `supabase/functions/sync-email/index.ts`, `pages/Kanban.tsx`, `pages/numeros/IgnoredSenders.tsx`, nova migration para a limpeza | M |
| 3 | **Primeiros passos na ordem do dono** (WhatsApp → e-mail → empresa → IA → equipe) + "Para depois" recolhido; um só progresso (hub mostra "Continuar primeiros passos") | `pages/Inicio.tsx`, `pages/Configuracoes.tsx`, `lib/useSetupStatus.ts` | P |
| 4 | **Cabeçalho da conversa enxuto**: um botão principal (Assumir/Finalizar) + "⋯ Mais"; "Stage" → "Etapa do funil"; abas Meus/Aguardando/Com a IA/Todos; faixa "assistente respondendo · Assumir"; follow-up → "Agendar retorno" dentro do ⋯ | `pages/Conversas.tsx`, `pages/conversas/TicketBar.tsx`, `pages/conversas/EmailIgnoreButton.tsx` | M |
| 5 | **Hub de Configurações em 6 grupos de linguagem simples**; E-mail com tela própria; WhatsApp sem jargão (QR primeiro, IDs em "Preencher manualmente"); Uazapi global → Plataforma; Segurança só no menu da pessoa | `pages/Configuracoes.tsx`, `pages/Numeros.tsx` (dividir), `pages/numeros/EmailAccounts.tsx`, `pages/numeros/AddNumberDialog.tsx`, `App.tsx` (rotas + redirecionar `/numeros`) | M |

### P2 — em seguida
| # | Mudança | Arquivos | Esf. |
|---|---------|----------|:--:|
| 6 | Kanban → **Funil**: instalar funil pronto reordena/substitui etapas (nova migration ajustando `install_sales_funnel`); "Mover para…" no card; toast com Desfazer; motivo de perda | `pages/Kanban.tsx`, `pages/Funil.tsx`, nova migration | M |
| 7 | **Resultados** com abas (Agora, Relatórios, Funil de vendas, Avaliações, Melhorias); atendente vê "meus números" no Início | nova `pages/Resultados.tsx`, `Relatorios.tsx`, `Supervisor.tsx`, `Avaliacoes.tsx`, `Melhorias.tsx`, `Funil.tsx`, `App.tsx` | M |
| 8 | **Clientes** com abas (Clientes, Registros pelo nome do tipo, Cobranças, Campanhas) | `pages/Clientes.tsx`, `Registros.tsx`, `Cobrancas.tsx`, `Campanhas.tsx`, `App.tsx` | M |
| 9 | **Setores únicos**: juntar `/setores` + aba Departamentos + distribuição; "Grupos" da equipe vira "Times" (ou some se pouco usado); Mensagens automáticas sai de Equipe | `pages/Setores.tsx`, `pages/Equipe.tsx`, `pages/equipe/GroupsTab.tsx`, `DistributionSettings.tsx`, `GreetingSetting.tsx` | M |
| 10 | **Assistente de IA**: checklist de pré-requisitos, teste antes do interruptor, "Retomar conversas paradas"; sem toast de chave quando a IA da plataforma está ativa | `pages/Agente.tsx`, `pages/agente/AgentTester.tsx`, `pages/ConfigIA.tsx` | P |
| 11 | **Convite** com papéis em cartões, setor obrigatório para atendente, estado "Aguardando" e reenviar | `pages/equipe/MembersTab.tsx`, `supabase/functions/manage-members` (reenviar, se faltar) | P |

### P3 — depois
| # | Mudança | Arquivos | Esf. |
|---|---------|----------|:--:|
| 12 | **Marca e aparência** numa tela só (tom de voz do Diagnóstico + logo/cores) | `pages/ConfigAparencia.tsx`, `pages/Diagnostico.tsx` | M |
| 13 | **Triagem do e-mail pela IA** (cliente / fornecedor / aviso automático) antes de abrir atendimento, com "Não é atendimento" sugerido | `supabase/functions/sync-email/index.ts`, `_shared/` (prompt) | M |
| 14 | Cartões "Facebook e Instagram — em breve" e Telefone genérico no grupo Canais | `pages/Configuracoes.tsx` | P |
| 15 | Glossário único de termos na interface (Etapa, Retorno, Aguardando, Assistente, Setor) aplicado em toasts e no `AppAssistant` | `components/AppAssistant.tsx`, varredura de textos | G |
