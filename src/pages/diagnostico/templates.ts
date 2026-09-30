/**
 * Modelos por tipo de empresa: exemplos prontos para cada etapa do Diagnóstico.
 * O dono escolhe o modelo, clica em "Usar exemplo" e só corrige o que for diferente.
 * O primeiro é o da própria Clubetec (vende e implanta software + suporte técnico).
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
];

export const templateByKey = (k?: string | null) => TEMPLATES.find((t) => t.key === k) ?? null;
