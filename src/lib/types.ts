// Objetos desenhados por cima das páginas. Coordenadas em pontos PDF
// no espaço de visualização da página (escala 1, origem no canto superior esquerdo).
export type ObjBase = {
  id: string;
  page: number; // índice 0
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
};

export type ImageObj = ObjBase & { type: "image"; src: string; ratio: number };
export type ShapeObj = ObjBase & {
  type: "rect" | "ellipse";
  stroke: string;
  fill: string | null;
  strokeWidth: number;
};
export type HighlightObj = ObjBase & { type: "highlight"; color: string };
export type LineObj = ObjBase & {
  type: "line";
  stroke: string;
  strokeWidth: number;
  dir: 0 | 1; // 0: ↘   1: ↗
  arrow: boolean;
  rev: boolean; // seta no início
};
export type InkObj = ObjBase & {
  type: "ink";
  stroke: string;
  strokeWidth: number;
  points: number[][]; // traços com pontos normalizados [x0,y0,x1,y1...] (0..1)
};
export type TextObj = ObjBase & {
  type: "text";
  text: string;
  size: number;
  color: string;
  bold: boolean;
  bg: string | null;
};
export type StampObj = ObjBase & { type: "stamp"; label: string; color: string; date: string };
export type SigFieldObj = ObjBase & { type: "sigfield" };

export type Obj = ImageObj | ShapeObj | HighlightObj | LineObj | InkObj | TextObj | StampObj | SigFieldObj;
export type ObjType = Obj["type"];

export type Tool =
  | "select"
  | "hand"
  | "highlight"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "ink"
  | "text"
  | "edittext";

export type Tab = {
  id: string;
  name: string;
  path?: string;
  bytes: Uint8Array;
  version: number; // muda quando os bytes são substituídos
  objects: Obj[];
  past: { objects: Obj[]; bytes?: Uint8Array }[];
  future: { objects: Obj[]; bytes?: Uint8Array }[];
  dirty: boolean;
  page: number; // página atual (1..n)
  pageCount: number;
  formDirty: boolean;
};

export type CertInfo = {
  subject: string;
  issuer: string;
  thumbprint: string;
  notAfter: string;
  der: string; // base64
};
