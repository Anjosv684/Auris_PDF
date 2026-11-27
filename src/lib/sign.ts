// Assinatura digital PAdES (ETSI.CAdES.detached) com certificado ICP-Brasil.
// A1: arquivo .pfx (assinado aqui mesmo). A3/instalado: repositório do Windows via app.
import forge from "node-forge";
import {
  PDFDocument, PDFName, PDFHexString, PDFString, PDFNumber, PDFDict, PDFArray, PDFRef, StandardFonts,
  pushGraphicsState, popGraphicsState, setFillingRgbColor, setStrokingRgbColor, rectangle, fill, stroke,
  setLineWidth, beginText, endText, setFontAndSize, moveText, showText, type PDFFont,
} from "pdf-lib";
import { binaryToBytes, bytesToBinary, bytesToB64 } from "./util";
import { hasSignatures, incrementalSave, snapshot } from "./incremental";
import { loadForEdit, sanitize } from "./pdfcore";
import { signWithStore } from "./platform";
import type { CertInfo } from "./types";

const asn1 = forge.asn1;
const C = asn1.Class, T = asn1.Type;
type Asn = forge.asn1.Asn1;
const seq = (v: Asn[]) => asn1.create(C.UNIVERSAL, T.SEQUENCE, true, v);
const set = (v: Asn[]) => asn1.create(C.UNIVERSAL, T.SET, true, v);
const oid = (o: string) => asn1.create(C.UNIVERSAL, T.OID, false, asn1.oidToDer(o).getBytes());
const octet = (b: string) => asn1.create(C.UNIVERSAL, T.OCTETSTRING, false, b);
const nul = () => asn1.create(C.UNIVERSAL, T.NULL, false, "");
const int = (n: number) => asn1.create(C.UNIVERSAL, T.INTEGER, false, asn1.integerToDer(n).getBytes());
const ctxTag = (n: number, v: Asn[]) => asn1.create(C.CONTEXT_SPECIFIC, n, true, v);
const der = (a: Asn) => asn1.toDer(a).getBytes();

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  signingCertV2: "1.2.840.113549.1.9.16.2.47",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsa: "1.2.840.113549.1.1.1",
};

async function sha256(data: Uint8Array | string): Promise<string> {
  const b = typeof data === "string" ? binaryToBytes(data) : data;
  return bytesToBinary(new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource)));
}

function certParts(certDerBin: string) {
  const a = asn1.fromDer(certDerBin);
  const tbs = (a.value as Asn[])[0].value as Asn[];
  const i = tbs[0].tagClass === C.CONTEXT_SPECIFIC ? 1 : 0;
  return { asn: a, serial: tbs[i], issuer: tbs[i + 2] };
}

/** Atributo ESS signing-certificate-v2 (exigido pelo PAdES). */
export async function essAttrValue(certDerBin: string): Promise<Asn> {
  const { issuer, serial } = certParts(certDerBin);
  return seq([seq([seq([octet(await sha256(certDerBin)), seq([seq([ctxTag(4, [issuer])]), serial])])])]);
}

// ---------------------------------------------------------------- certificado
export type CertSummary = {
  name: string;
  doc?: string; // CPF/CNPJ
  issuer: string;
  validTo: Date;
  validFrom: Date;
  icp: boolean;
};

export function describeCert(cert: forge.pki.Certificate, chain: forge.pki.Certificate[] = []): CertSummary {
  const cn = (cert.subject.getField("CN")?.value as string) || "";
  const [name, doc] = cn.includes(":") ? cn.split(":") : [cn, undefined];
  const all = [cert, ...chain];
  const icp = all.some((c) => /ICP-Brasil/i.test(JSON.stringify(c.issuer.attributes.map((x) => x.value))));
  return {
    name: fixLatin(name.trim()),
    doc: doc?.trim(),
    issuer: fixLatin((cert.issuer.getField("CN")?.value as string) || ""),
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
    icp,
  };
}

// o forge devolve UTF8String como bytes; converte para texto
function fixLatin(s: string) {
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

export function certFromDer(derB64orBin: string, isB64 = true) {
  const bin = isB64 ? atob(derB64orBin) : derB64orBin;
  return forge.pki.certificateFromAsn1(asn1.fromDer(bin));
}

// ---------------------------------------------------------------- assinadores
export type Signer = {
  summary: CertSummary;
  /** recebe os bytes a assinar (ByteRange) e devolve o CMS DER */
  sign: (data: Uint8Array) => Promise<Uint8Array>;
};

export function signerFromPfx(pfx: Uint8Array, password: string): Signer {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1.fromDer(bytesToBinary(pfx)), false, password);
  } catch (e) {
    if (/mac|password|decrypt|Invalid/i.test(String(e))) throw new Error("Senha do certificado incorreta.");
    throw new Error("Não foi possível ler o certificado: " + (e as Error).message);
  }
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const key = keyBags.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new Error("O arquivo não contém chave privada RSA.");
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [])
    .map((b) => b.cert)
    .filter(Boolean) as forge.pki.Certificate[];
  const cert = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(key.n));
  if (!cert) throw new Error("Certificado correspondente à chave não encontrado no arquivo.");
  const chain = certs.filter((c) => c !== cert);
  const certBin = der(forge.pki.certificateToAsn1(cert));
  const chainBin = chain.map((c) => der(forge.pki.certificateToAsn1(c)));

  return {
    summary: describeCert(cert, chain),
    sign: async (data) => {
      const digest = await sha256(data);
      const attrs = [
        seq([oid(OID.contentType), set([oid(OID.data)])]),
        seq([oid(OID.messageDigest), set([octet(digest)])]),
        seq([oid(OID.signingCertV2), set([await essAttrValue(certBin)])]),
      ].sort((a, b) => (der(a) < der(b) ? -1 : 1)); // DER: SET OF ordenado
      const md = forge.md.sha256.create();
      md.update(der(set(attrs)));
      const signature = key.sign(md);
      const { issuer, serial } = certParts(certBin);
      const signerInfo = seq([
        int(1),
        seq([issuer, serial]),
        seq([oid(OID.sha256), nul()]),
        ctxTag(0, attrs),
        seq([oid(OID.rsa), nul()]),
        octet(signature),
      ]);
      const signedData = seq([
        int(1),
        set([seq([oid(OID.sha256), nul()])]),
        seq([oid(OID.data)]),
        ctxTag(0, [certBin, ...chainBin].map((c) => asn1.fromDer(c))),
        set([signerInfo]),
      ]);
      return binaryToBytes(der(seq([oid(OID.signedData), ctxTag(0, [signedData])])));
    },
  };
}

export function signerFromStore(c: CertInfo): Signer {
  const certBin = atob(c.der);
  const cert = certFromDer(certBin, false);
  return {
    summary: describeCert(cert),
    sign: async (data) => {
      const ess = bytesToB64(binaryToBytes(der(await essAttrValue(certBin))));
      return signWithStore(c.thumbprint, data, ess);
    },
  };
}

// ---------------------------------------------------------------- PAdES
const SIG_BYTES = 24000; // espaço reservado para o CMS (cadeia completa cabe com folga)
const BR_PLACEHOLDER = "**********";

export type SignOptions = {
  page: number; // índice 0
  rect: { x: number; y: number; w: number; h: number } | null; // espaço de visualização; null = invisível
  viewport: { rotation: number; convertToPdfPoint: (x: number, y: number) => number[] } | null;
  reason: string;
  location: string;
  showDoc: boolean;
};

function maskDoc(d?: string) {
  if (!d) return "";
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

function nowBR() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const tz = `${off >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR")} ${tz}`;
}

function appearance(doc: PDFDocument, w: number, h: number, rot: number, s: CertSummary, o: SignOptions, f1: PDFFont, f2: PDFFont) {
  const ops = [];
  const blue = [0.094, 0.373, 0.647] as const;
  ops.push(
    pushGraphicsState(), setFillingRgbColor(0.95, 0.97, 1), rectangle(0, 0, w, h), fill(), popGraphicsState(),
    pushGraphicsState(), setStrokingRgbColor(...blue), setLineWidth(0.8), rectangle(0.4, 0.4, w - 0.8, h - 0.8), stroke(), popGraphicsState(),
    pushGraphicsState(), setFillingRgbColor(...blue), rectangle(0, 0, Math.max(3, w * 0.015), h), fill(), popGraphicsState(),
  );
  const pad = Math.max(6, w * 0.035);
  const maxW = w - pad * 2;
  const lines: { t: string; f: PDFFont; k: number; c: readonly [number, number, number] }[] = [
    { t: "Assinado digitalmente por", f: f1, k: 0.8, c: [0.35, 0.4, 0.5] },
    { t: s.name || "Titular", f: f2, k: 1.15, c: [0.05, 0.1, 0.2] },
  ];
  if (o.showDoc && s.doc) lines.push({ t: (s.doc.length === 14 ? "CNPJ: " : "CPF: ") + maskDoc(s.doc), f: f1, k: 0.9, c: [0.15, 0.2, 0.3] });
  lines.push({ t: "Data: " + nowBR(), f: f1, k: 0.9, c: [0.15, 0.2, 0.3] });
  if (o.reason) lines.push({ t: "Motivo: " + o.reason, f: f1, k: 0.9, c: [0.15, 0.2, 0.3] });
  lines.push({ t: s.icp ? "Certificado ICP-Brasil • validar.iti.gov.br" : "Verifique em validar.iti.gov.br", f: f1, k: 0.75, c: blue });

  const totalK = lines.reduce((a, l) => a + l.k * 1.3, 0);
  let base = Math.min((h - pad * 1.2) / totalK, 11);
  let y = h - pad * 0.7;
  for (const l of lines) {
    const t = sanitize(l.f, l.t);
    let size = base * l.k;
    const tw = l.f.widthOfTextAtSize(t, size);
    if (tw > maxW) size *= maxW / tw;
    y -= base * l.k * 1.3;
    ops.push(
      beginText(), setFillingRgbColor(...l.c), setFontAndSize(l.f === f2 ? "F2" : "F1", size),
      moveText(pad + 2, y + base * l.k * 0.3), showText(l.f.encodeText(t)), endText(),
    );
  }
  const r = (rot * Math.PI) / 180;
  const cos = Math.round(Math.cos(r)), sin = Math.round(Math.sin(r));
  const stream = doc.context.formXObject(ops, {
    BBox: [0, 0, w, h],
    Matrix: [cos, sin, -sin, cos, 0, 0],
    Resources: { Font: { F1: f1.ref, F2: f2.ref } },
  });
  return doc.context.register(stream);
}

export async function signPdf(bytes: Uint8Array, signer: Signer, o: SignOptions): Promise<Uint8Array> {
  const incremental = hasSignatures(bytes);
  const doc = await loadForEdit(bytes);
  const snap = incremental ? snapshot(doc) : null;
  const ctx = doc.context;
  const N = (s: string) => PDFName.of(s);
  const page = doc.getPage(o.page);
  const s = signer.summary;

  // dicionário da assinatura com espaços reservados
  const sigDict = ctx.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "ETSI.CAdES.detached",
    ByteRange: [0, N(BR_PLACEHOLDER), N(BR_PLACEHOLDER), N(BR_PLACEHOLDER)],
    Contents: PDFHexString.of("0".repeat(SIG_BYTES * 2)),
    M: PDFString.fromDate(new Date()),
    Name: PDFHexString.fromText(s.name),
    ...(o.reason ? { Reason: PDFHexString.fromText(o.reason) } : {}),
    ...(o.location ? { Location: PDFHexString.fromText(o.location) } : {}),
    Prop_Build: { App: { Name: N("Auris PDF") } },
  });
  const sigRef = ctx.register(sigDict);

  // campo + widget
  let rect = [0, 0, 0, 0];
  let apRef: PDFRef | null = null;
  if (o.rect && o.viewport) {
    const { x, y, w, h } = o.rect;
    const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([a, b]) => o.viewport!.convertToPdfPoint(a, b));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const f1 = await doc.embedFont(StandardFonts.Helvetica);
    const f2 = await doc.embedFont(StandardFonts.HelveticaBold);
    apRef = appearance(doc, w, h, o.viewport.rotation, s, o, f1, f2);
  }

  const acroExisting = doc.catalog.lookupMaybe(N("AcroForm"), PDFDict);
  const acro = acroExisting ?? ctx.obj({});
  if (!acroExisting) doc.catalog.set(N("AcroForm"), ctx.register(acro));
  let fields = acro.lookupMaybe(N("Fields"), PDFArray);
  if (!fields) acro.set(N("Fields"), (fields = ctx.obj([])));
  let n = 1;
  const names = new Set(fields.asArray().map((r) => (ctx.lookup(r) as PDFDict)?.lookup?.(N("T"))?.toString() ?? ""));
  while ([...names].some((x) => x.includes(`Assinatura${n}`) || x.includes(PDFHexString.fromText(`Assinatura${n}`).toString()))) n++;

  const widget = ctx.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    Rect: rect,
    V: sigRef,
    T: PDFHexString.fromText(`Assinatura${n}`),
    F: 132,
    P: page.ref,
    ...(apRef ? { AP: { N: apRef } } : {}),
  });
  const widgetRef = ctx.register(widget);
  page.node.addAnnot(widgetRef);
  fields.push(widgetRef);
  acro.set(N("SigFlags"), PDFNumber.of(3));

  const out = snap ? await incrementalSave(doc, bytes, snap) : await doc.save({ useObjectStreams: false });

  // preenche ByteRange e Contents
  const text = new TextDecoder("latin1").decode(out);
  const brIdx = text.lastIndexOf(`/${BR_PLACEHOLDER}`);
  const brStart = text.lastIndexOf("[", brIdx);
  const brEnd = text.indexOf("]", brIdx);
  const ph = "<" + "0".repeat(SIG_BYTES * 2) + ">";
  const cStart = text.lastIndexOf(ph);
  if (brIdx < 0 || cStart < 0) throw new Error("Falha ao preparar a assinatura.");
  const cEnd = cStart + ph.length;
  const br = `[0 ${cStart} ${cEnd} ${out.length - cEnd}`;
  const slot = brEnd - brStart;
  if (br.length > slot) throw new Error("Falha ao calcular o ByteRange.");
  out.set(new TextEncoder().encode(br.padEnd(slot, " ")), brStart);

  const toSign = new Uint8Array(cStart + (out.length - cEnd));
  toSign.set(out.subarray(0, cStart), 0);
  toSign.set(out.subarray(cEnd), cStart);
  const cms = await signer.sign(toSign);
  const hex = Array.from(cms, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  if (hex.length > SIG_BYTES * 2) throw new Error("Assinatura maior que o espaço reservado.");
  out.set(new TextEncoder().encode(hex), cStart + 1);
  return out;
}

// ---------------------------------------------------------------- verificação
export type SigCheck = {
  name: string;
  doc?: string;
  issuer: string;
  icp: boolean;
  date?: Date;
  reason?: string;
  validFrom?: Date;
  validTo?: Date;
  intact: boolean; // hash confere
  cryptoOk: boolean | null; // assinatura RSA confere
  modifiedAfter: boolean; // houve alterações depois (ex.: outra assinatura)
  certExpiredAtSigning: boolean;
  error?: string;
};

function pdfDate(s?: string) {
  const m = s?.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?([Z+\-])?(\d{2})?'?(\d{2})?/);
  if (!m) return undefined;
  const [, Y, Mo, D, h = "0", mi = "0", se = "0", z, th = "0", tm = "0"] = m;
  const utc = Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +se);
  const off = z === "+" || z === "-" ? (z === "+" ? 1 : -1) * (+th * 60 + +tm) : 0;
  return new Date(utc - off * 60000);
}

export async function verifyPdf(bytes: Uint8Array): Promise<SigCheck[]> {
  const text = new TextDecoder("latin1").decode(bytes);
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const res: SigCheck[] = [];
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(text))) {
    const [a, b, c, d] = m.slice(1, 5).map(Number);
    const k = `${b}-${c}`;
    if (seen.has(k) || c + d > bytes.length || b >= c) continue;
    seen.add(k);
    const item: SigCheck = { name: "?", issuer: "", icp: false, intact: false, cryptoOk: null, modifiedAfter: c + d < bytes.length, certExpiredAtSigning: false };
    try {
      const hex = text.slice(b + 1, c - 1).replace(/[^0-9a-fA-F]/g, "");
      const bin = forge.util.hexToBytes(hex);
      const ci = (asn1.fromDer as unknown as (b: string, o: object) => Asn)(bin, { strict: false, parseAllBytes: false });
      const sd = ((ci.value as Asn[])[1].value as Asn[])[0].value as Asn[];
      const certsNode = sd.find((x) => x.tagClass === C.CONTEXT_SPECIFIC && x.type === 0);
      const certs = ((certsNode?.value as Asn[]) || []).map((x) => {
        try {
          return forge.pki.certificateFromAsn1(x);
        } catch {
          return null;
        }
      }).filter(Boolean) as forge.pki.Certificate[];
      const si = ((sd[sd.length - 1].value as Asn[])[0].value as Asn[]);
      const sid = si[1].value as Asn[];
      const serialHex = forge.util.bytesToHex((sid[1]?.value as string) || "").replace(/^0+/, "");
      const cert = certs.find((x) => x.serialNumber.replace(/^0+/, "").toLowerCase() === serialHex.toLowerCase()) || certs[0];
      const signedAttrs = si.find((x) => x.tagClass === C.CONTEXT_SPECIFIC && x.type === 0);

      // conteúdo assinado
      const data = new Uint8Array(b + d);
      data.set(bytes.subarray(a, a + b), 0);
      data.set(bytes.subarray(c, c + d), b);
      const digAlg = asn1.derToOid((si[2].value as Asn[])[0].value as string);
      const algName = ({ "2.16.840.1.101.3.4.2.1": "SHA-256", "2.16.840.1.101.3.4.2.3": "SHA-512", "2.16.840.1.101.3.4.2.2": "SHA-384", "1.3.14.3.2.26": "SHA-1" } as Record<string, string>)[digAlg] || "SHA-256";
      const digest = bytesToBinary(new Uint8Array(await crypto.subtle.digest(algName, data as BufferSource)));

      if (signedAttrs) {
        const attrs = signedAttrs.value as Asn[];
        for (const at of attrs) {
          const t = asn1.derToOid((at.value as Asn[])[0].value as string);
          const v = ((at.value as Asn[])[1].value as Asn[])[0];
          if (t === OID.messageDigest) item.intact = v.value === digest;
          if (t === OID.signingTime) {
            try {
              item.date = v.type === T.UTCTIME ? asn1.utcTimeToDate(v.value as string) : asn1.generalizedTimeToDate(v.value as string);
            } catch { /* ignore */ }
          }
        }
        if (cert) {
          const mdName = algName.replace("-", "").toLowerCase() as "sha256";
          const md = (forge.md as unknown as Record<string, { create: () => forge.md.MessageDigest }>)[mdName]?.create();
          if (md) {
            md.update(der(set(attrs)));
            try {
              item.cryptoOk = (cert.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().bytes(), si[si.length - 1].value as string);
            } catch {
              item.cryptoOk = false;
            }
          }
        }
      } else item.intact = false;

      // dados do dicionário /Sig próximos
      const win = text.slice(Math.max(0, a + b - 3000), b) + text.slice(c, Math.min(text.length, c + 3000));
      if (!item.date) item.date = pdfDate(win.match(/\/M\s*\((D:[^)]+)\)/)?.[1]);
      const rs = win.match(/\/Reason\s*\(([^)]*)\)/)?.[1];
      if (rs) item.reason = rs;
      if (cert) {
        const sum = describeCert(cert, certs.filter((x) => x !== cert));
        Object.assign(item, { name: sum.name, doc: sum.doc, issuer: sum.issuer, icp: sum.icp, validFrom: sum.validFrom, validTo: sum.validTo });
        if (item.date) item.certExpiredAtSigning = item.date > sum.validTo || item.date < sum.validFrom;
      }
    } catch (e) {
      item.error = "Não foi possível ler esta assinatura: " + (e as Error).message;
    }
    res.push(item);
  }
  return res;
}
