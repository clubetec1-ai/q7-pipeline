import { assertEquals } from "jsr:@std/assert@1";
import { friendlyMailError, htmlToText, isAutomated, replySubject, stripQuoted } from "./mail-utils.ts";

Deno.test("respostas automaticas e listas nao abrem atendimento", () => {
  assertEquals(isAutomated([{ key: "Auto-Submitted", value: "auto-replied" }], "a@x.com"), true);
  assertEquals(isAutomated([{ key: "Precedence", value: "bulk" }], "a@x.com"), true);
  assertEquals(isAutomated([{ key: "List-Id", value: "<lista>" }], "a@x.com"), true);
  assertEquals(isAutomated([], "no-reply@loja.com"), true);
  assertEquals(isAutomated([{ key: "Auto-Submitted", value: "no" }], "cliente@x.com"), false);
});

Deno.test("assunto, html e citacao", () => {
  assertEquals(replySubject("Pedido 12", "Atendimento"), "Re: Pedido 12");
  assertEquals(replySubject("RE: Pedido 12", "Atendimento"), "RE: Pedido 12");
  assertEquals(replySubject("", "Atendimento #1"), "Atendimento #1");
  assertEquals(htmlToText("<p>Oi<br>tudo&nbsp;bem?</p><script>x()</script>"), "Oi\ntudo bem?");
  assertEquals(stripQuoted("Pode sim\n\nEm seg., 1 de jan. de 2026, Loja escreveu:\n> antigo"), "Pode sim");
});

Deno.test("erros amigaveis", () => {
  assertEquals(friendlyMailError({ authenticationFailed: true }), "Usuário ou senha incorretos. No Gmail e no Outlook, use uma senha de app.");
  assertEquals(friendlyMailError(new Error("Unexpected close")).startsWith("Usuário ou senha"), true);
  assertEquals(friendlyMailError(new Error("getaddrinfo ENOTFOUND x")), "Servidor não encontrado. Confira o endereço.");
});
