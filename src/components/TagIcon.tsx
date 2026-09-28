import {
  AlertTriangle, Ban, Briefcase, Building2, Clock, Crown, DollarSign, Flag, Gift, Heart, Package, ShoppingCart, Star,
  Tag, Truck, User, Users, Wrench, type LucideIcon,
} from "lucide-react";

/** Ícones que etiquetas e grupos podem usar (a lista do banco aceita só estas chaves). */
export const TAG_ICONS: Record<string, LucideIcon> = {
  tag: Tag, star: Star, crown: Crown, heart: Heart, gift: Gift, "dollar-sign": DollarSign, "shopping-cart": ShoppingCart,
  package: Package, truck: Truck, wrench: Wrench, briefcase: Briefcase, building: Building2, user: User, users: Users,
  clock: Clock, flag: Flag, "alert-triangle": AlertTriangle, ban: Ban,
};

export function TagIcon({ icon, className = "w-3 h-3", color }: { icon?: string | null; className?: string; color?: string | null }) {
  const Icon = icon ? TAG_ICONS[icon] : null;
  return Icon ? <Icon className={`${className} shrink-0`} style={color ? { color } : undefined} /> : null;
}
