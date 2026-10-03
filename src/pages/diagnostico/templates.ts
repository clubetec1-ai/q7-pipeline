/**
 * Modelos por tipo de empresa: exemplos prontos para cada etapa do Diagnóstico.
 * O dono escolhe o modelo, clica em "Usar exemplo" e só corrige o que for diferente.
 * O primeiro é o da própria Clubetec (vende e implanta software + suporte técnico);
 * depois, nichos de ticket maior (ex.: cartório), que rendem implantação com mais valor.
 */
export interface NicheTemplate {
  key: string;
  label: string;
  /** Texto de exemplo por etapa (chave da etapa). */
  steps: Record<string, string>;
  /** Setores sugeridos para este tipo de empresa. */
  sectors: string[];
  /** Exemplo de processos por setor (nome exato do setor). */
  processes: Record<string, string>;
}

export const TEMPLATES: NicheTemplate[] = [
  {
    key: "software",
    label: "Software e suporte técnico (SaaS, TI, implantação)",
    steps: {
      empresa:
`A empresa vende e implanta um sistema (software por assinatura) para pequenas e médias empresas e presta suporte técnico.
Atendimento: WhatsApp e e-mail, de segunda a sexta, das 8h às 18h; sábado das 8h às 12h só para urgências de clientes ativos.
Produtos: plano Essencial (atendimento no WhatsApp), Profissional (com agentes de IA e automações) e Completo (com telefonia, campanhas e relatórios avançados). Implantação guiada cobrada à parte. Suporte técnico avulso por hora para quem não é assinante.
Preços: mensalidade por usuário + pacote de uso de IA; orçamento de implantação depois do diagnóstico.
Políticas: teste grátis de 7 dias; cancelamento sem multa com 30 dias de aviso; reembolso proporcional só no primeiro mês; suporte incluído no plano pelo WhatsApp e e-mail.
Dúvidas frequentes: "funciona no meu WhatsApp atual?", "precisa instalar alguma coisa?", "a IA responde sozinha?", "meus dados ficam seguros (LGPD)?", "quanto tempo para começar?"`,
      clientes:
`Quem compra: donos e gestores de pequenas empresas (5 a 50 funcionários) que atendem muito pelo WhatsApp — comércio, serviços, clínicas, oficinas, escritórios.
Como chegam: indicação de clientes, Instagram, Google, parceiros e agências.
O que perguntam antes de comprar: preço, se a IA realmente atende, se dá para vários atendentes no mesmo número, se integra com o sistema que já usam, quanto tempo leva para implantar.
Objeções: "é caro", "já uso outro CRM", "tenho medo da IA responder errado", "minha equipe não vai saber usar", "e se o WhatsApp for bloqueado?".
Etapas até fechar: 1) primeiro contato → 2) diagnóstico gratuito → 3) demonstração com o plano da empresa → 4) proposta → 5) teste de 7 dias → 6) fechamento e implantação → 7) acompanhamento no 1º mês → 8) renovação e novos módulos.`,
      marca:
`Cores: Azul-petróleo #3FB8BE (principal), Grafite #1F2937, Branco.
Tom de voz: próximo e confiável, sem termos técnicos; trata por "você"; frases curtas; emoji com moderação (no máximo um por mensagem); sempre mostra o próximo passo.
Usa: "vamos resolver juntos", "em poucos minutos", "passo a passo".
Evita: jargão técnico (API, servidor) sem explicar, promessas de prazo que dependem de terceiros, "infelizmente não podemos".
Exemplo: "Oi, Maria! Vi que o seu número desconectou. Leva 1 minuto: abra o WhatsApp no celular e leia o QR que acabei de enviar. Qualquer coisa, estou aqui 🙂"`,
      cultura:
`Missão: fazer pequenas empresas atenderem melhor e venderem mais com tecnologia simples.
Visão: ser a principal plataforma de atendimento inteligente para pequenas empresas do Brasil.
Valores: simplicidade, resolver de verdade, segurança e privacidade dos dados, aprender com cada cliente.`,
      situacao:
`Equipe: 4 pessoas (1 comercial, 2 suporte/implantação, 1 administrativo-financeiro).
Volumes por mês: ~300 conversas de clientes, ~40 leads novos, ~15 implantações, ~120 chamados de suporte.
Tempo de 1ª resposta hoje: ~25 minutos; conversão de lead em cliente: ~15%.
Sistemas: o próprio CRM, planilha de clientes, Asaas para cobrança, Google Agenda para demonstrações.
Dores: suporte repetindo as mesmas respostas, leads esfriando sem retorno, implantação dependendo de reunião, cobrança atrasada.
O que funciona: indicação de clientes satisfeitos e a demonstração.`,
      objetivos:
`1) Responder todo lead em até 5 minutos (medir: tempo de 1ª resposta).
2) Resolver 60% do suporte sem pessoa, pela IA e base de conhecimento (medir: % resolvido pela IA).
3) Implantação autoatendida em até 3 dias (medir: dias entre fechamento e primeiro atendimento).
4) Subir a conversão de 15% para 25% em 6 meses.
5) Reduzir inadimplência para menos de 3%.`,
      setores:
`Vendas — responsável: fundador — pessoas: 1
Suporte técnico — responsável: coordenador de suporte — pessoas: 2
Implantação e treinamento — responsável: coordenador de suporte — pessoas: 2
Sucesso do cliente — responsável: fundador — pessoas: 1
Financeiro e administrativo — responsável: administrativo — pessoas: 1`,
      regras:
`A IA pode: explicar planos e funcionalidades, agendar demonstração, enviar o link do teste grátis, orientar passo a passo problemas comuns (número desconectado, senha, como criar etiqueta), abrir chamado e informar o protocolo.
A IA nunca pode: dar desconto ou mudar preço, prometer funcionalidade que não existe ou data de entrega, pedir senha ou código de verificação, mexer em dados de cobrança, falar de clientes de outras empresas.
Passar para uma pessoa quando: o cliente pedir, estiver irritado ou reclamando, for cancelamento, problema de cobrança, sistema fora do ar para vários clientes, ou a IA não resolver em 2 tentativas.
Horário: fora do horário, a IA atende dúvidas e abre chamado; urgência de cliente ativo vai para o plantão.
Dados sensíveis: nunca pedir nem repetir CPF completo, cartão ou senha; confirmar o cliente pelo e-mail cadastrado.`,
    },
    sectors: ["Vendas", "Suporte técnico", "Implantação e treinamento", "Sucesso do cliente", "Financeiro e administrativo"],
    processes: {
      "Vendas":
`1. Lead chega pelo WhatsApp ou Instagram; a IA cumprimenta, pergunta o tipo de empresa, quantos atendentes e o principal problema.
2. Se tem perfil, a IA oferece o diagnóstico gratuito e agenda a demonstração na agenda do vendedor.
3. Vendedor faz a demonstração mostrando o plano da empresa e envia a proposta pelo WhatsApp.
4. Follow-up automático em 2 e 5 dias se não responder.
5. Aceitou: libera o teste de 7 dias e passa para Implantação.
Onde trava: lead sem resposta à noite e no fim de semana; proposta feita à mão.`,
      "Suporte técnico":
`1. Cliente chama no WhatsApp; a IA identifica o cliente pelo número e pergunta o problema.
2. Problemas comuns (número desconectado, login, dúvida de uso) a IA resolve com o passo a passo da base de conhecimento.
3. Não resolveu em 2 tentativas: abre chamado com protocolo e passa para o técnico do plantão.
4. Técnico resolve, registra a solução na base de conhecimento e fecha o chamado.
5. Pesquisa de satisfação automática ao finalizar.
Onde trava: mesma dúvida respondida várias vezes; chamado sem prioridade.`,
      "Implantação e treinamento":
`1. Cliente fecha: recebe o acesso e o link do Diagnóstico.
2. O dono faz o Diagnóstico guiado; a IA monta o plano e as automações.
3. Conectar WhatsApp, criar setores, equipe e etiquetas pelos Primeiros passos.
4. Revisar e publicar os fluxos e o agente de IA; testar uma conversa.
5. Treinamento curto da equipe (vídeo + tela guiada) e acompanhamento no 1º mês.
Onde trava: cliente que não termina o Diagnóstico; dependência de reunião para configurar.`,
      "Sucesso do cliente":
`1. Acompanhar o uso no 1º mês (atendimentos, IA resolvendo, setores ativos).
2. Contato nos dias 7, 15 e 30 para tirar dúvidas e sugerir melhorias.
3. Mostrar os resultados (tempo de resposta, vendas recuperadas) e oferecer novos módulos.
4. Alerta de risco: cliente sem uso há 7 dias ou com reclamação.
Onde trava: ninguém percebe o cliente parado até ele cancelar.`,
      "Financeiro e administrativo":
`1. Cobrança automática da mensalidade pelo Asaas (PIX/boleto) com lembrete antes e depois do vencimento.
2. Pagamento confirmado: aviso automático ao cliente.
3. Atraso de 5 dias: aviso pelo WhatsApp; 15 dias: contato de uma pessoa; 30 dias: suspensão com aviso.
4. Emissão de nota fiscal e conciliação no fim do mês.
Onde trava: cobrança manual e inadimplência sem acompanhamento.`,
    },
  },
  {
    key: "cartorio",
    label: "Cartório (notas, registro civil, protocolo e certidões)",
    steps: {
      empresa:
`Cartório de Notas e Registro Civil, numa cidade média. Atende pessoas, empresas, imobiliárias, bancos e escritórios de advocacia.
Atendimento: presencial no balcão de segunda a sexta, das 9h às 17h (horário definido pela Corregedoria); WhatsApp e e-mail no mesmo horário; plantão do Registro Civil para óbitos nos fins de semana e feriados.
Serviços: escrituras (compra e venda, doação, inventário, divórcio e união estável extrajudiciais), procurações, testamentos, ata notarial, reconhecimento de firma, autenticação de cópias, apostila de Haia, registro de nascimento, casamento e óbito, certidões (2ª via, inteiro teor) e e-Notariado (atos à distância por videoconferência).
Valores: emolumentos pela tabela oficial do Tribunal de Justiça do estado, atualizada todo ano; escrituras dependem do valor do bem, por isso o orçamento é feito por um escrevente.
Políticas: o ato só é lavrado com o pagamento e os documentos conferidos; minuta enviada para conferência antes da assinatura; prazo de certidão: na hora (balcão) ou até 5 dias úteis (pedido a distância).
Dúvidas frequentes: "quais documentos preciso?", "quanto custa a escritura?", "posso fazer online?", "quanto tempo demora?", "como pego a 2ª via da certidão?", "precisa marcar horário?"`,
      clientes:
`Quem procura: pessoas comprando ou vendendo imóvel, famílias (nascimento, casamento, óbito, inventário), empresas (procurações, ata notarial), imobiliárias, bancos e correspondentes, advogados e despachantes.
Como chegam: indicação de imobiliárias, bancos e advogados; Google ("cartório perto de mim"); já são clientes de atos anteriores.
O que perguntam antes: lista de documentos, valor dos emolumentos e do ITBI/ITCMD, prazo, se dá para fazer a distância, se precisa agendar.
Objeções e medos: "é caro", "demora muito", "tenho medo de errar a documentação e voltar várias vezes", "não consigo ir no horário do cartório".
Etapas de um ato (escritura): 1) pedido e dúvidas → 2) envio dos documentos → 3) conferência e orçamento → 4) pagamento das guias (ITBI) e dos emolumentos → 5) minuta para conferência → 6) agendamento da assinatura (presencial ou e-Notariado) → 7) ato lavrado e traslado entregue → 8) encaminhamento ao Registro de Imóveis.
Clientes recorrentes (imobiliárias, bancos, advogados) valem atenção especial: volume alto e indicações.`,
      marca:
`Cores: Azul-marinho #1E3A5F (principal), Dourado #B8935A, Branco.
Tom de voz: formal e acolhedor; trata por "o senhor / a senhora" até o cliente pedir "você"; linguagem simples, sem juridiquês (quando usar um termo técnico, explica); nada de emoji, salvo um 🙂 no cumprimento se o cliente usar.
Usa: "vou conferir para o senhor", "segue a lista de documentos", "o próximo passo é".
Evita: dar opinião jurídica, prometer prazo que depende de outro órgão (prefeitura, Registro de Imóveis), informar valor sem a tabela oficial.
Exemplo: "Bom dia, Sr. João! Para a escritura de compra e venda, segue a lista de documentos. Assim que o senhor enviar, um escrevente confere e manda o orçamento com os emolumentos e o ITBI."`,
      cultura:
`Missão: dar segurança jurídica aos atos da vida das pessoas e das empresas, com atendimento rápido e humano.
Visão: ser o cartório mais fácil de usar da região, com a maior parte dos pedidos resolvidos a distância.
Valores: fé pública e ética, sigilo e proteção de dados, clareza, agilidade, respeito ao cidadão.`,
      situacao:
`Equipe: 1 tabelião (titular), 1 substituto, 6 escreventes, 3 atendentes de balcão, 1 financeiro.
Volumes por mês: ~900 reconhecimentos de firma e autenticações, ~120 escrituras, ~80 procurações, ~250 certidões, ~1.500 mensagens no WhatsApp.
Tempo de 1ª resposta no WhatsApp hoje: ~2 horas; 40% das mensagens são "quais documentos preciso?" e "quanto custa?".
Sistemas: sistema do cartório (atos e selos), e-Notariado, central de certidões (CRC), planilha de pedidos, Google Agenda para assinaturas.
Dores: escreventes respondendo a mesma lista de documentos o dia todo; documentação chega incompleta e o ato atrasa; cliente liga para saber "em que pé está"; pedidos de certidão a distância se perdem.
O que funciona: atendimento presencial bem avaliado e parcerias com imobiliárias.`,
      objetivos:
`1) Responder todo WhatsApp em até 10 minutos no horário de atendimento (medir: tempo de 1ª resposta).
2) 70% das dúvidas de documentos e valores resolvidas pela IA com a lista e a tabela oficial (medir: % resolvido pela IA).
3) Documentação completa na primeira entrega em 80% das escrituras (medir: escrituras sem pedido de documento extra).
4) Cliente informado em cada etapa do ato, sem precisar ligar (medir: ligações "em que pé está").
5) Dobrar os atos a distância (e-Notariado e certidões online) em 12 meses.`,
      setores:
`Atendimento e balcão — responsável: coordenadora de atendimento — pessoas: 3
Escrituras e notas — responsável: tabelião substituto — pessoas: 4
Registro Civil — responsável: escrevente do Registro Civil — pessoas: 2
Certidões e pedidos a distância — responsável: escrevente — pessoas: 1
Financeiro (emolumentos, guias e repasses) — responsável: financeiro — pessoas: 1`,
      regras:
`A IA pode: informar horários, endereço e serviços; enviar a lista de documentos de cada ato; explicar as etapas e os prazos normais; informar valores SOMENTE copiados da tabela oficial de emolumentos cadastrada na base de conhecimento; receber documentos e abrir o pedido com protocolo; agendar a assinatura; informar a situação de um pedido pelo protocolo.
A IA nunca pode: dar orientação ou opinião jurídica (qual regime de bens, se vale a pena doar ou vender, como evitar imposto); calcular escritura, ITBI ou ITCMD (só o escrevente); garantir prazo de outro órgão; confirmar que um ato foi lavrado sem registro no sistema; informar dados de atos de outras pessoas (sigilo); aceitar pedido de certidão de inteiro teor sem a identificação exigida.
Passar para uma pessoa quando: orçamento de escritura, inventário, divórcio ou testamento; documento com divergência; óbito (prioridade, com acolhimento); reclamação; pedido de humano; a IA não resolver em 2 tentativas.
Horário: fora do expediente a IA envia listas e recebe documentos, avisando que a conferência será no próximo dia útil; óbito vai para o plantão.
Dados sensíveis: pedir documentos só pelo canal oficial; nunca repetir CPF completo, dados de saúde ou de menores; avisar que os documentos ficam guardados conforme a lei e a LGPD.`,
    },
    sectors: ["Atendimento e balcão", "Escrituras e notas", "Registro Civil", "Certidões e pedidos a distância", "Financeiro (emolumentos, guias e repasses)"],
    processes: {
      "Atendimento e balcão":
`1. Cliente chama no WhatsApp; a IA cumprimenta, pergunta qual serviço precisa e envia a lista de documentos daquele ato.
2. Para reconhecimento de firma e autenticação, informa o valor da tabela e o horário do balcão (sem agendamento).
3. Para escrituras, procurações e testamentos, abre o pedido com protocolo e passa para o setor de Escrituras.
4. Cliente presencial pega senha; atendente confere documentos, cobra e entrega o ato.
Onde trava: a mesma pergunta de documentos o dia todo; fila no balcão por falta de documento.`,
      "Escrituras e notas":
`1. Pedido chega com protocolo; escrevente confere os documentos recebidos e pede o que faltar numa única mensagem.
2. Calcula emolumentos e orienta a emissão do ITBI/ITCMD; envia o orçamento.
3. Com o pagamento, prepara a minuta e envia para conferência das partes.
4. Agenda a assinatura (presencial ou e-Notariado por videoconferência).
5. Lavra o ato, entrega o traslado e orienta o registro no Registro de Imóveis.
Onde trava: documentação incompleta; cliente sem notícia entre as etapas; remarcação de assinatura.`,
      "Registro Civil":
`1. Nascimento: família envia a DNV e os documentos dos pais; agenda o registro; certidão na hora.
2. Casamento: habilitação com documentos e testemunhas, edital, agendamento da cerimônia.
3. Óbito: atendimento prioritário (plantão), com acolhimento; documentos e declaração de óbito; certidão no mesmo dia.
Onde trava: documentos faltando na habilitação de casamento; plantão de óbito sem aviso rápido.`,
      "Certidões e pedidos a distância":
`1. Cliente pede 2ª via pelo WhatsApp ou e-mail; a IA identifica o tipo (nascimento, casamento, óbito, escritura) e os dados mínimos.
2. Emite o pagamento; com a confirmação, o escrevente busca o livro e emite a certidão.
3. Envia a certidão digital ou avisa que está pronta para retirar; pedidos de outro cartório vão pela central (CRC).
Onde trava: pedidos sem dados suficientes; pagamento não identificado; cliente sem retorno.`,
      "Financeiro (emolumentos, guias e repasses)":
`1. Atualizar a tabela de emolumentos todo início de ano (base de conhecimento).
2. Conferir pagamentos de pedidos a distância (PIX/boleto) e liberar o ato.
3. Recolher os repasses obrigatórios (fundos, ISS) e fechar o caixa diário.
4. Relatório mensal de atos e arrecadação.
Onde trava: pagamento por PIX sem identificação; conferência manual.`,
    },
  },
];

export const templateByKey = (k?: string | null) => TEMPLATES.find((t) => t.key === k) ?? null;
