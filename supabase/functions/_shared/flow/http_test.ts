import { assertEquals } from "jsr:@std/assert@1";
import { buildRequest, checkUrl, isBlockedIp, secretNames } from "./http.ts";
import { mapResponse, pickPath } from "./engine.ts";

Deno.test("IPs internos sao recusados", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "[::1]", "lixo"]) {
    assertEquals(isBlockedIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assertEquals(isBlockedIp(ip), false, ip);
  }
});

Deno.test("URL: so https, porta 443, sem nomes internos", () => {
  assertEquals(checkUrl("http://api.exemplo.com").error, "só https");
  assertEquals(checkUrl("https://api.exemplo.com:8443/x").error, "só a porta 443");
  assertEquals(checkUrl("https://localhost/x").error, "endereço interno");
  assertEquals(checkUrl("https://2130706433/").error, "endereço interno");   // 127.0.0.1 em decimal
  assertEquals(checkUrl("https://[::1]/").error, "endereço interno");
  assertEquals(checkUrl("https://user:pw@api.exemplo.com/").error, "URL com usuário/senha");
  assertEquals(checkUrl("https://api.exemplo.com:443/ok").error, undefined);
});

Deno.test("variaveis: na URL codificadas, no corpo como valor JSON; segredo so onde usado", () => {
  const v = { vars: { pedido: '12"}, "admin": true' }, name: "Maria", phone: "5511999", protocol: "P-1" };
  const d = {
    method: "POST", url: "https://api.x.com/p/{var.pedido}?tel={telefone}&k={{segredo.chave}}",
    headers: [{ key: "Authorization", value: "Bearer {{segredo.chave}}\r\nX-Evil: 1" }, { key: "Host", value: "x" }],
    body: '{"pedido":"{var.pedido}","cliente":{"nome":"{nome}"}}',
  };
  const r = buildRequest(d, v, { chave: "abc" });
  assertEquals(r.url, "https://api.x.com/p/12%22%7D%2C%20%22admin%22%3A%20true?tel=5511999&k=abc");
  assertEquals(r.headers.Authorization, "Bearer abc  X-Evil: 1");
  assertEquals(r.headers.Host, undefined);
  assertEquals(JSON.parse(r.body!), { pedido: '12"}, "admin": true', cliente: { nome: "Maria" } });
  assertEquals(secretNames(d), ["chave"]);
});

Deno.test("mapeamento da resposta", () => {
  const body = { pedido: { itens: [{ status: "enviado" }], total: 10 } };
  assertEquals(pickPath(body, "pedido.itens[0].status"), "enviado");
  assertEquals(pickPath(body, "__proto__.x"), undefined);
  assertEquals(mapResponse(body, [{ path: "pedido.total", var: "Total" }, { path: "nada", var: "x" }], {}), { total: "10" });
});
