import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/** Horário de atendimento: dia da semana ("0" = domingo) → faixas. Mesmo formato de settings.business_hours. */
export type Hours = Record<string, { start: string; end: string }[]>;
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export const hoursValid = (h: Hours) => Object.values(h).flat().every((s) => s.start && s.end && s.start < s.end);

/** Liga/desliga cada dia e ajusta início e fim (uma faixa por dia). */
export function HoursEditor({ value, onChange }: { value: Hours; onChange: (h: Hours) => void }) {
  const setDay = (d: number, slot: { start: string; end: string } | null) => onChange({ ...value, [String(d)]: slot ? [slot] : [] });
  return (
    <div className="space-y-2">
      {WEEKDAYS.map((w, d) => {
        const slot = value[String(d)]?.[0] ?? null;
        return (
          <div key={d} className="flex flex-wrap items-center gap-2">
            <Switch checked={!!slot} onCheckedChange={(on) => setDay(d, on ? { start: "08:00", end: "18:00" } : null)} />
            <span className="w-20 text-sm">{w}</span>
            {slot ? (
              <>
                <Input type="time" className="w-28" value={slot.start} onChange={(e) => setDay(d, { ...slot, start: e.target.value })} />
                <span className="text-sm">às</span>
                <Input type="time" className="w-28" value={slot.end} onChange={(e) => setDay(d, { ...slot, end: e.target.value })} />
              </>
            ) : <span className="text-sm text-muted-foreground">Fechado</span>}
          </div>
        );
      })}
    </div>
  );
}
