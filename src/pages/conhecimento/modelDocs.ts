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
- Se a tabela oficial não estiver cadastrada, não informe valores e não prometa "verificar e retornar": diga que um escrevente confirma o valor e passe para uma pessoa.
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

// Registro de Imóveis e Ofício Único (cidade pequena, várias atribuições).
const AVISO_RI = "MODELO ClubeCRM — revise com o oficial antes de usar. As exigências e os prazos podem variar conforme o estado (Código de Normas da Corregedoria) e o caso; em dúvida, o escrevente confirma.";
const RI_DOCS: ModelDoc[] = [
  {
    title: "Como informar valores (regra do registro de imóveis)", kind: "politica", visibility: "atendimento", sector: null,
    text: `${AVISO_RI}

Valores (emolumentos) seguem a tabela oficial do Tribunal de Justiça do estado e dependem do valor do imóvel e do tipo de ato.
- Só informe valores que estiverem na tabela oficial cadastrada nesta base de conhecimento.
- Sem a tabela cadastrada, não informe valores e não prometa "verificar e retornar": diga que um escrevente confirma o valor e passe para uma pessoa.
- No protocolo pode ser cobrado um depósito prévio; o acerto final é feito no registro.
- Impostos (ITBI, ITCMD) são da prefeitura ou do estado; o cartório não calcula imposto pelo WhatsApp.`,
  },
  {
    title: "Documentos para registro e averbação (modelo)", kind: "manual", visibility: "atendimento", sector: "Protocolo e atendimento",
    text: `${AVISO_RI}

REGISTRO DE COMPRA E VENDA (ESCRITURA)
- Traslado ou certidão da escritura pública.
- Comprovante de pagamento do ITBI.
- Documentos que o tabelionato não tenha arquivado, quando pedidos (ex.: certidão de casamento atualizada).

REGISTRO DE FINANCIAMENTO (CONTRATO DO BANCO COM ALIENAÇÃO FIDUCIÁRIA)
- Contrato do banco em via original ou digital assinada, com todas as páginas.
- Comprovante de pagamento do ITBI.
- Documentos das partes indicados no contrato.

DOAÇÃO E FORMAL DE PARTILHA (INVENTÁRIO)
- Escritura de doação ou formal de partilha / escritura de inventário.
- Comprovante do ITCMD.

AVERBAÇÃO DE CONSTRUÇÃO
- Requerimento do proprietário, habite-se da prefeitura e certidão negativa de débitos do INSS da obra (CND), quando exigida.

AVERBAÇÃO DE CASAMENTO, DIVÓRCIO OU ÓBITO
- Certidão atualizada do casamento, do divórcio (com partilha, se houver) ou do óbito, e requerimento.

BAIXA DE FINANCIAMENTO / CANCELAMENTO DE ALIENAÇÃO FIDUCIÁRIA OU HIPOTECA
- Termo de quitação do banco (original ou eletrônico) e requerimento do proprietário.

COMO ENTREGAR
- No balcão do cartório ou pela central eletrônica de registro (e-protocolo), quando o título for digital.`,
  },
  {
    title: "Como funciona o registro: protocolo, análise, exigências e prazos (modelo)", kind: "manual", visibility: "atendimento", sector: "Registro e exigências",
    text: `${AVISO_RI}

ETAPAS
1. Protocolo (prenotação): o título recebe um número de protocolo, que garante a prioridade.
2. Análise (qualificação): o escrevente confere o título e os documentos.
3. Resultado: o título é registrado na matrícula ou volta com uma nota devolutiva (exigências) explicando o que falta ou o que corrigir.
4. Exigência: o cliente apresenta o que foi pedido dentro do prazo da prenotação; depois disso, a análise continua.
5. Registro feito: o cliente recebe o aviso e pode pedir a certidão da matrícula atualizada.

PRAZOS
- Os prazos de análise e registro são definidos em lei (alguns atos mais simples têm prazo menor) e contam a partir do protocolo.
- Com exigência, o prazo volta a contar quando o cliente apresenta o que faltava.
- Informe prazos só desta forma; para um caso específico, o escrevente confirma.

SITUAÇÃO DO PROTOCOLO
- Peça o número do protocolo. Se não tiver acesso à situação, diga que um escrevente informa e passe para uma pessoa.
- Nunca explique uma exigência de forma diferente do que está escrito na nota devolutiva; em dúvida, passe para um escrevente.`,
  },
  {
    title: "Certidões do Registro de Imóveis (modelo)", kind: "manual", visibility: "atendimento", sector: "Certidões de imóveis",
    text: `${AVISO_RI}

TIPOS
- Certidão da matrícula (inteiro teor): mostra todo o histórico do imóvel.
- Certidão de ônus reais: mostra se há financiamento, hipoteca, penhora ou outras restrições.
- Certidão vintenária: histórico do imóvel nos últimos 20 anos (pedida em alguns casos, como usucapião).

COMO PEDIR
- Informe o número da matrícula (está na escritura ou no IPTU) ou, se não tiver, o endereço completo e o nome do proprietário.
- Pode ser pedida no balcão, pelo WhatsApp do cartório (pedido com protocolo) ou pela central eletrônica de registro (certidão digital).
- Qualquer pessoa pode pedir certidão de matrícula; o conteúdo é enviado só na certidão oficial, nunca pelo WhatsApp.
- O prazo de emissão segue a lei e conta a partir da confirmação do pagamento.`,
  },
];

const PROTESTO_DOC: ModelDoc = {
  title: "Protesto de títulos: pagar, cancelar e consultar (modelo)", kind: "manual", visibility: "atendimento", sector: "Protesto de títulos",
  text: `${AVISO}

CONSULTAR SE HÁ PROTESTO
- Informe o CPF ou CNPJ; a consulta também pode ser feita gratuitamente na central nacional de protesto pela internet.

PAGAR UM TÍTULO QUE FOI PARA PROTESTO (ANTES DE PROTESTAR)
- Quem recebeu a intimação pode pagar no cartório dentro do prazo indicado nela; o valor é repassado ao credor.

CANCELAR UM PROTESTO
- Carta de anuência do credor (com firma reconhecida ou assinatura digital) ou o título original.
- Documento de quem pede o cancelamento.
- Pagamento dos emolumentos do cancelamento, conforme a tabela oficial.

O QUE O CARTÓRIO NÃO FAZ
- Não negocia a dívida nem dá desconto em nome do credor: o acordo é feito diretamente com o credor.`,
};

MODEL_DOCS.cartorio.label = "Cartório — Notas e Registro Civil";
MODEL_DOCS.cartorio_imoveis = {
  label: "Cartório — Registro de Imóveis",
  tip: "Envie também a tabela oficial de emolumentos do seu estado (PDF do Tribunal de Justiça) como “Tabela de preços”. Sem ela, o agente não informa valores.",
  docs: RI_DOCS,
};
MODEL_DOCS.cartorio_unico = {
  label: "Cartório — Ofício Único",
  tip: MODEL_DOCS.cartorio.tip,
  docs: [
    ...MODEL_DOCS.cartorio.docs,
    ...RI_DOCS.slice(1).map((d) => ({ ...d, sector: "Registro de Imóveis" })),
    PROTESTO_DOC,
  ],
};
