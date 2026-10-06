import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openGuide } from "@/guides/types";

/** "Como funciona": reabre o passo a passo do Diagnóstico (o guia mora em src/guides/registry.tsx). */
export function HowItWorks() {
  return (
    <Button type="button" size="sm" variant="ghost" className="w-full justify-start" onClick={() => openGuide("diagnostico")}>
      <HelpCircle className="w-4 h-4 mr-2" /> Como funciona
    </Button>
  );
}
