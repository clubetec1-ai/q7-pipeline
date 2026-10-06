# 07 — A empresa completa com IA: arquitetura do cérebro e da rede de agentes

> Arquitetura · 06/10/2026 · **prioridade máxima** (decisão do dono). Status: **proposta para o dono aprovar** antes do código.
> Parte do que já existe: cérebro com áreas, metas, cobranças e agentes de área (docs/design/03, fatias 1–7), ciclo de
> melhorias (`improvements`), Diagnóstico com especialista por etapa (`_shared/specialists.ts`), implementador (rascunhos),
> avaliação automática dos atendimentos, monitor de saúde, Ajuda com suporte.
> Prova de fogo: **implantar a Clubetec do zero sem erro**; o que falhar lá é corrigido antes do primeiro cliente.

## 0. Objetivo e princípios

**Objetivo:** cada empresa cliente funciona como uma empresa completa com IA. O **cérebro** no topo, ao lado do dono, e abaixo
dele diretores, coordenadores, especialistas e executores, conversando entre si. Cada um tem um papel claro. O sistema
levanta tudo, desenha os processos, implanta, prova, opera e melhora. As pessoas ficam só com o que não vale automatizar.

**Princípios (não mudam):**
1. **Segurança é o pilar.** Isolamento total entre empresas, menor privilégio, segredos só no cofre, tudo auditado. Nenhum
   agente vê o que não precisa.
2. **A IA propõe, a pessoa certa aprova.** Nada vai ao ar sem aprovação. A autonomia sobe por nível (§4), sempre com limite,
   e o dono pode baixar ou pausar a qualquer momento.
3. **Determinístico primeiro.** Na ordem: regra ou fluxo fixo → modelo pronto → IA com base de conhecimento → pessoa.
   A IA só entra onde texto livre ajuda. Números vêm sempre do banco, nunca da IA.
4. **Nada vai ao ar sem prova.** Todo agente e todo fluxo passa por cenários de teste (§6) antes de atender um cliente.
5. **Informação completa antes de implantar.** O Diagnóstico mede a cobertura do que cada agente precisa. Falta vira
   pergunta, com o porquê e o risco ditos claramente.
6. **Contratos fechados.** Agentes trocam mensagens tipadas (JSON validado), nunca ordens em texto livre. O que vem de
   cliente, documento ou outro agente é **dado**, não instrução.
7. **Custo sob controle.** Franquia por empresa, orçamento por tarefa e disjuntor (§5.6). Chamada repetida com o mesmo
   pacote não paga duas vezes.

## 1. O organograma de IA

| Nível | Quem | Papel | Fala com cliente? |
|---|---|---|---|
| P | **Plataforma (Clubetec)** | Política fixa (`PLATFORM_POLICY`), catálogo de agentes e modelos, franquias, Guardião e Auditor globais (só metadados, nunca dados de cliente misturados) | Não |
| 0 | **Dono (pessoa)** | Decide, aprova o que é de risco, define a autonomia, liga e desliga | — |
| 1 | **Cérebro (CEO de IA)** | Visão do todo: objetivos, metas, prioridades da semana, delega, cobra e escala. Monta e mantém o organograma | Não |
| 2 | **Diretores de IA** (por área de gestão) | Comercial (vendas e marketing), Atendimento e pós-venda, Operações, Financeiro, Pessoas, Administrativo e conformidade, Tecnologia e dados. Cada um cuida das metas da área, revisa propostas dos coordenadores e escala ao cérebro | Não |
| 3 | **Coordenadores** (por setor, de `departments`) | Organizam os processos do setor, a fila, as regras e quem faz o quê; consolidam o que os especialistas propõem | Não |
| 4 | **Especialistas** (por processo) | Conhecem um processo a fundo (passo a passo, dados, exceções, prazo). Desenham, conferem e melhoram aquele processo | Não |
| 5 | **Executores** | Os únicos que agem: agente de atendimento (WhatsApp, e-mail, Messenger e Instagram), fluxos, campanhas, cobranças, agenda, follow-ups. Cada um com lista fechada de ações | **Sim** (só estes) |

**Equipe de apoio (transversal, a serviço de todos os níveis):**

| Agente | Faz | Nunca |
|---|---|---|
| **Analista de Diagnóstico** (entrevistador + especialista por etapa, já existe) | Levanta a empresa, mede cobertura, pergunta o que falta com o porquê | Inventar dado; insistir quando o dono diz "não tem" |
| **Revisor de área** | Segunda opinião sobre cada etapa aprovada: incoerências entre etapas, lacunas, riscos | Aprovar sozinho |
| **Arquiteto de processos** | Transforma o que foi contado em processo padronizado (§3) e decide automatizar, IA ou pessoa (§2.4) | Desenhar processo que o dono não contou |
| **Implementador** (já existe, só rascunho) | Monta fluxos, agentes, filas, etiquetas, respostas e base a partir dos processos aprovados | Publicar |
| **Guardião de segurança e LGPD** | Revisa toda proposta, agente e fluxo antes da prova: dados pessoais, permissões, promessas proibidas, texto que vaza informação | Liberar o que reprovou; ver segredos |
| **Auditor de qualidade** | Roda os cenários de teste (§6), avalia atendimentos (já existe), mede erros e chamados | Mudar agente sozinho |
| **Analista de dados** | Indicadores e semáforos por SQL fixo (já existe no cérebro) | Calcular número com IA |
| **Monitor de saúde** (já existe) | Números, e-mails, IA, filas e fluxos com erro | — |
| **Assistente e suporte** (Ajuda, já existe) | Ensina o caminho; abre chamado quando não resolve | Ver dados de cliente |

**Empresa pequena:** os níveis se juntam sozinhos. Com até 5 pessoas e 1 a 2 setores, o cérebro faz o papel de diretor e o
coordenador do setor faz o de especialista. O organograma mostra o mesmo desenho, só com menos caixas. Nada muda na segurança.

## 2. O ciclo de vida, com portões

Cada fase só termina quando passa no portão. O portão é conferido pelo **servidor** (regra fixa), nunca pela IA.

| Fase | Quem conduz | Entrega | Portão para seguir |
|---|---|---|---|
| F1 Levantamento | Analista de Diagnóstico + especialistas por etapa | Etapas do Diagnóstico com **cobertura por item** (completo, incompleto, faltando ou "não tem") | Itens obrigatórios completos ou marcados "não tem" pelo dono, nas etapas exigidas pelo plano |
| F2 Revisão | Revisores de área | Lista de incoerências e lacunas por etapa, aceita ou corrigida pelo dono | Nenhuma incoerência crítica aberta |
| F3 Organograma | Cérebro | Proposta de diretores, coordenadores, especialistas e executores (§1), com papel, escopo e autonomia | Dono aprova o organograma |
| F4 Processos | Arquiteto + especialistas | Cada processo no formato padrão (§3), com a decisão de automação | Dono (ou responsável da área) aprova cada processo |
| F5 Implantação | Implementador | Rascunhos: fluxos, agentes, filas, etiquetas, respostas, base de conhecimento, regras | Guardião sem reprovação |
| F6 Prova | Auditor + Guardião | Cenários de teste rodados (§6) com resultado | 100% dos cenários obrigatórios aprovados |
| F7 Ir ao ar | Dono | Publicação em degraus: **sombra** (a IA sugere e a pessoa envia) → **assistido** (a IA envia o que é simples e passa o resto) → **automático** dentro do limite | Dono liga cada degrau; o sistema sugere subir só com números bons (§6.3) |
| F8 Operar | Executores + Monitor + Analista | Atendimento, fluxos e indicadores | Contínuo |
| F9 Melhorar | Cérebro, diretores e coordenadores | Propostas no ciclo `improvements`; o resultado volta ao Diagnóstico e ao processo | Ciclo semanal (já existe) |

### 2.4 Matriz de decisão de automação (Arquiteto, por passo do processo)
1. Regra clara, sempre igual → **fluxo determinístico** (sem IA).
2. Texto padrão com variáveis → **modelo pronto** ou resposta rápida.
3. Pergunta aberta respondível pela base → **IA executora** com base de conhecimento e regras.
4. Decisão com dinheiro, contrato, exceção, saúde, jurídico ou emoção forte → **pessoa** (a IA prepara o resumo e passa).
5. Passo físico (instalar, entregar, visitar) → **pessoa**, com aviso e acompanhamento automáticos.

## 3. Processo como dado (formato padrão)
Hoje os processos ficam em `company_profiles.processes` (até 100, texto). Passam a ter o formato:

`{id, setor, nome, gatilho, objetivo, passos[{n, o_que, quem (pessoa|agente:key|fluxo), ferramenta, dados_necessarios[], prazo, decisao: fluxo|modelo|ia|pessoa}], excecoes[{quando, o_que_fazer}], dados_do_cliente[] (marcados pessoais ou sensíveis), sla, indicadores[metric_key], riscos[], dono_do_processo, versao, status: rascunho|aprovado|no_ar}`

Cada processo aprovado gera: o especialista (nível 4), as peças que o implementador monta e os cenários de teste (§6).

## 4. Níveis de autonomia

| Nível | O agente… | Quem pode ligar | Teto por risco |
|---|---|---|---|
| A0 | Só observa e registra | — | — |
| A1 | Sugere (proposta em `improvements`) | Padrão de todos | — |
| A2 | Prepara rascunho pronto para aprovar | Padrão de diretor e coordenador | — |
| A3 | Executa depois da aprovação de uma pessoa, caso a caso | Dono | Financeiro, jurídico, dados sensíveis e RH: **no máximo A3** |
| A4 | Executa sozinho dentro de uma lista fechada de ações reversíveis e de baixo risco | Dono, por executor, depois da prova (F6) e de 2 semanas no assistido com números bons | Só executores; desliga sozinho se o erro passar do limite (§5.6) |

## 5. Segurança (pilar)

### 5.1 Isolamento
Toda tabela nova tem `organization_id`, FKs compostas `(id, organization_id)`, RLS e escrita só por RPC `SECURITY DEFINER SET
search_path=''` (`service_*` só para `service_role`). Nenhum agente monta consulta própria: o servidor monta um **pacote
fechado por empresa** (como o cérebro faz hoje). Testes de isolamento novos para cada tabela.

### 5.2 Crachá de cada agente (menor privilégio)
Cada agente tem um escopo fixo, gravado e versionado:
- **dados que pode ler** (só agregados; ou trechos anonimizados; ou dados de um cliente na conversa em andamento, no caso
  do executor);
- **ações permitidas** (lista fechada);
- **com quem pode falar** (o superior, os subordinados diretos e a equipe de apoio).

Diretor e cérebro nunca veem nome, telefone, e-mail ou conversa; RH só agregados (LGPD art. 20). Nenhum agente vê segredos.

### 5.3 Injeção de instrução
Tudo que vem de cliente, documento, site ou outro agente vai dentro de `<dados>` e é tratado como dado. Saídas são JSON
validado (listas fechadas, tamanho máximo, números trocados pelo valor do banco), como no validador do cérebro. Os cenários
de prova incluem tentativas de burla (§6).

### 5.4 LGPD
Minimização (cada agente só o necessário), `redact()` em todo texto que sai para a IA, retenção por tipo de dado, base legal
registrada no processo (§3), aviso ao cliente final quando houver gravação ou análise, direito de exclusão e anonimização (já
existe), sem decisão automatizada sobre pessoas da equipe.

### 5.5 Auditoria e versão
Cada decisão, proposta, mensagem entre agentes e ação de executor fica registrada com: agente, versão do agente, modelo,
hash do pacote, quem aprovou e quando. Mudança de agente gera versão nova; a anterior pode voltar com um clique.

### 5.6 Custo e disjuntores
Franquia mensal por empresa (só a Clubetec muda), orçamento por tarefa entre agentes (chamadas e profundidade máxima 3),
o mesmo pacote não chama a IA duas vezes, **vigia de custo** (avisa gasto fora do normal com o motivo e se vale
desligar; decisão 5 do §11) e **disjuntor**: um executor com erro acima do limite (cenário reprovado,
reclamação, nota baixa, burla detectada) volta sozinho para o assistido e avisa o dono. **Botão de parar:** o dono para um
agente ou todos; a Clubetec para por empresa ou por agente em toda a plataforma.

## 6. Qualidade: prova antes e medição depois

### 6.1 Cenários de teste por agente (evals)
Cada processo e cada executor ganha cenários gerados a partir do Diagnóstico e revisados pelo dono:
- pergunta comum (deve resolver);
- caso de exceção (deve seguir a exceção);
- fora do horário;
- reclamação e cliente irritado (deve seguir o padrão da cultura e passar para quem resolve);
- pedido proibido (desconto, prazo, assunto jurídico ou médico, dados de cartão; deve recusar com educação e oferecer uma pessoa);
- tentativa de burla ("ignore as regras");
- pedido de dado de outro cliente (deve negar).

O Auditor roda os cenários com o agente em modo teste (sem enviar nada a cliente real) e um avaliador confere o resultado.

### 6.2 Regressão
Toda mudança de agente, regra, base ou processo roda de novo os cenários do agente afetado. Se algum obrigatório reprovar,
nada vai ao ar.

### 6.3 Medição contínua
Já existem a avaliação automática, os relatórios e o cérebro. Entram por executor e por processo:
- taxa de resolução sem pessoa;
- passagens para uma pessoa e o motivo;
- notas;
- reclamações;
- **chamados de suporte abertos por causa de configuração** (a meta é cair a cada empresa nova).

O sistema só sugere subir de degrau (§2, F7) com esses números bons.

## 7. A rede: como os agentes conversam

Tabela `agent_tasks`, a "caixa de mensagens" dos agentes:
`id, organization_id, from_agent, to_agent, kind (pedir_informacao|revisar|propor|alertar|escalar|responder), payload jsonb
(validado por tipo), status (aberta|em_andamento|respondida|escalada|expirada), parent_id, depth ≤ 3, budget_calls,
result jsonb, created_at, due_at, done_at`.

**Regras:**
- **Sobe e desce pela hierarquia.** Entre áreas, a conversa passa pelo coordenador ou diretor.
- **Equipe de apoio:** qualquer nível pode pedir a ela.
- **Quando o agente não resolve, escala:** superior → cérebro → dono (sino e e-mail) ou suporte Clubetec (chamado automático, já existe).
- **Pergunta que só o dono sabe responder** vira uma pergunta no Diagnóstico ("Ainda falta saber"), com o porquê. Assim o
  levantamento nunca para de completar.
- **Tarefa sem resposta no prazo expira** e escala. Nada fica em laço: a profundidade máxima e o orçamento travam.
- **Toda tarefa vai para a auditoria** (§5.5).

## 8. Modelo de dados (novo)

| Tabela | Para quê | Pontos de segurança |
|---|---|---|
| `ai_agents` | O organograma: `key, level (cerebro|diretor|coordenador|especialista|executor|apoio), parent_id, area_id, department_id, process_id, papel, cracha jsonb (dados, acoes, fala_com), autonomia A0–A4, status (proposto|ativo|pausado), version` | Escrita só por RPC; o crachá só aceita itens do catálogo da plataforma |
| `agent_versions` | Histórico de cada agente (prompt, crachá, regras) e reversão | Imutável; auditado |
| `processes` | Processo como dado (§3), substitui o texto em `company_profiles.processes` (migração com cópia) | Dados pessoais marcados; base legal |
| `diag_coverage` (ou `steps[key].coverage`) | Cobertura por item do especialista: completo, incompleto, faltando ou "não tem" | Só o servidor grava |
| `agent_tasks` | A rede (§7) | Profundidade e orçamento; expiração |
| `agent_evals` / `agent_eval_runs` | Cenários e resultados (§6) | Modo teste nunca envia a cliente real |

Reaproveita: `improvements` (único ciclo de propostas), `org_areas`, `area_goals`, `brain_runs`, `audit_log`, `notifications`,
`service_requests`, `knowledge_*`, `flows`, `agent_configs`.

## 9. Telas (seguindo o padrão de autoatendimento guiado)
- **Organograma de IA:** árvore com cada agente (cargo + "(IA)" e apelido opcional), status, autonomia, quem aprova e botão Pausar. Clicar mostra o crachá em
  linguagem simples ("vê: números do atendimento; faz: sugere melhorias; fala com: Diretor Comercial").
- **Diagnóstico com cobertura:** barra "Informação completa" por etapa e a lista do que falta, com o porquê.
- **Processos:** passo a passo visual, com quem faz cada passo (pessoa, agente ou fluxo) e a decisão de automação.
- **Prova:** cenários por agente com resultado (passou ou reprovou, e por quê) e "Rodar de novo".
- **Central do cérebro** (já existe): passa a mostrar a rede (tarefas abertas, escaladas, o que cada nível fez).

Cada tela nasce com passo a passo, vídeo e Ajuda (padrão do CLAUDE.md).

## 10. Entrega em fatias (cada uma usável, testada e provada na Clubetec)

| # | Fatia | Resultado para o dono | Tam. |
|---|---|---|---|
| 1 | **Cobertura do Diagnóstico** (grava completo, incompleto, faltando ou "não tem" por item do especialista; barra por etapa; aviso ao aprovar etapa incompleta; portão F1) | Sabe exatamente o que falta e o risco | P |
| 2 | **Revisores de área** (segunda opinião ao aprovar etapa: incoerências entre etapas e lacunas; portão F2) | Diagnóstico sem contradições | M |
| 3 | **Processos como dado + Arquiteto** (formato §3, migração dos atuais, matriz §2.4, aprovação por processo; portão F4) | Processos padronizados, prontos para automatizar | G |
| 4 | **Organograma de IA** (`ai_agents`, `agent_versions`, crachás do catálogo, o cérebro propõe a partir de setores e processos, tela, Pausar; portão F3) | Vê e aprova o time de IA da empresa | G |
| 5 | **Guardião de segurança e LGPD** (revisão obrigatória de propostas, agentes e fluxos antes da prova) | Nada inseguro chega ao teste | M |
| 6 | **Prova** (cenários por processo e executor, modo teste, regressão, tela; portão F6) | Nada vai ao ar sem passar | G |
| 7 | **Degraus de publicação + disjuntor** (sombra → assistido → automático; volta sozinho se errar; botão Parar) | Liga a IA com segurança, aos poucos | M |
| 8 | **A rede** (`agent_tasks`, escalonamento, perguntas voltando ao Diagnóstico, painel no cérebro) | Os agentes se ajudam e só sobe ao dono o necessário | G |
| 9 | **Implantação pelo organograma** (implementador monta por especialista e executor a partir dos processos aprovados) | Implantação quase toda automática | M |
| 10 | **Acabamento e prova final** (guias e vídeos, revisão de segurança completa com o agente revisor, testes de isolamento, Clubetec do zero ponta a ponta, medir chamados) | Pronto para o primeiro cliente | M |

Ordem recomendada: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10.
1 e 2 já ajudam a Clubetec do zero agora; 5, 6 e 7 são as travas de segurança e qualidade antes de qualquer agente novo
atender cliente.

## 11. Decisões do dono (respondidas em 06/10)
1. **Autonomia padrão:** ✅ executores começam em **sombra** (só sugerem) e sobem de degrau só quando o dono liga.
2. **Quem aprova processos:** ✅ o responsável da área também aprova; o dono vê tudo e pode desfazer.
3. **Empresas pequenas (juntar níveis):** 🙋 em análise — explicação abaixo, aguardando o "sim" do dono.
   *O que é:* numa empresa pequena não se criam "caixas vazias". Ex.: uma loja com 3 pessoas e um setor só. Em vez de
   Cérebro → Diretor Comercial (IA) → Coordenador de Vendas (IA) → Especialista em Orçamentos (IA) → Atendente (IA),
   fica Cérebro → Especialista em Orçamentos (IA) → Atendente (IA): o cérebro faz também o papel do diretor e do
   coordenador. *Por quê:* menos passagens entre agentes = menos chance de erro e menos custo de IA; a segurança e as
   regras são as mesmas. *Quando abre:* quando a empresa cresce (novo setor, mais pessoas, mais processos), o cérebro
   propõe abrir o nível que faltava e o dono aprova. O organograma na tela sempre mostra quem faz cada papel.
4. **Cenários obrigatórios:** ✅ os 7 tipos de §6.1 para todo executor (reduzem erro antes de ir ao ar).
5. **Custo:** ✅ não mostrar ao cliente o gasto de cada agente; em vez disso, um **vigia de custo**: se um agente gastar
   muito acima do normal (comparado ao próprio histórico e ao volume de atendimentos), o sistema avisa o dono e a
   Clubetec com o motivo provável (ex.: conversa em laço, documento enorme repetido, pergunta mal configurada) e diz se
   vale desligar ou ajustar. O disjuntor (§5.6) segura o gasto enquanto ninguém decide.
6. **Nomes na tela:** ✅ cargo + "(IA)" (ex.: "Especialista em Orçamentos (IA)"); o cliente pode pôr um **apelido**
   opcional (ex.: "Bia — Especialista em Orçamentos (IA)"); o "(IA)" nunca sai, para ninguém confundir com uma pessoa.
