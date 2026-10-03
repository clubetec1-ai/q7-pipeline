# 01 — Visual e acabamento (auditoria + sistema)

Escopo: telas da equipe (Início, Conversas, Chat, Kanban, Funil, Clientes, Configurações, Aparência, Relatórios, Diagnóstico, Fluxos).
Base: código em `src/` + capturas atuais. Todos os contrastes abaixo foram calculados (WCAG 2.x).

---

## 1. Diagnóstico

### 1.1 Cor
| # | Problema | Onde | Por que pesa |
|---|----------|------|--------------|
| C1 | **Botão principal reprova contraste.** `--primary` verde com `--primary-foreground` branco = **2,3:1** (mínimo 4,5). Vale para todo botão, chip ativo, bolha enviada e canal ativo do Chat. | `src/index.css:15-16`; bolhas `src/pages/Conversas.tsx:846-848`, `src/pages/Chat.tsx:141,185`; segmentos `src/pages/Kanban.tsx:357`, `src/components/dashboard/Dashboard.tsx:95` | Texto branco "lavado" sobre verde é a principal razão de as telas parecerem amadoras e cansarem a leitura. |
| C2 | **`text-primary` usado como texto** (links, "Retorno agendado", "Link e destaque") também fica em 2,3:1. | `src/pages/Kanban.tsx:89`, `src/pages/ConfigAparencia.tsx:133` | Não existe token de "primário para texto". |
| C3 | **Cor da empresa quebra o tema escuro.** `OrgTheme` grava `--primary` em `document.documentElement.style`, que vence o bloco `.dark` — a mesma cor e o mesmo texto valem nos dois temas. Cor escura (ex.: `#111827`) some no escuro. | `src/components/OrgTheme.tsx:56-60` | White-label precisa funcionar com qualquer cor nos dois temas. |
| C4 | **Escolha do texto sobre a cor da empresa é imprecisa**: usa média sRGB sem linearizar, limiar 0,6. A prévia da Aparência usa outra regra (`#111`/`#fff`). | `src/components/OrgTheme.tsx:16-17`; `src/pages/ConfigAparencia.tsx:132` | Prévia ≠ resultado; amarelo/lima podem sair com texto branco ilegível. |
| C5 | **`--accent` e `--sidebar-accent` fixos no matiz 169 (verde)**. Hover de botões `outline`/`ghost` fica verde mesmo quando a empresa escolheu vermelho ou azul. | `src/index.css:21-22,35-36,54-55,67-68` | Mistura a cor da Clubetec com a do cliente. |
| C6 | **`--secondary` = cinza 55% com texto branco (3,35:1)** — é o fundo dos selos "Na fila" / "Em atendimento" em 10px. | `src/index.css:17-18`; `src/pages/Conversas.tsx:623`, `src/pages/conversas/TicketBar.tsx:122` | Selo de status quase ilegível; todos os status não-IA ficam iguais (cinza). |
| C7 | **Três paletas diferentes para a mesma função** (setor/etiqueta/número/etapa): `ColorTag.PALETTE`, `Numeros.COLORS` (`#F5A623`, `#2EB67D`, `#E8618C`) e defaults do Kanban. | `src/components/ColorTag.tsx:5`, `src/pages/Numeros.tsx:42`, `src/pages/Kanban.tsx:60-62` | O mesmo "laranja" tem 2 tons; a cor deixa de ser pista. |
| C8 | **Etiquetas com texto na própria cor sobre fundo 15%**: âmbar 1,9:1, ciano 2,1:1, verde 2,2:1, azul 2,7:1 — todas reprovam. | `src/components/ColorTag.tsx:28-29`; repetido em `src/pages/EtiquetasGrupos.tsx:118,141` | É o elemento de cor mais visto (lista de conversas, Kanban, Clientes). |
| C9 | **Arco-íris decorativo**: 16 cards de Configurações com ícone em 9 cores hex diferentes; 5 KPIs do Início com 5 cores; gráfico IA em `#8B5CF6` fixo. | `src/pages/Configuracoes.tsx:34-72,106`; `src/components/dashboard/Dashboard.tsx:101-107,129,133` | Cor sem significado compete com a cor que significa algo (status, setor). Contraria "cor como pista". |
| C10 | **149 classes de paleta crua** (`text-red-600`, `bg-amber-50`, `bg-emerald-500`…) contra 38 variantes `dark:`. Progresso é verde-esmeralda numa tela e primário na outra. | Maiores: `src/pages/plataforma/PlatformAIPanel.tsx`, `src/pages/Configuracoes.tsx:14-15,91`, `src/pages/Inicio.tsx:110,118`, `src/components/OrgHealth.tsx:24,28,37`, `src/components/NumberHealthBanner.tsx:26-27`, `src/components/AppHeader.tsx:43` | Sem tokens semânticos, cada tela inventa "sucesso/alerta"; o escuro fica remendado. |
| C11 | Hex fixo que quebra no escuro: xadrez `#eee/#fff` atrás do logo; fallback `#94A3B8` espalhado em 8 arquivos. | `src/pages/ConfigAparencia.tsx:108`; `src/pages/Conversas.tsx:232`, `src/pages/Setores.tsx:113`, `src/components/dashboard/Dashboard.tsx:71` | — |
| C12 | `background` e `card` são ambos branco puro: cards só se separam por borda clara (telas "chapadas" nas capturas de Início, Funil, Aparência). | `src/index.css:9,11` | Falta hierarquia de superfície. |

### 1.2 Tipografia
| # | Problema | Onde |
|---|----------|------|
| T1 | **Fonte errada**: o app inteiro usa *Space Grotesk*; Inter (fonte da marca) nem é carregada. Montserrat só no logo. | `index.html:8`, `src/index.css:81`, `tailwind.config.ts:18` |
| T2 | **45 tamanhos arbitrários** `text-[9px]`(2), `text-[10px]`(23), `text-[11px]`(19). Público pouco técnico, muitas vezes em notebook 1366px: 10px é ilegível. | Concentrados em `src/pages/Conversas.tsx:211-231,852,857`, `src/pages/Chat.tsx:143,186,198`, `src/pages/conversas/TicketBar.tsx:122-125`, `src/components/ColorTag.tsx:28`, `src/components/dashboard/Dashboard.tsx:26,30,119` |
| T3 | Título de página em 5 variações (`text-2xl font-semibold` ± ícone, `text-xl`, `font-bold`). Ícone dentro do H1 em 18 telas. | Ex.: `src/pages/Clientes.tsx:72`, `src/pages/Diagnostico.tsx:465,642`, `src/pages/Inicio.tsx:69` |
| T4 | `CardTitle` do shadcn é `text-2xl` — grande demais para título de card; por isso quase ninguém usa o `Card` (só 2 arquivos) e cada tela faz o seu. | `src/components/ui/card.tsx:19` |
| T5 | Rótulo de grupo em `uppercase tracking-wide` só em Configurações. | `src/pages/Configuracoes.tsx:101` |

### 1.3 Layout, espaçamento e componentes
| # | Problema | Onde |
|---|----------|------|
| L1 | **Larguras de página: 7 valores** (`max-w-2xl` a `max-w-7xl`) e `space-y-4/6/8` sem regra. | `<main>` de 25 telas |
| L2 | **Card em 4 receitas**: `Card` (rounded-lg + shadow), `rounded-xl border bg-card p-4` (13×), `p-5` (7×), `p-6`; Clientes sem `bg-card`. Destaque com `border-2 border-primary` (borda grossa, amador). | `src/pages/Clientes.tsx:78`, `src/pages/Inicio.tsx:76`, `src/pages/Funil.tsx:90` |
| L3 | Hover de card com `-translate-y-0.5 hover:shadow-md` (efeito "pulo") em atalhos e Configurações. | `src/pages/Inicio.tsx:144`, `src/pages/Configuracoes.tsx:105` |
| L4 | Kanban: borda colorida com raio inline `8px` sobre card de `12px` → cantos desencontrados; sem título de página; colunas vazias sem nenhuma pista; etapas do funil instalado entram depois de "Fechado" (Fechado aparece antes de Qualificado). | `src/pages/Kanban.tsx:111-112`; captura do Kanban |
| L5 | Conversas: **3 barras de ação empilhadas** (etapa, Ficha, Não é atendimento, selo, protocolo, Assumir, Transferir, Devolver à IA, Finalizar / etiquetas / follow-up) — ~10 controles na mesma altura; botões em `h-7`, `h-8` e `h-9`. Selo "Na fila" quebra em 2 linhas (sem `whitespace-nowrap`). | `src/pages/Conversas.tsx:657-735`, `src/pages/conversas/TicketBar.tsx:121-155` |
| L6 | Conversas: mensagem "Nenhuma conversa ainda" aparece **acima** da busca; "Selecione uma conversa" é texto solto no centro. | `src/pages/Conversas.tsx:578-586,641` |
| L7 | Estados vazios sem padrão: texto cinza no canto (Chat "Nenhuma mensagem ainda."), linha dentro da lista (Clientes), caixa tracejada (Kanban). | `src/pages/Chat.tsx:180`, `src/pages/Clientes.tsx:79`, `src/pages/Kanban.tsx:385` |
| L8 | Clientes: botão "Ver ficha" + ícone repetidos em até 200 linhas, embora a linha inteira já abra a ficha. | `src/pages/Clientes.tsx:89-90` |
| L9 | Tabelas: 5 telas com `<table>` cru e cabeçalho `font-normal`; 6 com `ui/table`. | `src/pages/Funil.tsx:119-123`, `src/pages/Relatorios.tsx:184-186`, `Melhorias`, `Diagnostico`, `PlatformAIPanel` |
| L10 | `<select>` nativo em 24 arquivos ao lado do `Select` do shadcn — na mesma tela de Conversas há os dois. | `src/pages/Conversas.tsx:589` vs `:659`; `src/components/MainNav.tsx:88,110` |
| L11 | Emojis como ícone (👋 🤝 🗑 🔎 ✉, 17 ocorrências) misturados com Lucide; no Windows viram outro desenho. | `src/pages/Inicio.tsx:69`, `src/pages/Conversas.tsx:211,594,858,864` |

### 1.4 Menu e ícones
| # | Problema | Onde |
|---|----------|------|
| N1 | **Menu vira só ícones abaixo de 1536px** (`hidden 2xl:inline`) — em notebook 1366/1440 o usuário vê 9 ícones sem nome. Grupos só mostram nome a partir de 1280px. | `src/components/MainNav.tsx:72,117,123` |
| N2 | Ícone em todo item de menu + ícone em todo H1 + ícone em todo card de Configurações + ícone em todo KPI = ruído; contraria "poucos ícones". | `MainNav.tsx:73`, H1s, `Configuracoes.tsx:106`, `Dashboard.tsx:40` |
| N3 | Item ativo = só `bg-muted` (cinza 96% sobre branco) — quase invisível. | `src/components/MainNav.tsx:21` |

### 1.5 Lixo herdado
`src/index.css:5` (comentário "Q7 Educação"), `:85-101` (`glass-card`, `gradient-text`, `btn-gradient` — 0 usos), `tailwind.config.ts:8-15` (`container` sem uso), `--brand-secondary` sem valor padrão (cai no primário em `AppHeader.tsx:30`).

---

## 2. Sistema de cores

### 2.1 Regras
1. **Cor da empresa (`--primary`) só para ação e seleção**: botão principal, item ativo, foco, progresso. Nunca para status nem decoração.
2. **Status usa cores semânticas fixas**; **setor/etiqueta usa a paleta de 8**. Os três sistemas nunca se substituem.
3. Texto ≥ **4,5:1**; ícones, bordas de input, barras e bolinhas ≥ **3:1**. Texto nunca menor que 12px.
4. Nenhum hex nem `red-500`/`amber-50` em `className`: só tokens. (Exceção: `Logo.tsx`, que é a marca.)
5. Tons suaves (`*-soft`) são **fundo**; texto sobre eles usa `*-text`.

### 2.2 Tokens base (`src/index.css`)
```css
:root {
  --background: 210 20% 98%;      /* página levemente off-white */
  --foreground: 217 33% 14%;      /* 15,5:1 */
  --card: 0 0% 100%;  --card-foreground: 217 33% 14%;
  --popover: 0 0% 100%; --popover-foreground: 217 33% 14%;
  --muted: 210 20% 95%; --muted-foreground: 215 14% 40%;   /* 5,4–5,8:1 */
  --secondary: 210 20% 94%; --secondary-foreground: 217 33% 20%;  /* neutro, não cinza-escuro */
  --accent: 210 20% 95%; --accent-foreground: 217 33% 14%;        /* neutro: segue qualquer marca */
  --border: 214 20% 90%;          /* decorativa */
  --input: 215 14% 60%;           /* borda de campo: 3:1 */
  --ring: var(--primary);

  /* Marca (substituídos pelo OrgTheme) */
  --primary: 169 70% 45%;               /* #22C1A4 */
  --primary-foreground: 217 69% 14%;    /* marinho #0B1E3D sobre verde = 7,45:1 */
  --primary-text: 170 45% 31%;          /* primário legível como texto/link = 5,4:1 */
  --brand-secondary: 203 55% 29%;       /* #215371 */

  /* Semânticas: sólido (ícone/bolinha/barra) · soft (fundo) · text (texto sobre soft ou card) */
  --success: 142 72% 29%; --success-soft: 138 50% 94%; --success-text: 142 64% 24%;
  --warning: 32 95% 44%;  --warning-soft: 40 90% 93%;  --warning-text: 26 90% 30%;
  --danger: 0 72% 51%;    --danger-soft: 0 86% 96%;    --danger-text: 0 70% 38%;
  --info: 221 83% 53%;    --info-soft: 214 95% 95%;    --info-text: 224 70% 40%;
  --destructive: var(--danger); --destructive-foreground: 0 0% 100%;

  /* Status do atendimento */
  --status-ia: 262 83% 58%;   --status-ia-soft: 260 90% 96%; --status-ia-text: 263 60% 42%;
  /* fila = warning · em atendimento = info · pedindo ajuda = danger · finalizado = muted */
  --radius: 0.75rem;
}
.dark {
  --background: 220 18% 8%;  --foreground: 210 20% 96%;   /* 17:1 */
  --card: 220 16% 11%; --card-foreground: 210 20% 96%;
  --popover: 220 16% 11%; --popover-foreground: 210 20% 96%;
  --muted: 220 14% 16%; --muted-foreground: 218 12% 68%;  /* 7,5:1 */
  --secondary: 220 14% 18%; --secondary-foreground: 210 20% 96%;
  --accent: 220 14% 18%; --accent-foreground: 210 20% 96%;
  --border: 220 13% 20%; --input: 218 12% 42%;            /* 3:1 */
  --primary: 169 65% 48%; --primary-foreground: 217 69% 14%;  /* 8:1 */
  --primary-text: 166 55% 62%;                             /* 9,6:1 */
  --brand-secondary: 203 45% 45%;
  --success: 142 69% 58%; --success-soft: 142 40% 14%; --success-text: 142 60% 70%;
  --warning: 43 96% 56%;  --warning-soft: 35 60% 14%;  --warning-text: 40 90% 70%;
  --danger: 0 91% 71%;    --danger-soft: 0 50% 16%;    --danger-text: 0 90% 78%;
  --info: 213 94% 68%;    --info-soft: 220 50% 17%;    --info-text: 213 90% 78%;
  --destructive-foreground: 220 18% 8%;
  --status-ia: 258 90% 76%; --status-ia-soft: 260 40% 18%; --status-ia-text: 258 90% 80%;
}
```
Todos os pares *-text/*-soft ficaram entre 6,3:1 e 9,2:1. Remover os tokens `--sidebar-*` se o `ui/sidebar` não for usado.

`tailwind.config.ts` → `colors`: acrescentar
```ts
"primary-text": "hsl(var(--primary-text))",
"brand-secondary": "hsl(var(--brand-secondary))",
success: { DEFAULT: "hsl(var(--success))", soft: "hsl(var(--success-soft))", text: "hsl(var(--success-text))" },
warning: { /* idem */ }, danger: { /* idem */ }, info: { /* idem */ },
"status-ia": { DEFAULT: "hsl(var(--status-ia))", soft: "hsl(var(--status-ia-soft))", text: "hsl(var(--status-ia-text))" },
```
Uso: `text-primary-text`, `bg-success-soft text-success-text`, `bg-warning`, etc.

### 2.3 Cor da empresa (OrgTheme) — funciona com qualquer cor
Trocar a gravação inline por um `<style id="org-theme">` com `:root{…}` e `.dark{…}` e calcular com **contraste WCAG real** (luminância linearizada):
1. `--primary-foreground` = branco ou marinho `#0B1E3D`, o que der **maior** contraste com a cor.
2. `--primary-text` = mesma matiz, baixando L em passos de 2% até ≥ 4,5:1 sobre `--background` claro; no `.dark`, subindo L até ≥ 4,5:1 sobre `--card` escuro.
3. `--primary` no `.dark` = se < 3:1 sobre o fundo escuro, sobe L até 3:1.
4. Exportar essa função e usá-la também na prévia de `ConfigAparencia.tsx` (fim do `#111`). Na Aparência, se o melhor contraste do botão ficar < 4,5:1 (ex.: laranja médio), mostrar aviso "texto do botão pode ficar difícil de ler".

Testado: `#FACC15` → marinho 10,8:1; `#2563EB` → branco 5,2:1; `#E11D48` → branco 4,7:1; `#111827` → branco 17,7:1 (e clareado no escuro).

### 2.4 Paleta fixa de setores/etiquetas (8 + neutro)
Matizes espaçados ~45°, saturação média, todos ≥ 3:1 como bolinha/barra **nos dois temas**. Por serem fixos e de identificação (nunca de ação), convivem com qualquer cor principal.

| # | Nome | Hex (salvo no banco) | Sólido vs branco | Sólido vs card escuro | Pílula claro | Pílula escuro |
|---|------|---------------------|------|------|------|------|
| 1 | Azul | `#2563EB` | 5,2 | 3,4 | 7,5 | 6,0 |
| 2 | Ciano | `#0891B2` | 3,7 | 4,7 | 6,4 | 6,5 |
| 3 | Verde | `#16A34A` | 3,3 | 5,3 | 6,0 | 6,8 |
| 4 | Lima | `#65A30D` | 3,1 | 5,6 | 5,8 | 6,9 |
| 5 | Âmbar | `#D97706` | 3,2 | 5,4 | 5,9 | 6,8 |
| 6 | Vermelho | `#E11D48` | 4,7 | 3,7 | 7,1 | 6,1 |
| 7 | Magenta | `#C026D3` | 4,7 | 3,7 | 7,2 | 6,1 |
| 8 | Violeta | `#7C3AED` | 5,7 | 3,0 | 7,8 | 5,8 |
| — | Cinza (sem cor / fallback) | `#64748B` | 4,8 | 3,6 | 7,2 | 6,1 |

**Pílula legível com qualquer hex** (inclusive cores antigas já salvas), sem migrar dados — em `src/index.css`:
```css
@layer components {
  .tag-pill {
    background: color-mix(in oklab, var(--c) 14%, hsl(var(--card)));
    color: color-mix(in oklab, var(--c) 55%, hsl(var(--foreground)));
  }
  .dark .tag-pill { background: color-mix(in oklab, var(--c) 22%, hsl(var(--card))); }
}
```
Uso: `<span className="tag-pill …" style={{ "--c": hex } as React.CSSProperties}>`. Os números "Pílula" da tabela são desta fórmula.
Mapa de conversão (opcional, nova migration): `#3FB8BE→#0891B2`, `#6C8EF5→#2563EB`, `#F59E0B/#F5A623→#D97706`, `#EF4444→#E11D48`, `#EC4899/#E8618C→#C026D3`, `#10B981/#2EB67D→#16A34A`, `#8B5CF6→#7C3AED`.

### 2.5 Status do atendimento
| Status | Rótulo | Fundo | Texto | Bolinha |
|--------|--------|-------|-------|---------|
| `bot` | IA | `bg-status-ia-soft` | `text-status-ia-text` | `bg-status-ia` |
| `queued` | Na fila | `bg-warning-soft` | `text-warning-text` | `bg-warning` |
| `open` | Em atendimento | `bg-info-soft` | `text-info-text` | `bg-info` |
| pedindo ajuda | Pedindo ajuda | `bg-danger-soft` | `text-danger-text` | `bg-danger` |
| `closed` | Finalizado | `bg-muted` | `text-muted-foreground` | `bg-muted-foreground` |

Status = `rounded-md` com bolinha; etiqueta/setor = `rounded-full` sem bolinha de status. A forma diferencia mesmo quando as cores se parecem. O violeta da IA também é o de "IA" nos gráficos (troca o `#8B5CF6` do Dashboard).

---

## 3. Tipografia e espaçamento

### 3.1 Fontes
- `index.html`: carregar `Inter:wght@400;500;600;700` e `Montserrat:ital,wght@1,800;1,900`; remover Space Grotesk.
- `tailwind.config.ts`: `sans: ["Inter", "system-ui", "sans-serif"]`, `display: ["Montserrat", "Inter", "sans-serif"]`.
- `src/index.css`: `.font-brand { @apply font-display font-black italic tracking-tight; }` (classe própria, para não colidir com o utilitário `font-display`) e `body { font-feature-settings: "cv11", "ss01"; }` (números e "1/l" mais legíveis no Inter).

**Montserrat Black Italic só em: logo, H1 de página, número grande de KPI e títulos de login/boas-vindas.** Todo o resto é Inter. Nunca Montserrat em botão, tabela, rótulo ou texto corrido.

### 3.2 Escala única (só classes padrão do Tailwind)
| Papel | Classe |
|-------|--------|
| H1 da página | `font-brand text-2xl leading-tight` (24px) |
| Número de KPI | `font-brand text-3xl leading-none tabular-nums` |
| H2 de seção | `text-base font-semibold` (16px) |
| Título de card / H3 | `text-sm font-semibold` |
| Texto padrão | `text-sm` (14px) |
| Apoio, metadado, rótulo de tabela, selo | `text-xs` (12px) — **mínimo absoluto** |

Proibido: `text-[9px]`, `text-[10px]`, `text-[11px]`, `font-bold` em título (usar `font-semibold`), ícone dentro de H1, `uppercase`.

### 3.3 Espaçamento (grade de 4px)
| Uso | Classe |
|-----|--------|
| Página | `px-4 py-6 sm:px-6` |
| Entre seções | `space-y-6` |
| Dentro do card | `p-5`, blocos internos `space-y-3` |
| Campos de formulário | `space-y-4`; rótulo→campo `space-y-1.5` |
| Itens em linha / barra | `gap-2` |
| Larguras | **Formulário**: `max-w-3xl` · **Lista/relatório/Início/Configurações**: `max-w-6xl` · **Área de trabalho** (Conversas, Kanban, Chat, Fluxos): largura total |
| Altura de controles | `h-9` em barras e cards (Button `size="sm"`, Input, Select); `h-10` só em formulários; `h-8` só dentro de linhas de lista. Nada de `h-7`. |
| Raio | card/painel `rounded-xl`; botão/campo `rounded-md`; pílula `rounded-full` |

---

## 4. Padrões de componente (classes exatas)

Criar em `src/components/layout/` e usar em todas as telas.

### 4.1 Cabeçalho de página — `PageHeader`
```tsx
<div className="flex flex-wrap items-end justify-between gap-3">
  <div className="min-w-0 space-y-1">
    {back && <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />{back.label}</Link>}
    <h1 className="font-brand text-2xl leading-tight text-foreground">{title}</h1>
    {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
  </div>
  {actions && <div className="flex items-center gap-2">{actions}</div>}
</div>
```
Página: `<main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 sm:px-6">`.

### 4.2 Card — ajustar `src/components/ui/card.tsx`
- `Card`: `rounded-xl border bg-card text-card-foreground shadow-sm`
- `CardHeader`: `flex flex-row items-center justify-between gap-3 space-y-0 p-5 pb-0`
- `CardTitle`: `text-sm font-semibold leading-tight` (hoje `text-2xl`)
- `CardDescription`: `text-xs text-muted-foreground`
- `CardContent`: `p-5` · `CardFooter`: `flex items-center gap-2 border-t px-5 py-3`
- **Card clicável**: `+ transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` (sem `translate`, sem `shadow-md`).
- **Card de destaque** (próximo passo, instalar funil): `border-primary/40 bg-primary/5` (troca `border-2 border-primary`).
- Ícone de card, quando houver: `grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground` — **monocromático**.

### 4.3 Tabela
```tsx
<div className="overflow-hidden rounded-xl border bg-card">
  <Table>
    <TableHeader className="bg-muted/50">
      <TableRow className="hover:bg-transparent">
        <TableHead className="h-10 px-4 text-xs font-medium text-muted-foreground">Nome</TableHead>
        <TableHead className="h-10 px-4 text-right text-xs font-medium text-muted-foreground">Contatos</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow className="group cursor-pointer hover:bg-muted/40" onClick={…}>
        <TableCell className="px-4 py-3 text-sm"><p className="font-medium">Nome</p><p className="text-xs text-muted-foreground">telefone · e-mail</p></TableCell>
        <TableCell className="px-4 py-3 text-right text-sm tabular-nums">14</TableCell>
        <TableCell className="w-px whitespace-nowrap px-4 py-3 text-right">
          <div className="flex justify-end gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">{/* ações ghost size="icon" */}</div>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</div>
```
Linha inteira clicável; ações só no hover (sempre visíveis no celular).

### 4.4 Estado vazio — `EmptyState`
```tsx
<div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-12 text-center">
  <div className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground"><Icon className="h-6 w-6" /></div>
  <div className="space-y-1">
    <p className="text-base font-semibold">{title}</p>
    <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
  </div>
  {action}
</div>
```
Variante `inline` (dentro de painéis: Conversas, Chat, coluna do Kanban): sem `border`/`bg`, `py-8`. Coluna vazia do Kanban: `rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground` "Arraste um card para cá".
Texto sempre diz **o que fazer**: "Nenhuma conversa ainda — conecte um número em Configurações → WhatsApp" + botão.

### 4.5 Selo de status — `StatusBadge`
```tsx
<span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium bg-warning-soft text-warning-text">
  <span className="h-1.5 w-1.5 rounded-full bg-warning" />Na fila
</span>
```
Mapa de classes = tabela 2.5. Etiqueta/setor (`ColorPill`): `tag-pill inline-flex max-w-[10rem] shrink-0 items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-medium`.

### 4.6 Barra de filtros — `FilterBar`
```tsx
<div className="flex flex-wrap items-center gap-2">
  <div className="relative min-w-[14rem] flex-1 sm:flex-none sm:w-72">
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <Input className="h-9 pl-9" placeholder="Buscar nome, telefone ou e-mail" />
  </div>
  {/* Segmentado (Todos/WhatsApp/E-mail, 7/30 dias, Meus/Fila/IA/Todos) */}
  <div role="group" className="inline-flex h-9 items-center rounded-lg bg-muted p-1">
    <button className="h-7 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[active=true]:bg-card data-[active=true]:text-foreground data-[active=true]:shadow-sm" data-active>Todos</button>
  </div>
  <Select>{/* SelectTrigger className="h-9 w-auto min-w-[10rem]" */}</Select>
  <span className="ml-auto text-xs tabular-nums text-muted-foreground">14 contatos</span>
</div>
```
Segmentado ativo é **neutro** (card branco sobre cinza), não `bg-primary` — menos cor gasta, funciona com qualquer marca.

### 4.7 Menu do topo (`MainNav`/`AppHeader`)
- Cabeçalho: `sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4` + faixa `border-t-[3px] border-t-brand-secondary`.
- Item: `relative inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground`
- Ativo: `text-foreground after:absolute after:inset-x-3 after:-bottom-[10px] after:h-0.5 after:rounded-full after:bg-primary`
- **Sem ícone no desktop; rótulo sempre visível a partir de `lg`**. Ícones ficam só no menu ☰ do celular.

### 4.8 Bolhas de mensagem (Conversas e Chat)
- Painel: `bg-muted/40`
- Recebida: `rounded-2xl rounded-bl-md border bg-card px-3 py-2 text-sm`
- Enviada por pessoa: `ml-auto rounded-2xl rounded-br-md bg-primary/10 px-3 py-2 text-sm text-foreground ring-1 ring-inset ring-primary/20`
- Enviada pela IA: igual, com `bg-status-ia-soft ring-status-ia/20` e rótulo `text-xs font-medium text-status-ia-text` "IA"
- Metadado (hora, autor, status de entrega): `text-xs text-muted-foreground`
Assim o atendente vê de relance **quem respondeu** (IA x pessoa), e o texto nunca fica sobre a cor cheia da empresa.

---

## 5. Mudanças priorizadas

Esforço: **P** ≤ 2 h · **M** ≤ 1 dia · **G** > 1 dia.

### P1 — maior impacto visual, menor esforço
| # | Mudança | Arquivos | Esf. |
|---|---------|----------|------|
| P1.1 | **Contraste da cor principal**: tokens da seção 2.2 (`--primary-foreground` marinho, `--primary-text`, `--accent`/`--secondary` neutros, `--brand-secondary` padrão); OrgTheme com contraste WCAG real e bloco `.dark` próprio; prévia da Aparência usa a mesma função; `text-primary` em texto → `text-primary-text`. | `src/index.css`, `tailwind.config.ts`, `src/components/OrgTheme.tsx`, `src/pages/ConfigAparencia.tsx`, `src/pages/Kanban.tsx:89` | P |
| P1.2 | **Tipografia da marca + mínimo 12px**: Inter + Montserrat (display), fim do Space Grotesk; trocar as 45 ocorrências `text-[9/10/11px]` por `text-xs`; `CardTitle` para `text-sm font-semibold`. | `index.html`, `src/index.css`, `tailwind.config.ts`, `src/components/ui/card.tsx`, os 15 arquivos da busca `text-\[1?[0-9]px\]` | P |
| P1.3 | **Superfícies e tokens semânticos**: `--background` off-white + card branco, cabeçalho `bg-card`; criar `success/warning/danger/info` (+ `soft`/`text`) e trocar as cores cruas mais visíveis (Início, Saúde do sistema, banner de número, Configurações). | `src/index.css`, `tailwind.config.ts`, `src/pages/Inicio.tsx:110,118`, `src/components/OrgHealth.tsx:24-37`, `src/components/NumberHealthBanner.tsx:26-27`, `src/pages/Configuracoes.tsx:13-17,91` | P |
| P1.4 | **Paleta única + pílulas e status legíveis**: `PALETTE` de 8 da seção 2.4 como fonte única (Números e Kanban importam dela), `.tag-pill` com `color-mix`, `StatusBadge` com as cores da seção 2.5 e `whitespace-nowrap`. | `src/components/ColorTag.tsx`, `src/pages/Numeros.tsx:42`, `src/pages/Kanban.tsx:60-62`, `src/pages/EtiquetasGrupos.tsx:118-141`, `src/pages/Conversas.tsx:211,623`, `src/pages/conversas/TicketBar.tsx:122`, `src/pages/conversas/useTickets.ts:17` | P |
| P1.5 | **Menu legível e sem ícones**: rótulos visíveis desde `lg`, sem ícones no desktop, ativo com sublinhado primário; ícones fora dos H1. | `src/components/MainNav.tsx:20-22,72-73,117-123`, `src/components/AppHeader.tsx:29-30`, H1 das 18 telas | P |

### P2 — padronização das telas
| # | Mudança | Arquivos | Esf. |
|---|---------|----------|------|
| P2.1 | Criar `PageHeader`, `EmptyState`, `FilterBar`, `StatusBadge` (seção 4) e aplicar nas telas principais; 3 larguras de página. | novos em `src/components/layout/`; `Inicio`, `Clientes`, `Funil`, `Relatorios`, `Configuracoes`, `ConfigAparencia`, `Diagnostico`, `Kanban`, `Chat` | M |
| P2.2 | Conversas: uma barra de ação (Assumir/Finalizar visíveis; Transferir, Devolver à IA, Enviar protocolo, Não é atendimento, Cobrança num menu "Mais"); etapa + etiquetas + follow-up numa segunda linha discreta; bolhas da seção 4.8; busca acima do vazio; vazio central com ação. | `src/pages/Conversas.tsx:578-735,841-875`, `src/pages/conversas/TicketBar.tsx`, `src/pages/Chat.tsx:141-198` | M |
| P2.3 | Cards sem arco-íris: ícones monocromáticos em Configurações e KPIs; a cor só no status ("Configurado/Pendente") e na variação do KPI; KPI com número em `font-brand`; segmentados neutros. | `src/pages/Configuracoes.tsx:34-72,104-117`, `src/components/dashboard/Dashboard.tsx:36-48,93-107,129-133`, `src/pages/Inicio.tsx:142-148` | P |
| P2.4 | Kanban: `PageHeader` + `FilterBar`; borda da etapa com `rounded-t-xl` em vez de raio inline 8px; coluna vazia com "Arraste um card para cá"; card mostra etiquetas (`tag-pill`) e canal. | `src/pages/Kanban.tsx:78-140,343-378` | M |
| P2.5 | Clientes como tabela (seção 4.3): linha abre a ficha; "Ver ficha" sai; ações no hover. | `src/pages/Clientes.tsx:78-94` | P |
| P2.6 | Trocar as 149 classes de paleta crua por tokens semânticos (garante o tema escuro). | `PlatformAIPanel`, `RamaisPanel`, `Setores`, `Melhorias`, `Agente`, `Supervisor`, `Avaliacoes`, `PhoneWidget`, `NvoipCard` e demais da busca `(bg|text|border)-(red|amber|emerald|…)-\d` | M |

### P3 — acabamento
| # | Mudança | Arquivos | Esf. |
|---|---------|----------|------|
| P3.1 | `<select>` nativo → `ui/select` (24 arquivos). | `MainNav.tsx:88,110`, `Conversas.tsx:589`, … | G |
| P3.2 | `<table>` cru → `ui/table` no padrão 4.3. | `Funil.tsx:119`, `Relatorios.tsx:184`, `Melhorias`, `Diagnostico`, `PlatformAIPanel` | M |
| P3.3 | Emojis → ícone Lucide ou nada (17). | `Inicio.tsx:69`, `Conversas.tsx:211,594,858,864`, … | P |
| P3.4 | Fundo xadrez do logo e fallbacks `#94A3B8` por tokens (`bg-muted`, cinza da paleta). | `ConfigAparencia.tsx:108`, `Conversas.tsx:232`, `Setores.tsx:113`, `Dashboard.tsx:71`, `ContactMarksBar.tsx:34,46`, `ContactSheet.tsx:257` | P |
| P3.5 | Remover CSS morto (`glass-card`, `gradient-text`, `btn-gradient`, comentário Q7, `container`, `--sidebar-*` se sem uso). | `src/index.css:5,85-101`, `tailwind.config.ts:8-15` | P |
| P3.6 | Migration opcional normalizando cores antigas para a paleta nova (mapa da seção 2.4). | nova migration em `supabase/migrations/` | P |
| P3.7 | Trava contra regressão: `npm run lint` (regra `no-restricted-syntax`) ou script reprova `#[0-9a-f]{6}` e `text-[Npx]` em `className` fora de `Logo.tsx`/`ColorTag.tsx`. | `eslint.config.js` | P |
| P3.8 | Ordem das etapas do funil instalado (Fechado não pode ficar antes de Qualificado). | instalador do funil (`Funil.tsx` / RPC) | P |

**Ordem sugerida:** P1.1 → P1.2 → P1.3 → P1.4 → P1.5 (≈1 dia no total, muda a cara de todas as telas), depois P2.1 + P2.2 (as telas mais usadas).
