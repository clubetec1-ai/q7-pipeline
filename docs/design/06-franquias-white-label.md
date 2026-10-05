# 06 — Rede de franquias, white label e implantação como pacote (Fase 3, item 17)

## Objetivo
Vender em volume para redes (franquias, associações, grupos) e para parceiros que revendem com a própria marca,
sem nunca misturar dados entre empresas.

## Modelo
- **Rede** (`networks`): criada pela Clubetec (operador) para uma empresa-**matriz**. Cada unidade continua sendo
  uma empresa separada (dados isolados, RLS como hoje).
- **Unidade** (`network_units`): entra na rede **por consentimento** — o dono da unidade digita um código de
  convite (uso único, 7 dias, guardado só como hash). Pode sair quando quiser; a matriz pode remover.
- **Matriz** (quem tem `org.settings` na empresa-matriz):
  - vê o **painel da rede só com números somados por unidade** (conversas novas, atendimentos finalizados,
    1ª resposta média, nota média, avaliações) — nunca nomes, telefones ou mensagens de clientes (LGPD);
  - publica o **padrão da rede**: etapas do funil, setores, etiquetas, instruções do assistente e as regras
    (regras da IA, tom de voz, políticas, perguntas frequentes) tirados da própria matriz. Cada versão fica
    guardada. Marcada como **obrigatória**, ela é aplicada assim que chega. Fora isso, a unidade vê um
    rascunho e aplica quando quiser. Aplicar só **acrescenta** o que falta (não apaga nada da unidade) e
    troca as instruções do assistente e as regras.
- **White label** (`networks.brand`): nome do produto, logo e cores da rede aparecem para todas as pessoas das
  unidades e da matriz no lugar de "Deixa com a IA". Quem define é a Clubetec (contrato de revenda).
- **Implantação como pacote**: quando a implantação começa, o sistema guarda os números de partida (30 dias
  antes). Depois, o cartão **"Antes × depois"** compara esses números com os 30 dias mais recentes.
  O roteiro da implantação por nicho fica em Primeiros passos (Início).

## Segurança
- Todas as RPCs são `SECURITY DEFINER` e checam o papel: operador, matriz (`org.settings` na matriz) ou dono da
  unidade.
- O painel da rede só devolve números agregados por unidade.
- O padrão leva só configuração, nunca dados de clientes.
- Testes de isolamento 92 e 93: uma unidade não vê outra, nem a matriz, nem outra rede; quem não é da matriz
  não vê o painel; o código vale uma vez só.
