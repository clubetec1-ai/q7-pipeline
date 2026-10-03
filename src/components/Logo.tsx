/**
 * Marca "Deixa com a IA" (uma solução Clubetec): "Deixa com a" em azul-petróleo (branco
 * no tema escuro) e o "IA" num balão de conversa verde com três pontinhos (a IA pensando).
 * Cores da marca: verde #22C1A4, azul-petróleo #215371, marinho #0B1E3D.
 */
interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
  showTitle?: boolean;
  iconSize?: number;
  /** Compact inline layout (icon + wordmark on one line). Use in headers/navbars. */
  horizontal?: boolean;
}

const WORD = "font-black italic tracking-tight leading-none text-[#215371] dark:text-white";
const FONT = { fontFamily: "Montserrat, Inter, system-ui, sans-serif" };

/** O balão com "IA": o símbolo da marca (ícone do app, aba do navegador e logo). */
export const BrandIcon = ({ size = 32, className = "" }: { size?: number; className?: string }) => (
  <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
    <path d="M10 4h44a8 8 0 0 1 8 8v30a8 8 0 0 1-8 8H27L13 61l3-11h-6a8 8 0 0 1-8-8V12a8 8 0 0 1 8-8z" fill="#22C1A4" />
    <circle cx="43" cy="12" r="2.4" fill="#fff" /><circle cx="49" cy="12" r="2.4" fill="#fff" /><circle cx="55" cy="12" r="2.4" fill="#fff" />
    <text x="32" y="38" textAnchor="middle" fontSize="25" fontWeight="900" fontStyle="italic" fill="#fff" style={FONT}>IA</text>
  </svg>
);

export const Logo = ({
  iconSize = 96,
  className = "",
  showTitle = true,
  width,
  height,
  horizontal = false,
}: LogoProps) => {
  const size = width ?? height ?? iconSize;

  if (horizontal) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`} aria-label="Deixa com a IA">
        {showTitle && <span className={`${WORD} text-base sm:text-lg whitespace-nowrap`} style={FONT}>Deixa com a</span>}
        <BrandIcon size={Math.round(size * 1.15)} className="shrink-0" />
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`} aria-label="Deixa com a IA">
      {showTitle && <span className={`${WORD} text-4xl`} style={FONT}>Deixa com a</span>}
      <BrandIcon size={size} />
      {showTitle && (
        <span className="text-xs font-semibold italic text-muted-foreground" style={FONT}>
          uma solução <span className="text-[#22C1A4]">Clubetec</span>
        </span>
      )}
    </div>
  );
};
