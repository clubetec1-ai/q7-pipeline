import { supabase } from "@/integrations/supabase/client";

/**
 * Chama uma Edge Function e devolve { ok, data } ou { ok: false, message } com
 * a mensagem de erro que a função mandou (em vez do "non-2xx" genérico).
 */
export async function callFunction<T = Record<string, unknown>>(
  name: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data: T; message: string }> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error && data?.ok) return { ok: true, data: data as T, message: "" };
  let message = data?.error as string | undefined;
  if (!message && error && "context" in error) {
    try {
      message = (await (error as { context: Response }).context.json())?.error;
    } catch {
      // resposta sem corpo JSON
    }
  }
  return { ok: false, data: {} as T, message: message || "Não foi possível concluir a ação" };
}
