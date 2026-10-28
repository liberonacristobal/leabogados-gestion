// Edge Function: procesar-cartola
// Recibe el Excel de la cartola BICE diaria (base64) desde el Apps Script de contacto@leabogados.cl,
// lo parsea con el MISMO parser que la app (cartola.ts), dedupe por hash e inserta en cartola_movimientos.
// Auth: secreto compartido (CARTOLA_SECRET) en el header Authorization. verify_jwt=false (llamada máquina-a-máquina).

// SheetJS desde npm (el bundler de Supabase bloquea cdn.sheetjs.com). 0.18.5 lee el .xls binario de BICE idéntico (validado, dif 0).
import * as XLSX from 'npm:xlsx@0.18.5'
import { parseCartola, normRut, huellaGlosa } from './cartola.ts'
import { planCarga } from '../_shared/cartolaDedupe.js'

const SECRET = Deno.env.get('CARTOLA_SECRET') || ''
const SB_URL = Deno.env.get('SUPABASE_URL') || ''
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// Columnas de cartola_movimientos que escribimos (parseCartola + cliente_id/estado/monto_conciliado, igual que la carga manual).
const COLS = ['cuenta', 'rol_cuenta', 'fecha', 'tipo', 'rut_contraparte', 'nombre_contraparte', 'monto', 'n_operacion', 'descripcion', 'es_interno', 'hash', 'cliente_id', 'estado', 'monto_conciliado']

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
async function sbFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${txt}`)
  return txt ? JSON.parse(txt) : null
}

// Resuelve rut → cliente_id con las mismas 4 fuentes que la app (prioridad: alias > entidad > cliente > factura).
// El emparejamiento por NOMBRE (resolverNombre) no se replica aquí: los sin-RUT quedan cliente_id=null y se identifican en la app.
async function buildResolver(): Promise<(rut: string | null) => string | null> {
  const map: Record<string, string> = {}
  const add = (rows: Record<string, unknown>[], rutKey: string, idKey: string) => {
    for (const r of rows || []) {
      const k = normRut(r[rutKey] as string)
      const id = r[idKey]
      if (k && id != null && !map[k]) map[k] = String(id)
    }
  }
  const [alias, ent, cli, bill] = await Promise.all([
    sbFetch('cliente_alias?select=rut_pagador,cliente_id').catch(() => []),
    sbFetch('client_entities?select=rut,client_id').catch(() => []),
    sbFetch('clients?select=id,rut').catch(() => []),
    sbFetch('billing?select=receptor_rut,client_id').catch(() => []),
  ])
  // En orden de prioridad (el primero que escribe una clave gana): alias > entidad > cliente > factura.
  add(alias, 'rut_pagador', 'cliente_id')
  add(ent, 'rut', 'client_id')
  add(cli, 'rut', 'id')
  add(bill, 'receptor_rut', 'client_id')
  return (rut) => { const k = normRut(rut || ''); return k ? (map[k] || null) : null }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  if (!SECRET) return json({ error: 'Falta configurar CARTOLA_SECRET' }, 500)

  // --- Auth: secreto compartido ---
  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (auth !== SECRET) return json({ error: 'No autorizado' }, 403)

  // deno-lint-ignore no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }
  const b64 = String(body.file || body.excel || '').replace(/^data:.*;base64,/, '')
  if (!b64) return json({ error: 'Falta el archivo (base64) en "file"' }, 400)

  try {
    // --- Excel → AOA ---
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const wb = XLSX.read(bin, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })

    // --- Parseo (mismo motor que la app) ---
    const parsed = parseCartola(aoa, { filename: String(body.filename || '') })
    const movs = parsed.movimientos || []
    if (!movs.length) return json({ inserted: 0, total: 0, error: parsed.error || 'Sin movimientos en el archivo' })

    // --- Dedupe por hash y por huella de la glosa (fecha-hora real de la transferencia), ventana ±5 días ---
    // La misma transferencia puede haber entrado por la carga manual (mensual) con otra fecha contable y sin n° de operación:
    // el hash no calza, la huella sí (caso real: $1.215.000 a la notaría cargado 19-06 y 22-06).
    const fechas = movs.map(m => m.fecha).sort()
    const minF = fechas[0], maxF = fechas[fechas.length - 1]
    const dd = (f: string, n: number) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
    const existentes = await sbFetch(
      `cartola_movimientos?select=id,hash,cuenta,tipo,monto,descripcion,fecha,n_operacion,rut_contraparte&fecha=gte.${dd(minF, -5)}&fecha=lte.${dd(maxF, 5)}`,
    )
    // Regla única en _shared/cartolaDedupe.js (con sus pruebas): cada fila existente se consume una sola vez, así que pagos
    // idénticos el mismo día se conservan todos; nunca borra. Lo ya cargado a mano sin n° de operación recibe el del archivo.
    const { nuevos, rellenar } = planCarga(movs, existentes, huellaGlosa)
    if (!body.dryRun) {
      for (const r of rellenar) await sbFetch(`cartola_movimientos?id=eq.${r.id}&n_operacion=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ n_operacion: r.n_operacion }) }).catch(() => null)
    }
    if (body.dryRun) {
      return json({ dryRun: true, total: movs.length, nuevos: nuevos.length, yaCargados: movs.length - nuevos.length, rellenar: rellenar.length,
        detalleNuevos: nuevos.map((m: { fecha: string, tipo: string, monto: number }) => `${m.fecha} ${m.tipo} ${m.monto}`) })
    }

    // --- Insert (con cliente_id resuelto por RUT, igual que la carga manual) ---
    let inserted = 0
    if (nuevos.length) {
      const resolver = await buildResolver()
      const rows = nuevos.map(m => {
        const enriched = {
          ...m,
          cliente_id: m.es_interno ? null : resolver(m.rut_contraparte),
          estado: m.es_interno ? 'interno' : 'pendiente',
          monto_conciliado: 0,
        }
        // deno-lint-ignore no-explicit-any
        const r: any = {}
        for (const k of COLS) r[k] = (enriched as Record<string, unknown>)[k]
        return r
      })
      await sbFetch('cartola_movimientos', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(rows),
      })
      inserted = rows.length
    }

    // --- Registro de la carga (fuente de verdad "llegó cartola de este día", aunque venga con 0 nuevos) ---
    // Alimenta la alerta de cartolas faltantes: un día con carga registrada NO se marca como hueco.
    try {
      await sbFetch('cartola_cargas', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([{
          // Cobertura hasta el «Hasta» del encabezado del banco (si es válido y no anterior al último movimiento ni futuro).
          fecha_desde: minF, fecha_hasta: (parsed.fechaHasta && /^\d{4}-\d\d-\d\d$/.test(parsed.fechaHasta) && parsed.fechaHasta >= maxF && parsed.fechaHasta <= new Date().toISOString().slice(0, 10)) ? parsed.fechaHasta : maxF,
          movimientos_n: movs.length,
          origen: 'diaria',
          archivo: String(body.filename || '') || null,
          // De qué cuenta es y con qué saldos: la alerta detecta una cuenta que dejó de llegar y cortes en la cadena de saldos.
          cuenta: parsed.cuenta || null, rol_cuenta: parsed.rol_cuenta || null,
          saldo_inicial: parsed.saldoInicial ?? null, saldo_final: parsed.saldoFinal ?? null,
          total_cargos: parsed.totalCargos ?? null, total_abonos: parsed.totalAbonos ?? null,
        }]),
      })
    } catch (_) { /* el registro es best-effort: nunca debe romper la ingesta */ }
    // Traspasos entre las dos cuentas propias: se marcan internos solo si existe el movimiento espejo en la otra cuenta.
    try { await sbFetch('rpc/emparejar_traspasos_propios', { method: 'POST', body: JSON.stringify({}) }) } catch (_) { /* best-effort */ }
    // Concilia solo lo inequívoco de lo recién llegado (mismas reglas que la app). Best-effort: nunca rompe la ingesta.
    try { const cs = Deno.env.get('CRON_SECRET') || ''; if (cs) await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/conciliacion-auto`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: cs }) }) } catch (_) { /* best-effort */ }

    return json({
      ok: true,
      cuenta: parsed.cuenta,
      rol: parsed.rol_cuenta,
      total: movs.length,
      inserted,
      duplicados: movs.length - nuevos.length,
      rango: { desde: minF, hasta: maxF },
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
