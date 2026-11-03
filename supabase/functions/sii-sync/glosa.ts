// glosa.ts — la glosa de una factura emitida (NmbItem + DscItem del XML) para el motor de calce (_shared/facturacionReglas.js).
// Al bajar un XML se guarda en sii_cargas_docs.glosa (donde el cotejo y el registro automático la leen) y, si la factura la asignó solo el
// motor a una cuota y la glosa contradice a la cuota (otro N° de cuota u otro mes), se deja un aviso en la bitácora para revisarla.
// deno-lint-ignore-file no-explicit-any
import { glosaContradice } from '../_shared/facturacionReglas.js'

const decodificar = (t: string) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")

/** Glosa del documento: por cada detalle, nombre y descripción del ítem, separados por « · ». */
export function glosaDeXml(xml: string): string {
  const out: string[] = []
  for (const m of String(xml || '').matchAll(/<Detalle>([\s\S]*?)<\/Detalle>/g)) {
    const nmb = m[1].match(/<NmbItem>([\s\S]*?)<\/NmbItem>/)?.[1] || '', dsc = m[1].match(/<DscItem>([\s\S]*?)<\/DscItem>/)?.[1] || ''
    const t = decodificar([nmb, dsc].map((x) => x.trim()).filter(Boolean).join(' '))
    if (t) out.push(t.replace(/\s+/g, ' '))
  }
  return out.join(' · ').slice(0, 600)
}

export async function guardarYRevisarGlosa(sb: any, billingId: string, folio: string, xml: string): Promise<void> {
  const glosa = glosaDeXml(xml)
  if (!glosa) return
  await sb.from('sii_cargas_docs').update({ glosa, updated_at: new Date().toISOString() }).eq('folio', String(folio)).is('glosa', null)
  const { data: b } = await sb.from('billing').select('id,concept,sale_id,invoice_no').eq('id', billingId).maybeSingle()
  if (!b?.sale_id || !b.concept) return
  const { data: log } = await sb.from('activity_log').select('id').eq('record_id', billingId).in('action', ['facturacion.asignada_auto', 'facturacion.registrada_auto']).limit(1)
  if (!log?.length || !glosaContradice(glosa, b.concept)) return
  await sb.from('activity_log').insert({ user_email: 'cotejo', action: 'facturacion.glosa_no_coincide', table_name: 'billing', record_id: billingId, estudio_id: 'lea',
    detail: { title: `Factura N° ${folio}: la glosa no coincide con la cuota asignada «${b.concept}»`, folio: String(folio), glosa, concepto: b.concept } })
}
