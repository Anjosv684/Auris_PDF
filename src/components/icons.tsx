// Ícones de função do Auris PDF: um único mapa (Lucide, outline) usado em toda a interface.
import {
  Combine, Scissors, Minimize2, FileSignature, Signature, LayoutGrid, Images, Printer, Stamp, ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export const FEATURE_ICONS = {
  juntar: Combine,
  dividir: Scissors,
  comprimir: Minimize2,
  "assinatura-digital": FileSignature,
  "assinatura-manuscrita": Signature,
  organizar: LayoutGrid,
  "imagens-pdf": Images,
  imprimir: Printer,
  carimbo: Stamp,
  verificar: ShieldCheck,
} satisfies Record<string, LucideIcon>;

export type Feature = keyof typeof FEATURE_ICONS;

export function FeatureIcon({ n, size = 17, className }: { n: Feature; size?: number; className?: string }) {
  const I = FEATURE_ICONS[n];
  return <I size={size} className={className} aria-hidden />;
}
