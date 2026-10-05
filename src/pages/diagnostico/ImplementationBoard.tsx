import { BellRing, Sparkles, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface BoardProc {
  nome: string; setor?: string; area?: string; implementar?: "agora" | "depois" | "nao"; lembrar_em?: string; lembrado_em?: string; dificuldade?: string;
  /** Gravado pelo banco quando a melhoria ligada ao processo vai ao ar ou recebe resultado (cérebro). */
  implantacao?: { status?: string; resultado?: string | null; em?: string };
}
export interface Priority { at: string; resumo?: string; ordem: { setor: string; motivo: string; ganho: string; primeiros: string[] }[] }

const CHOICES: [NonNullable<BoardProc["implementar"]>, string, string][] = [
  ["agora", "Agora", "bg-emerald-600 text-white border-emerald-600"],
  ["depois", "Depois", "bg-amber-500 text-white border-amber-500"],
  ["nao", "Não", "bg-muted-foreground text-background border-muted-foreground"],
];
const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

/**
 * Plano de implementação por setor: para cada processo mapeado o dono escolhe
 * Agora / Depois (com data de lembrete, que chega no sino) / Não. A IA sugere
 * por qual setor começar. Setores seguem a ordem sugerida (quando houver).
 */
export function ImplementationBoard({ processes, sectors, priority, busy, onChange, onPrioritize }: {
  processes: BoardProc[]; sectors: string[]; priority?: Priority | null; busy?: boolean;
  onChange: (next: BoardProc[]) => void; onPrioritize: () => void;
}) {
  const rank = new Map((priority?.ordem ?? []).map((o, i) => [o.setor, i]));
  const ordered = [...sectors].sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
  const setProc = (p: BoardProc, patch: Partial<BoardProc>) => onChange(processes.map((x) => (x === p ? { ...x, ...patch } : x)));
  const count = (k: string) => processes.filter((p) => p.implementar === k).length;

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">Plano de implementação por setor</p>
          <p className="text-xs text-muted-foreground">
            Marque o que implementar <b>agora</b>, o que fica para <b>depois</b> (com data: o lembrete chega no 🔔) e o que <b>não</b> vai fazer.
            Vá de setor em setor, no seu ritmo. · {count("agora")} agora · {count("depois")} depois · {count("nao")} não
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={busy || !processes.length} onClick={onPrioritize}>
          <Sparkles className="w-4 h-4 mr-1" /> {busy ? "Analisando…" : priority ? "Sugerir de novo" : "Por onde começar? (IA)"}
        </Button>
      </div>

      {priority && (
        <div className="rounded-md bg-muted/40 p-3 space-y-1.5 text-sm">
          {priority.resumo && <p className="font-medium flex items-center gap-1.5"><Trophy className="w-4 h-4" /> {priority.resumo}</p>}
          {priority.ordem.map((o, i) => (
            <p key={o.setor} className="text-xs"><b>{i + 1}º {o.setor}</b> — {o.motivo}{o.ganho ? ` Ganho: ${o.ganho}.` : ""}
              {o.primeiros.length ? <span className="text-muted-foreground"> Comece por: {o.primeiros.join(", ")}.</span> : null}</p>
          ))}
          <p className="text-xs text-muted-foreground">Sugestão da IA a partir do diagnóstico — a decisão é sua.</p>
        </div>
      )}

      {!processes.length && <p className="text-sm text-muted-foreground">Mapeie os processos de cada setor (páginas "Processos" ao lado) para montar o plano.</p>}
      {ordered.map((s) => {
        const list = processes.filter((p) => (p.setor || p.area) === s);
        if (!list.length) return null;
        const pos = rank.get(s);
        return (
          <div key={s} className="space-y-1.5">
            <p className="text-sm font-medium">{pos !== undefined ? `${pos + 1}º · ` : ""}{s}</p>
            {list.map((p, i) => (
              <div key={`${p.nome}-${i}`} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5">
                <span className="text-sm flex-1 min-w-[10rem]">
                  {p.nome}
                  {p.implantacao?.em && (
                    <span className={`ml-2 rounded-md px-1.5 py-0.5 text-xs ${p.implantacao.resultado === "funcionou" ? "bg-success-soft text-success-text" : p.implantacao.resultado === "nao_funcionou" ? "bg-danger-soft text-danger-text" : "bg-info-soft text-info-text"}`}>
                      Implantado em {new Date(p.implantacao.em).toLocaleDateString("pt-BR")}
                      {p.implantacao.resultado === "funcionou" ? " · funcionou" : p.implantacao.resultado === "nao_funcionou" ? " · não funcionou" : p.implantacao.status === "no_ar" ? " · medindo" : ""}
                    </span>
                  )}
                </span>
                <div className="flex rounded-md border overflow-hidden text-xs">
                  {CHOICES.map(([k, label, on]) => (
                    <button key={k} type="button" onClick={() => setProc(p, { implementar: k, lembrar_em: k === "depois" ? p.lembrar_em || inDays(7) : undefined })}
                      className={`px-2 py-1 border-r last:border-r-0 ${p.implementar === k ? on : "hover:bg-muted"}`}>{label}</button>
                  ))}
                </div>
                {p.implementar === "depois" && (
                  <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Dia do lembrete no sino">
                    <BellRing className="w-3.5 h-3.5" />
                    <Input type="date" className="h-7 w-36 text-xs" value={p.lembrar_em ?? ""} min={inDays(0)}
                      onChange={(e) => setProc(p, { lembrar_em: e.target.value })} />
                  </label>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
