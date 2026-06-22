// match.ts — conciliacion RCV <-> billing.
//
// REGLA DE ORO: la conciliacion AUTOMATICA solo actualiza Programada -> Pendiente
// cuando el match es UNICO. NUNCA borra ni crea. Las correcciones de folio sobre
// facturas ya emitidas se REPORTAN (no se aplican aqui): el usuario las confirma
// con un clic en el frontend, porque cambiar un folio es delicado.
//
// RUT esperado de una cuota: se considera el conjunto de TODAS sus razones sociales
// (receptor_rut + entidad + cliente + client_entities del cliente). Las Programadas
// suelen no traer la RS final; el RUT real puede venir de cualquier RS asociada.
//
// Match en dos pasadas para no preferir un aproximado sobre el exacto:
//   1) EXACTO (±$1): atrapa la venta real aunque exista otra cuota de monto parecido.
//   2) APROXIMADO (±2%): cubre la diferencia por UF entre programar y emitir.
// En cada pasada, si hay 1 candidato actuamos; si hay >1, es ambiguo (no se toca).
//
// Categorias del resultado:
//   - actualizadas:  Programada -> Pendiente (automatico, match unico)
//   - corregirFolio: la venta del SII ya existe como Pendiente/Vencido pero con folio
//                    distinto o sin folio -> se sugiere asignar el folio real (manual)
//   - ambiguas / sinMatch: se reportan, no se toca nada
//
// Requiere columnas sii_synced_at y sii_tipo_dte en billing.

// deno-lint-ignore-file no-explicit-any
import { createClient } from '@supabase/supabase-js'
import type { VentaSII } from './rcv.ts'

const normalizarRut = (r: string | null | undefined) =>
  (r || '').replace(/[.\s]/g, '').toUpperCase().replace(/-/g, '').replace(/^0+/, '')

export interface ResultadoMatch {
  actualizadas: any[]
  corregirFolio: any[]
  ambiguas: any[]
  sinMatch: any[]
  errores: any[]
  yaRegistradas: any[]
}

export async function conciliar(ventas: VentaSII[], periodo: string): Promise<ResultadoMatch> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const [progRes, cliRes, entRes, emitRes, folioRes] = await Promise.all([
    supabase.from('billing').select('id,client_id,entity_id,amount,due,status,receptor_rut,concept,invoice_no').eq('status', 'Programada').is('deleted_at', null),
    supabase.from('clients').select('id,name,rut'),
    supabase.from('client_entities').select('id,client_id,name,rut'),
    supabase.from('billing').select('id,client_id,entity_id,amount,status,receptor_rut,concept,invoice_no,issued_at').in('status', ['Pendiente', 'Vencido']).is('deleted_at', null),
    supabase.from('billing').select('invoice_no').not('invoice_no', 'is', null).is('deleted_at', null),
  ])
  const err = progRes.error || cliRes.error || entRes.error || emitRes.error || folioRes.error
  if (err) throw new Error('Error leyendo la base: ' + err.message)

  const programadas = progRes.data || []
  const clientes = cliRes.data || []
  const entidades = entRes.data || []
  const emitidas = emitRes.data || []
  const foliosExistentes = new Set((folioRes.data || []).map((b: any) => String(b.invoice_no)))
  const foliosSII = new Set(ventas.map((v) => String(v.folio)))

  // Conjunto de RUTs validos de una cuota: su receptor, su entidad, su cliente y
  // TODAS las razones sociales del cliente (asi una factura emitida a cualquier RS
  // del cliente puede reconocerse aunque la cuota no traiga esa RS asignada).
  const rutsDe = (b: any): Set<string> => {
    const s = new Set<string>()
    const add = (r: any) => { const n = normalizarRut(r); if (n) s.add(n) }
    add(b.receptor_rut)
    add(entidades.find((e: any) => e.id === b.entity_id)?.rut)
    const cli = clientes.find((c: any) => c.id === b.client_id)
    add(cli?.rut)
    entidades.filter((e: any) => e.client_id === b.client_id).forEach((e: any) => add(e.rut))
    return s
  }
  const nombreCliente = (b: any) => clientes.find((c: any) => c.id === b.client_id)?.name || 'Sin cliente'

  const resultado: ResultadoMatch = { actualizadas: [], corregirFolio: [], ambiguas: [], sinMatch: [], errores: [], yaRegistradas: [] }
  const progUsadas = new Set<string>()
  const emitUsadas = new Set<string>()

  for (const v of ventas) {
    if (foliosExistentes.has(String(v.folio))) {
      resultado.yaRegistradas.push({ folio: v.folio, rut: v.rutReceptor, receptor: v.nombreReceptor, monto: v.montoTotal })
      continue
    }
    const rutV = normalizarRut(v.rutReceptor)
    if (rutV === '') { resultado.sinMatch.push(itemSinMatch(v)); continue }

    // Una emitida es "corregible" si su folio falta o no corresponde a ninguna venta
    // del periodo (folio manual): no tocamos folios que ya son correctos del SII.
    const folioCorregible = (b: any) =>
      !b.invoice_no || (!foliosSII.has(String(b.invoice_no)) && String(b.invoice_no) !== String(v.folio))

    let resuelto = false
    for (const tol of [1, Math.max(1, v.montoTotal * 0.02)]) {
      const calza = (b: any) => rutsDe(b).has(rutV) && Math.abs((b.amount || 0) - v.montoTotal) <= tol
      const progC = programadas.filter((b: any) => !progUsadas.has(b.id) && calza(b) && String(b.due || '').startsWith(periodo))
      const emitC = emitidas.filter((b: any) => !emitUsadas.has(b.id) && calza(b) && folioCorregible(b))
      const total = progC.length + emitC.length
      if (total === 0) continue
      if (total > 1) {
        resultado.ambiguas.push({
          folio: v.folio, rut: v.rutReceptor, receptor: v.nombreReceptor, monto: v.montoTotal, fechaEmision: v.fechaEmision,
          candidatos: [...progC, ...emitC].map((b: any) => ({ id: b.id, cliente: nombreCliente(b), concepto: b.concept, monto: b.amount, estado: b.status, folio: b.invoice_no || null })),
        })
        resuelto = true
        break
      }
      // Exactamente un candidato en esta pasada
      if (progC.length === 1) {
        const b = progC[0]
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
          progUsadas.add(b.id)
          resultado.actualizadas.push({ id: b.id, cliente: nombreCliente(b), concepto: b.concept, folio: v.folio, monto: v.montoTotal, fechaEmision: v.fechaEmision })
          console.log(`[sii-sync] folio ${v.folio} -> Pendiente (${nombreCliente(b)}, $${v.montoTotal})`)
        }
      } else {
        const b = emitC[0]
        emitUsadas.add(b.id)
        resultado.corregirFolio.push({
          billingId: b.id, cliente: nombreCliente(b), concepto: b.concept,
          folioActual: b.invoice_no || null, folio: v.folio,
          monto: v.montoTotal, montoApp: b.amount, estado: b.status,
          fechaEmision: v.fechaEmision, tipoDte: v.tipoDte,
          rut: v.rutReceptor, receptor: v.nombreReceptor,
        })
        console.log(`[sii-sync] folio SII ${v.folio} calza con emitida ${b.invoice_no || 'sin folio'} (${nombreCliente(b)}) -> sugerir correccion`)
      }
      resuelto = true
      break
    }
    if (!resuelto) resultado.sinMatch.push(itemSinMatch(v))
  }

  return resultado
}

function itemSinMatch(v: VentaSII) {
  return { folio: v.folio, rut: v.rutReceptor, receptor: v.nombreReceptor, tipoDte: v.tipoDte, monto: v.montoTotal, fechaEmision: v.fechaEmision }
}
