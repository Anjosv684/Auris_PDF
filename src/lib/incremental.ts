// Salvamento incremental: acrescenta ao final do PDF original apenas os objetos
// novos/alterados. Necessário para não invalidar assinaturas digitais existentes.
import { PDFDocument, PDFObject, PDFRef, PDFName, PDFNumber, PDFDict } from "pdf-lib";

const enc = new TextEncoder();

export type Snapshot = Map<string, string>;

function serialize(obj: PDFObject): Uint8Array {
  const b = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(b, 0);
  return b;
}

function fingerprint(b: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i], 0x01000193);
    h2 = Math.imul(h2 + b[i], 0x5bd1e995) ^ (h2 >>> 15);
  }
  return `${b.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

const key = (r: PDFRef) => `${r.objectNumber} ${r.generationNumber}`;

export function snapshot(doc: PDFDocument): Snapshot {
  const m: Snapshot = new Map();
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) m.set(key(ref), fingerprint(serialize(obj)));
  return m;
}

export function hasSignatures(bytes: Uint8Array): boolean {
  // busca rápida por /ByteRange no arquivo
  const needle = enc.encode("/ByteRange");
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

export function lastStartXref(bytes: Uint8Array): number {
  const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  const m = [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!m) throw new Error("PDF sem tabela de referências (startxref).");
  return parseInt(m[1]);
}

function previousSize(bytes: Uint8Array): number {
  const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 65536)));
  const all = [...tail.matchAll(/\/Size\s+(\d+)/g)];
  return all.length ? parseInt(all[all.length - 1][1]) : 0;
}

export async function incrementalSave(doc: PDFDocument, original: Uint8Array, snap: Snapshot): Promise<Uint8Array> {
  await doc.flush();
  const changed: [PDFRef, Uint8Array][] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const bytes = serialize(obj);
    if (snap.get(key(ref)) !== fingerprint(bytes)) changed.push([ref, bytes]);
  }
  changed.sort((a, b) => a[0].objectNumber - b[0].objectNumber);

  const parts: Uint8Array[] = [original];
  let offset = original.length;
  const push = (b: Uint8Array) => {
    parts.push(b);
    offset += b.length;
  };
  if (original[original.length - 1] !== 0x0a) push(enc.encode("\n"));

  const offsets = new Map<number, [number, number]>();
  for (const [ref, bytes] of changed) {
    offsets.set(ref.objectNumber, [offset, ref.generationNumber]);
    push(enc.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    push(bytes);
    push(enc.encode("\nendobj\n"));
  }

  const xrefOffset = offset;
  let xref = "xref\n";
  const nums = [...offsets.keys()];
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    xref += `${nums[i]} ${j - i + 1}\n`;
    for (let k = i; k <= j; k++) {
      const [off, gen] = offsets.get(nums[k])!;
      xref += `${String(off).padStart(10, "0")} ${String(gen).padStart(5, "0")} n\r\n`;
    }
    i = j + 1;
  }
  push(enc.encode(xref));

  const ti = doc.context.trailerInfo;
  const trailer = PDFDict.withContext(doc.context);
  trailer.set(PDFName.of("Size"), PDFNumber.of(Math.max(doc.context.largestObjectNumber + 1, previousSize(original))));
  if (ti.Root) trailer.set(PDFName.of("Root"), ti.Root);
  if (ti.Info) trailer.set(PDFName.of("Info"), ti.Info);
  if (ti.ID) trailer.set(PDFName.of("ID"), ti.ID);
  trailer.set(PDFName.of("Prev"), PDFNumber.of(lastStartXref(original)));
  push(enc.encode("trailer\n"));
  push(serialize(trailer));
  push(enc.encode(`\nstartxref\n${xrefOffset}\n%%EOF\n`));

  const out = new Uint8Array(offset);
  let p = 0;
  for (const b of parts) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
