// match.ts — conciliacion RCV <-> billing.
//
// REGLA DE ORO: esta funcion NUNCA borra ni crea registros en billing.
// Solo actualiza Programada -> Pendiente cuando el match es UNICO.
//
// Resolucion del RUT esperado de una cuota programada (hallazgo del diagnostico:
// receptor_rut suele venir null en las Programadas, la RS se asigna al emitir):
//   receptor_rut -> client_entities.rut (via entity_id) -> clients.rut
//
// Criterio de match (todo debe cumplirse):
//   - RUT normalizado coincide (sin puntos, con guion, DV mayuscula)
//   - monto con tolerancia +-1% (redondeos de UF), minimo $1
//   - due dentro del mismo mes consultado (periodo)
//
// Requiere columnas sii_synced_at y sii_tipo_dte en billing (ALTER TABLE aprobado).

// deno-lint-ignore-file no-explicit-any
import { createClient } from '@supabase/supabase-js'
import type { VentaSII } from './rcv.ts'

const normalizarRut = (r: string | null | undefined) =>
  (r || '').replace(/[.\s]/g, '').toUpperCase().replace(/^0+/, '')

export interface ResultadoMatch {
  actualizadas: any[]
  ambiguas: any[]
  sinMatch: any[]
  errores: any[]
  yaRegistradas: number
}

export async function conciliar(ventas: VentaSII[], periodo: string): Promise<ResultadoMatch> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const [progRes, cliRes, entRes, folioRes] = await Promise.all([
    supabase.from('billing').select('id,client_id,entity_id,amount,due,status,receptor_rut,concept,invoice_no').eq('status', 'Programada'),
    supabase.from('clients').select('id,name,rut'),
    supabase.from('client_entities').select('id,client_id,name,rut'),
    supabase.from('billing').select('invoice_no').not('invoice_no', 'is', null),
  ])
  const err = progRes.error || cliRes.error || entRes.error || folioRes.error
  if (err) throw new Error('Error leyendo la base: ' + err.message)

  const programadas = progRes.data || []
  const clientes = cliRes.data || []
  const entidades = entRes.data || []
  // Folios ya presentes en billing (cualquier status): factura ya conciliada o
  // importada por PDF/Drive — no se reprocesa ni se reporta como "sin match".
  const foliosExistentes = new Set((folioRes.data || []).map((b: any) => String(b.invoice_no)))

  const rutEsperado = (b: any) =>
    normalizarRut(b.receptor_rut) ||
    normalizarRut(entidades.find((e: any) => e.id === b.entity_id)?.rut) ||
    normalizarRut(clientes.find((c: any) => c.id === b.client_id)?.rut)

  const nombreCliente = (b: any) => clientes.find((c: any) => c.id === b.client_id)?.name || 'Sin cliente'

  const resultado: ResultadoMatch = { actualizadas: [], ambiguas: [], sinMatch: [], errores: [], yaRegistradas: 0 }
  const usadas = new Set<string>()  // cuotas ya matcheadas en esta corrida (un folio por cuota)

  for (const v of ventas) {
    if (foliosExistentes.has(String(v.folio))) {
      resultado.yaRegistradas++
      continue
    }
    const rutV = normalizarRut(v.rutReceptor)
    const tolerancia = Math.max(1, v.montoTotal * 0.01)
    const candidatos = programadas.filter((b: any) =>
      !usadas.has(b.id) &&
      rutV !== '' &&
      rutEsperado(b) === rutV &&
      Math.abs((b.amount || 0) - v.montoTotal) <= tolerancia &&
      String(b.due || '').startsWith(periodo)
    )

    if (candidatos.length === 1) {
      const b = candidatos[0]
      const { error } = await supabase.from('billing').update({
        status: 'Pendiente',
        invoice_no: String(v.folio),
        issued_at: v.fechaEmision,
        sii_synced_at: new Date().toISOString(),
        sii_tipo_dte: v.tipoDte,
        receptor_rut: b.receptor_rut || v.rutReceptor,
        updated_at: new Date().toISOString(),
      }).eq('id', b.id).eq('status', 'Programada')
      if (error) {
        resultado.errores.push({ folio: v.folio, error: error.message })
        console.log(`[sii-sync] ERROR actualizando folio ${v.folio}: ${error.message}`)
      } else {
        usadas.add(b.id)
        resultado.actualizadas.push({
          id: b.id, cliente: nombreCliente(b), concepto: b.concept,
          folio: v.folio, monto: v.montoTotal, fechaEmision: v.fechaEmision,
        })
        console.log(`[sii-sync] folio ${v.folio} -> Pendiente (${nombreCliente(b)}, $${v.montoTotal})`)
      }
    } else if (candidatos.length > 1) {
      // Match ambiguo: no se toca nada, resolucion manual en la app
      resultado.ambiguas.push({
        folio: v.folio, rut: v.rutReceptor, monto: v.montoTotal, fechaEmision: v.fechaEmision,
        candidatos: candidatos.map((b: any) => ({ id: b.id, cliente: nombreCliente(b), concepto: b.concept, monto: b.amount, due: b.due })),
      })
      console.log(`[sii-sync] folio ${v.folio}: ${candidatos.length} candidatos, queda para revision manual`)
    } else {
      // Factura del SII sin registro equivalente en la app
      resultado.sinMatch.push({
        folio: v.folio, rut: v.rutReceptor, tipoDte: v.tipoDte,
        monto: v.montoTotal, fechaEmision: v.fechaEmision,
      })
    }
  }

  return resultado
}
