// Edge Function: procesar-cartola
// Recibe el Excel de la cartola BICE diaria (base64) desde el Apps Script de contacto@leabogados.cl,
// lo parsea con el MISMO parser que la app (cartola.ts), dedupe por hash e inserta en cartola_movimientos.
// Auth: secreto compartido (CARTOLA_SECRET) en el header Authorization. verify_jwt=false (llamada máquina-a-máquina).

import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs'
import { parseCartola, normRut } from './cartola.ts'

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

    // --- Dedupe por hash, acotado al rango de fechas de la cartola ---
    const fechas = movs.map(m => m.fecha).sort()
    const minF = fechas[0], maxF = fechas[fechas.length - 1]
    const existentes: { hash: string }[] = await sbFetch(
      `cartola_movimientos?select=hash&fecha=gte.${minF}&fecha=lte.${maxF}`,
    )
    const yaHay = new Set(existentes.map(e => e.hash))
    const nuevos = movs.filter(m => !yaHay.has(m.hash))

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
