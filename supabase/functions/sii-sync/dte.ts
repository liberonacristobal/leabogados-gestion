// dte.ts — construcción del DTE chileno: totales, <Documento> y timbre <TED>.
//
// Emite XML en forma CANÓNICA por construcción (UTF-8, sin whitespace entre tags, comillas
// dobles), igual que auth.ts, para que el digest de la firma sea determinista. Este módulo
// arma el <Documento> SIN firmar (la firma XMLDSig la pone firma.ts) y el timbre <TED>
// (que sí se firma aquí con la llave del CAF — es una firma RSA-SHA1 simple sobre el <DD>).
//
// OJO money-crítico — supuesto de montos a CONFIRMAR contra `billing`:
//   - DTE 34 (exenta): el monto de cada ítem es EXENTO; total = suma de ítems, sin IVA.
//   - DTE 33 (afecta): el monto de cada ítem se asume NETO; IVA 19% se calcula sobre el neto.
// Si en `billing` el monto guardado ya incluye IVA, hay que invertir el cálculo. Lo alineamos
// con tus datos reales antes de certificar.

import { CafParsed, firmarTED } from './caf.ts'

export interface Emisor { rut: string; rs: string; giro: string; acteco: string; dir: string; comuna: string; ciudad?: string }
export interface Receptor { rut: string; rs: string; giro?: string; dir?: string; comuna?: string; ciudad?: string }
export interface ItemDTE { nombre: string; desc?: string; qty?: number; precio?: number; monto: number }
export interface FacturaInput {
  tipoDte: number
  folio: number
  fecha: string                 // YYYY-MM-DD
  emisor: Emisor
  receptor: Receptor
  items: ItemDTE[]
  fmaPago?: '1' | '2' | '3'     // 1 contado · 2 crédito · 3 sin costo
}

const IVA = 0.19
// El DTE no admite & < > en texto (rompe el XML y la firma): se sanean a vacío/espacio.
const t = (s: unknown) => String(s ?? '').replace(/[<>&]/g, ' ').replace(/\s+/g, ' ').trim()
// RUT al formato SII: sin puntos, con guion, DV en mayúscula. 76543210-9
const rut = (r: unknown) => String(r ?? '').replace(/\./g, '').replace(/\s/g, '').toUpperCase()
const n = (v: unknown) => Math.round(Number(v) || 0)

export interface Totales { exento: number; neto: number; iva: number; total: number }

export function calcularTotales(tipoDte: number, items: ItemDTE[]): Totales {
  const suma = items.reduce((a, i) => a + n(i.monto), 0)
  if (tipoDte === 34) return { exento: suma, neto: 0, iva: 0, total: suma }
  const neto = suma
  const iva = n(neto * IVA)
  return { exento: 0, neto, iva, total: neto + iva }
}

// Timestamp local de Chile sin zona (YYYY-MM-DDTHH:mm:ss). El SII lo espera así en TmstFirma/TSTED.
function tstamp(nowIso: string): string {
  // nowIso viene del llamador (no usamos Date() acá para mantener pureza/testabilidad).
  return nowIso.slice(0, 19)
}

// Construye el timbre <TED>: arma el <DD> (canónico), lo firma con la llave del CAF y devuelve el <TED> completo.
function construirTED(f: FacturaInput, tot: Totales, caf: CafParsed, nowIso: string): string {
  const it1 = t(f.items[0]?.nombre || '')
  const dd =
    `<DD>` +
    `<RE>${rut(f.emisor.rut)}</RE>` +
    `<TD>${f.tipoDte}</TD>` +
    `<F>${f.folio}</F>` +
    `<FE>${f.fecha}</FE>` +
    `<RR>${rut(f.receptor.rut)}</RR>` +
    `<RSR>${t(f.receptor.rs).slice(0, 40)}</RSR>` +
    `<MNT>${tot.total}</MNT>` +
    `<IT1>${it1.slice(0, 40)}</IT1>` +
    caf.cafXml +
    `<TSTED>${tstamp(nowIso)}</TSTED>` +
    `</DD>`
  const frmt = firmarTED(dd, caf.rsask)
  return `<TED version="1.0">${dd}<FRMT algoritmo="SHA1withRSA">${frmt}</FRMT></TED>`
}

// Arma el <Documento> COMPLETO pero SIN la firma XMLDSig (esa la agrega firma.ts).
// Devuelve { documento, docId, total } para que firma.ts referencie el ID y emision.ts arme el sobre.
export function armarDocumento(f: FacturaInput, caf: CafParsed, nowIso: string): { documento: string; docId: string; tot: Totales } {
  if (f.tipoDte !== caf.tipoDte) throw new Error(`El CAF es para DTE ${caf.tipoDte}, no para ${f.tipoDte}`)
  if (f.folio < caf.desde || f.folio > caf.hasta) throw new Error(`Folio ${f.folio} fuera del rango del CAF (${caf.desde}–${caf.hasta})`)

  const tot = calcularTotales(f.tipoDte, f.items)
  const docId = `F${f.folio}T${f.tipoDte}`

  const idDoc =
    `<IdDoc>` +
    `<TipoDTE>${f.tipoDte}</TipoDTE>` +
    `<Folio>${f.folio}</Folio>` +
    `<FchEmis>${f.fecha}</FchEmis>` +
    `<FmaPago>${f.fmaPago || '1'}</FmaPago>` +
    `</IdDoc>`

  const emisor =
    `<Emisor>` +
    `<RUTEmisor>${rut(f.emisor.rut)}</RUTEmisor>` +
    `<RznSoc>${t(f.emisor.rs).slice(0, 100)}</RznSoc>` +
    `<GiroEmis>${t(f.emisor.giro).slice(0, 80)}</GiroEmis>` +
    `<Acteco>${t(f.emisor.acteco)}</Acteco>` +
    `<DirOrigen>${t(f.emisor.dir).slice(0, 70)}</DirOrigen>` +
    `<CmnaOrigen>${t(f.emisor.comuna).slice(0, 20)}</CmnaOrigen>` +
    `</Emisor>`

  const receptor =
    `<Receptor>` +
    `<RUTRecep>${rut(f.receptor.rut)}</RUTRecep>` +
    `<RznSocRecep>${t(f.receptor.rs).slice(0, 100)}</RznSocRecep>` +
    (f.receptor.giro ? `<GiroRecep>${t(f.receptor.giro).slice(0, 40)}</GiroRecep>` : '') +
    (f.receptor.dir ? `<DirRecep>${t(f.receptor.dir).slice(0, 70)}</DirRecep>` : '') +
    (f.receptor.comuna ? `<CmnaRecep>${t(f.receptor.comuna).slice(0, 20)}</CmnaRecep>` : '') +
    `</Receptor>`

  const totales =
    `<Totales>` +
    (tot.neto ? `<MntNeto>${tot.neto}</MntNeto>` : '') +
    (tot.exento ? `<MntExe>${tot.exento}</MntExe>` : '') +
    (tot.iva ? `<TasaIVA>19</TasaIVA><IVA>${tot.iva}</IVA>` : '') +
    `<MntTotal>${tot.total}</MntTotal>` +
    `</Totales>`

  const detalle = f.items.map((i, idx) =>
    `<Detalle>` +
    `<NroLinDet>${idx + 1}</NroLinDet>` +
    `<NmbItem>${t(i.nombre).slice(0, 80)}</NmbItem>` +
    (i.desc ? `<DscItem>${t(i.desc).slice(0, 1000)}</DscItem>` : '') +
    (i.qty != null ? `<QtyItem>${n(i.qty)}</QtyItem>` : '') +
    (i.precio != null ? `<PrcItem>${n(i.precio)}</PrcItem>` : '') +
    (f.tipoDte === 34 ? `<IndExe>1</IndExe>` : '') +
    `<MontoItem>${n(i.monto)}</MontoItem>` +
    `</Detalle>`
  ).join('')

  const ted = construirTED(f, tot, caf, nowIso)

  const documento =
    `<Documento ID="${docId}">` +
    `<Encabezado>${idDoc}${emisor}${receptor}${totales}</Encabezado>` +
    detalle +
    ted +
    `<TmstFirma>${tstamp(nowIso)}</TmstFirma>` +
    `</Documento>`

  return { documento, docId, tot }
}
