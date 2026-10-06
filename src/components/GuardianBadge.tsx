import { Badge } from "@/components/ui/badge";

export interface GuardianReview { subject_id: string; status: "aprovado" | "atencao" | "reprovado"; findings: { regra: string; gravidade: string; texto: string; onde: string }[] }
const G_STYLE: Record<GuardianReview["status"], { label: string; cls: string }> = {
  aprovado: { label: "🛡️ Guardião: aprovado", cls: "bg-success-soft text-success-text" },
  atencao: { label: "🛡️ Guardião: atenção", cls: "bg-warning-soft text-warning-text" },
  reprovado: { label: "🛡️ Guardião: reprovado", cls: "bg-danger-soft text-danger-text" },
};
/** Selo do Guardião de segurança e LGPD (desenho 07, fatia 5). */
export function GuardianBadge({ review }: { review?: GuardianReview }) {
  if (!review) return <Badge variant="outline">🛡️ Aguardando o Guardião</Badge>;
  return <Badge className={G_STYLE[review.status].cls}>{G_STYLE[review.status].label}</Badge>;
}
export function GuardianFindings({ review }: { review?: GuardianReview }) {
  if (!review?.findings.length) return null;
  return (
    <ul data-demo="guardiao" className="space-y-1 rounded-md border p-2 text-xs">
      {review.findings.map((f, i) => (
        <li key={i} className={f.gravidade === "bloqueia" ? "text-danger-text" : "text-warning-text"}>
          {f.gravidade === "bloqueia" ? "⛔ Bloqueia" : "⚠️ Atenção"}{f.onde ? ` (${f.onde})` : ""}: {f.texto}
        </li>
      ))}
    </ul>
  );
}
