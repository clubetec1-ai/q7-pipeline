/**
 * Documentos modelo da base de conhecimento por tipo de empresa (chave do modelo
 * com que a empresa foi criada). O dono adiciona com um clique, revisa e corrige:
 * entram como documentos comuns (texto), com as mesmas regras de permissão.
 * Nada de valores: preços só da tabela oficial que a própria empresa envia.
 */
export interface ModelDoc { title: string; kind: string; visibility: "interno" | "atendimento" | "enviavel"; sector: string | null; text: string }

const AVISO = "MODELO ClubeCRM — revise com o tabelião antes de usar. As exigências podem variar conforme o estado (Código de Normas da Corregedoria) e o caso; em dúvida, o escrevente confirma.";

export const MODEL_DOCS: Record<string, { label: string; tip: string; docs: ModelDoc[] }> = {
  cartorio: {
    label: "Cartório de Notas e Registro Civil",
    tip: "Envie também a tabela oficial de emolumentos do seu estado (PDF do Tribunal de Justiça) como “Tabela de preços”, no setor Atendimento e balcão. Sem ela, o agente não informa valores.",
    docs: [
      {
        title: "Como informar valores (regra do cartório)", kind: "politica", visibility: "atendimento", sector: null,
        text: `${AVISO}

Valores dos atos (emolumentos) seguem a tabela oficial do Tribunal de Justiça do estado, atualizada todo ano.
- Só informe valores que estiverem na tabela oficial cadastrada nesta base de conhecimento.
- Se a tabela oficial não estiver cadastrada, não informe valores: diga que o escrevente envia o orçamento.
- Escrituras, inventários, divórcios e testamentos dependem do valor do bem e do caso: o orçamento é sempre feito por um escrevente.
- Impostos (ITBI, ITCMD) são calculados e cobrados pela prefeitura ou pelo estado; o cartório não calcula imposto pelo WhatsApp.`,
      },
      {
        title: "Documentos para escrituras (modelo)", kind: "manual", visibility: "atendimento", sector: "Escrituras e notas",
        text: `${AVISO}

ESCRITURA DE COMPRA E VENDA
Partes (comprador e vendedor), pessoa física:
- RG ou CNH e CPF (originais).
- Certidão de nascimento (solteiros) ou de casamento atualizada (casados, separados, divorciados, viúvos); pacto antenupcial, se houver.
- Comprovante de endereço, profissão e e-mail.
Partes pessoa jurídica:
- Contrato ou estatuto social e última alteração, cartão do CNPJ, documentos de quem assina pela empresa.
Imóvel:
- Certidão da matrícula atualizada, com ônus reais (normalmente emitida há menos de 30 dias).
- Certidão ou guia do IPTU / certidão negativa de débitos municipais.
- Guia e comprovante de pagamento do ITBI (emitida pela prefeitura).
- Imóvel em condomínio: declaração de quitação do condomínio.
Certidões dos vendedores, quando exigidas: débitos trabalhistas (CNDT) e outras que o escrevente indicar.

ESCRITURA DE DOAÇÃO
- Documentos das partes e do imóvel, como na compra e venda.
- Guia e comprovante do ITCMD (imposto estadual de doação).

INVENTÁRIO E PARTILHA NO CARTÓRIO (EXTRAJUDICIAL)
- Certidão de óbito; documentos do cônjuge e de todos os herdeiros (RG, CPF, certidões de nascimento ou casamento).
- Certidão de que não há testamento (pesquisa na central de testamentos) ou o testamento, se houver.
- Documentos de todos os bens (matrículas, veículos, saldos bancários) e das dívidas.
- Guia e comprovante do ITCMD.
- Advogado ou defensor público é obrigatório. Todos precisam estar de acordo; o escrevente confirma se o caso pode ser feito no cartório.

DIVÓRCIO E SEPARAÇÃO CONSENSUAIS NO CARTÓRIO
- Certidão de casamento atualizada, RG e CPF dos dois, pacto antenupcial se houver.
- Documentos dos bens a partilhar e certidões dos filhos.
- Advogado obrigatório; o escrevente confirma se o caso pode ser feito no cartório (ex.: quando há filhos menores).

UNIÃO ESTÁVEL (ESCRITURA)
- RG, CPF e certidão de nascimento ou casamento (com averbação de divórcio, se for o caso) dos dois; comprovante de endereço.`,
      },
      {
        title: "Procurações, firma, autenticação e apostila (modelo)", kind: "manual", visibility: "atendimento", sector: "Atendimento e balcão",
        text: `${AVISO}

PROCURAÇÃO PÚBLICA
- Quem dá a procuração (outorgante): RG ou CNH e CPF originais, estado civil e endereço; presença no cartório ou ato a distância pelo e-Notariado.
- Quem recebe (procurador): nome completo, CPF, estado civil, profissão e endereço (não precisa comparecer).
- Finalidade: o que o procurador poderá fazer (ex.: vender um imóvel específico — leve a matrícula).

RECONHECIMENTO DE FIRMA
- Por semelhança: a pessoa precisa ter ficha de firma aberta no cartório (abrir com RG ou CNH e CPF originais).
- Por autenticidade (exigido em alguns documentos, como transferência de veículo): a pessoa assina na frente do escrevente, com documento original.

AUTENTICAÇÃO DE CÓPIAS
- Traga o documento original e a cópia (ou o cartório faz a cópia).

APOSTILA DE HAIA (documento para usar no exterior)
- Traga o documento original; documentos de outros órgãos podem precisar de reconhecimento antes.

ATA NOTARIAL
- O tabelião registra o que viu (site, conversa, mensagens, local). Explique o que precisa ser registrado; o escrevente orienta e faz o orçamento.`,
      },
      {
        title: "Registro Civil: nascimento, casamento e óbito (modelo)", kind: "manual", visibility: "atendimento", sector: "Registro Civil",
        text: `${AVISO}

REGISTRO DE NASCIMENTO
- Declaração de Nascido Vivo (DNV) entregue pela maternidade.
- RG ou CNH e CPF dos pais; certidão de casamento, se forem casados (se não forem, o pai comparece ou envia declaração/procuração).
- O registro e a primeira certidão são gratuitos. Prazo legal: até 15 dias do nascimento (pode ser maior em alguns casos; o escrevente orienta).

CASAMENTO (HABILITAÇÃO)
- Certidão de nascimento (solteiros) ou de casamento com averbação do divórcio ou certidão de óbito do ex-cônjuge (viúvos), atualizadas.
- RG ou CNH, CPF e comprovante de endereço dos noivos.
- Duas testemunhas maiores de 18 anos, com documento.
- Escolha do regime de bens (se não for comunhão parcial, é preciso pacto antenupcial, feito por escritura).
- Depois da habilitação há a publicação de edital; a data da cerimônia é agendada com o cartório.

ÓBITO
- Atendimento prioritário e acolhedor; há plantão nos fins de semana e feriados.
- Declaração de Óbito (DO) emitida pelo médico ou pelo IML.
- Documentos do falecido (RG, CPF, certidão de nascimento ou casamento) e do declarante (familiar).
- O registro e a primeira certidão de óbito são gratuitos.`,
      },
      {
        title: "Certidões e pedidos a distância (modelo)", kind: "manual", visibility: "atendimento", sector: "Certidões",
        text: `${AVISO}

SEGUNDA VIA DE CERTIDÃO (nascimento, casamento, óbito)
- Informe: nome completo da pessoa, data do fato (nascimento, casamento ou óbito), nomes dos pais e, se tiver, livro, folha e termo.
- Atos de outro cartório podem ser pedidos pela central nacional do Registro Civil (CRC).
- Certidão de inteiro teor e certidões com informações protegidas exigem requerimento e identificação de quem pede; o escrevente orienta.

CERTIDÃO DE ESCRITURA OU PROCURAÇÃO
- Informe o tipo de ato, os nomes das partes e a data aproximada (ou livro e folha).

COMO FUNCIONA O PEDIDO A DISTÂNCIA
- O pedido é registrado com protocolo; o cartório informa o valor e a forma de pagamento.
- Com o pagamento confirmado, a certidão é emitida e enviada em formato digital ou fica pronta para retirada.
- O prazo informado pelo escrevente vale a partir da confirmação do pagamento.`,
      },
    ],
  },
};
