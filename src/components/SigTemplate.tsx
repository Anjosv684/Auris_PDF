import { useEffect, useState } from "react";
import { loadMeasure, TEMPLATES, templateById, type FontKey, type Measure, type RGB, type SigData } from "../lib/sigtemplates";

export function useMeasure() {
  const [m, setM] = useState<Measure | null>(null);
  useEffect(() => { loadMeasure().then((f) => setM(() => f)); }, []);
  return m;
}

const FAMILY: Record<FontKey, { family: string; weight: number; style: string }> = {
  H: { family: "Helvetica, Arial, sans-serif", weight: 400, style: "normal" },
  HB: { family: "Helvetica, Arial, sans-serif", weight: 700, style: "normal" },
  HI: { family: "Helvetica, Arial, sans-serif", weight: 400, style: "italic" },
  T: { family: "'Times New Roman', Times, serif", weight: 400, style: "normal" },
  TB: { family: "'Times New Roman', Times, serif", weight: 700, style: "normal" },
  TI: { family: "'Times New Roman', Times, serif", weight: 400, style: "italic" },
};
const col = (c: RGB) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

/** Desenha o quadro do modelo em SVG, com as mesmas medidas que vão para o PDF. */
export function SigSvg({ tpl, w, h, data, img, m, className }: { tpl: string; w: number; h: number; data: SigData; img?: string | null; m: Measure; className?: string }) {
  const prims = templateById(tpl).draw(w, h, { ...data, img: img ? data.img : undefined }, m);
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height="100%">
      {prims.map((p, i) => {
        if (p.k === "rect") return <rect key={i} x={p.x} y={h - p.y - p.h} width={p.w} height={p.h} fill={p.fill ? col(p.fill) : "none"} stroke={p.stroke ? col(p.stroke) : undefined} strokeWidth={p.lw} />;
        if (p.k === "path") {
          const pts = p.pts.map(([x, y]) => `${x},${h - y}`).join(" ");
          return p.close
            ? <polygon key={i} points={pts} fill={p.fill ? col(p.fill) : "none"} stroke={p.stroke ? col(p.stroke) : undefined} strokeWidth={p.lw} />
            : <polyline key={i} points={pts} fill="none" stroke={p.stroke ? col(p.stroke) : undefined} strokeWidth={p.lw} strokeLinecap="round" strokeLinejoin="round" />;
        }
        if (p.k === "img") return img ? <image key={i} href={img} x={p.x} y={h - p.y - p.h} width={p.w} height={p.h} preserveAspectRatio="none" /> : null;
        const f = FAMILY[p.f];
        return (
          <text key={i} x={p.x} y={h - p.y} fontSize={p.size} fill={col(p.c)} fontFamily={f.family} fontWeight={f.weight} fontStyle={f.style}
            textLength={m(p.t, p.f, p.size)} lengthAdjust="spacingAndGlyphs" style={{ whiteSpace: "pre" }}>{p.t}</text>
        );
      })}
    </svg>
  );
}

/** Grade com os 10 modelos; o escolhido vira o padrão. */
export function TemplatePicker({ value, onPick, data, img }: { value: string; onPick: (id: string) => void; data: SigData; img?: string | null }) {
  const m = useMeasure();
  if (!m) return null;
  return (
    <div className="tpl-grid">
      {TEMPLATES.map((t) => (
        <button key={t.id} className={`tpl ${value === t.id ? "on" : ""}`} onClick={() => onPick(t.id)} title={`Usar o modelo “${t.label}”`}>
          <div className="tpl-art" style={{ aspectRatio: `${t.size[0]} / ${t.size[1]}` }}>
            <SigSvg tpl={t.id} w={t.size[0]} h={t.size[1]} data={data} img={img} m={m} />
          </div>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
