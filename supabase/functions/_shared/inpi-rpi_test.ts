import { assert, assertEquals } from "jsr:@std/assert@1";
import { inpiGuidance, normName, parseProcess, scanSegment, type RpiHit } from "./inpi-rpi.ts";

const XML = `<?xml version="1.0" encoding="UTF-8" ?>
<revista numero="2909" data="06/10/2026">
  <processo numero="945455720">
    <despachos><despacho codigo="IPAS009" nome="Publicação de pedido de registro para oposição (exame formal concluído)"/></despachos>
    <titulares><titular nome-razao-social="CLUBETEC SOLUÇÕES E SERVIÇOS DE TECNOLOGIA LTDA" pais="BR" uf="SP"/></titulares>
    <marca apresentacao="Mista" natureza="Produtos e/ou Serviço"><nome>DEIXA COM A IA</nome></marca>
    <lista-classe-nice><classe-nice codigo="42"><especificacao>x</especificacao><status>Em vigor</status></classe-nice></lista-classe-nice>
  </processo>
  <processo numero="111111111">
    <despachos><despacho codigo="IPAS136" nome="Exigência de mérito"><texto-complementar>Apresente &quot;x&quot; &amp; y</texto-complementar></despacho></despachos>
    <titulares><titular nome-razao-social="Outra Empresa Ltda" pais="BR"/></titulares>
    <marca apresentacao="Nominativa" natureza="Produtos e/ou Serviço"><nome>Deixe com a I.A.</nome></marca>
  </processo>
  <processo numero="222222222">
    <despachos><despacho codigo="IPAS158" nome="Concessão de registro"/></despachos>
    <titulares><titular nome-razao-social="Clubetec Soluções" pais="BR"/></titulares>
  </processo>
  <processo numero="333333333">
    <despachos><despacho codigo="IPAS158" nome="Concessão de registro"/></despachos>
    <marca apresentacao="Nominativa" natureza="x"><nome>Nada a ver</nome></marca>
  </processo>
</revista>`;

Deno.test("normName", () => {
  assertEquals(normName("Deixa com a I.A."), "deixacomaia");
  assertEquals(normName("DÊIXA  com-a-IA"), "deixacomaia");
});

Deno.test("parseProcess lê despachos, titular, marca e classes", () => {
  const b = XML.slice(XML.indexOf('<processo numero="111111111"'), XML.indexOf("</processo>", XML.indexOf("111111111")) + 11);
  const p = parseProcess(b);
  assertEquals(p.numero, "111111111");
  assertEquals(p.marca, "Deixe com a I.A.");
  assertEquals(p.apresentacao, "Nominativa");
  assertEquals(p.despachos, [{ codigo: "IPAS136", nome: "Exigência de mérito", complemento: 'Apresente "x" & y' }]);
});

Deno.test("scanSegment acha por número, titular e marca parecida — e não pega o resto", () => {
  const out = new Map<string, RpiHit>();
  scanSegment(XML, { numbers: ["945455720"], titular: /clubetec/gi, terms: ["deixacomaia", "deixecomaia"] }, out);
  assertEquals(out.get("945455720")?.motivo, "numero");
  assertEquals(out.get("945455720")?.classes, [{ codigo: "42", status: "Em vigor" }]);
  assertEquals(out.get("111111111")?.motivo, "marca");
  assertEquals(out.get("111111111")?.termo, "deixecomaia");
  assertEquals(out.get("222222222")?.motivo, "titular");
  assert(!out.has("333333333"));
});

Deno.test("inpiGuidance", () => {
  assertEquals(inpiGuidance("Exigência formal").dias, 5);
  assertEquals(inpiGuidance("Exigência de mérito").nivel, "urgente");
  assertEquals(inpiGuidance("Publicação de pedido de registro para oposição (exame formal concluído)").nivel, "info");
  assertEquals(inpiGuidance("Deferimento do pedido").nivel, "atencao");
  assertEquals(inpiGuidance("Concessão de registro").nivel, "ok");
  assertEquals(inpiGuidance("Notificação de oposição").nivel, "urgente");
});
