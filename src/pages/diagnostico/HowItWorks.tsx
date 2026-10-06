import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openGuide } from "@/guides/types";

/** "Como funciona": reabre o passo a passo da tela (os guias moram em src/guides/registry.tsx). */
export function HowItWorks({ guide = "diagnostico", className = "w-full justify-start" }: { guide?: string; className?: string }) {
  return (
    <Button type="button" size="sm" variant="ghost" className={className} onClick={() => openGuide(guide)}>
      <HelpCircle className="w-4 h-4 mr-2" /> Como funciona
    </Button>
  );
}
