// index.ts — sii-sync FASE 1: lee el Registro de Ventas del SII y concilia
// facturas Programadas -> Pendientes en billing.
//
// POST {action:'test-auth'}        -> prueba la danza de autenticacion, no toca nada
// POST {periodo:'YYYY-MM'}         -> sync del periodo (requiere SII_AMBIENTE=produccion)
//
// Seguridad: verify_jwt=true en config.toml (la plataforma valida la firma del JWT)
// + este handler exige que el email del JWT sea de un admin. El anon key no trae
// email, por lo que queda rechazado; los usuarios limited tambien.
//
// TODO FASE 2 (emision de DTEs — NO implementada): crear emision.ts (XML DTE,
// folios CAF, timbraje) reutilizando obtenerToken() de auth.ts, e importar aqui
// con action 'emitir'. No refactorizar lo existente.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { obtenerToken } from './auth.ts'
import { getVentas } from './rcv.ts'
import { conciliar } from './match.ts'
import { getConfig, getEmisor, getResol } from './config.ts'
import { parseCaf } from './caf.ts'
import { armarDocumento, type FacturaInput } from './dte.ts'
import { firmarDocumento } from './firma.ts'
import { armarEnvioDTE, enviarAlSII, consultarEstado } from './emision.ts'

const ADMINS = ['cl@leabogados.cl', 'ee@leabogados.cl']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function emailDelJwt(req: Request): string | null {
  try {
    const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.email || null
  } catch {
    return null
  }
}

// Timestamp local de Chile (YYYY-MM-DDTHH:mm:ss), con DST correcto vía timezone. El SII lo exige local.
function nowChileIso(): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const g = (t: string) => parts.find(x => x.type === t)?.value || '00'
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Metodo no permitido' }, 405)

  const email = emailDelJwt(req)
  if (!email || !ADMINS.includes(email)) {
    console.log(`[sii-sync] acceso denegado (email: ${email || 'sin email'})`)
    return json({ error: 'Solo administradores pueden sincronizar con el SII' }, 403)
  }

  // deno-lint-ignore no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { /* body vacio */ }
  const { ambiente } = getConfig()

  try {
    // Modo de prueba aislado: valida la danza completa sin tocar billing.
    if (body.action === 'test-auth') {
      console.log(`[sii-sync] test-auth solicitado por ${email} (ambiente: ${ambiente})`)
      const token = await obtenerToken(true)
      return json({
        ok: true,
        ambiente,
        tokenPreview: token.slice(0, 6) + '...' + token.slice(-4),
        mensaje: 'Danza de autenticacion OK: semilla obtenida, firma aceptada, token emitido',
      })
    }

    // Emisión de un DTE directo al SII. Reusa el CAF de dte_folios; arma+firma+envía.
    // body: { action:'emitir', tipoDte, fecha?, receptor:{rut,rs,giro?,dir?,comuna?}, items:[{nombre,desc?,qty?,precio?,monto}], fmaPago?, billingId?, dryRun? }
    // dryRun=true arma y firma pero NO envía (para inspeccionar el XML / generar el set de pruebas).
    if (body.action === 'emitir') {
      const f = body || {}
      const tipoDte = parseInt(String(f.tipoDte || 0), 10)
      if (![33, 34, 61, 56].includes(tipoDte)) return json({ error: 'tipoDte inválido (33/34/61/56)' }, 400)
      if (!f.receptor?.rut || !Array.isArray(f.items) || f.items.length === 0) return json({ error: 'Falta receptor.rut o items' }, 400)
      const amb = ambiente === 'produccion' ? 'prod' : 'cert'

      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data: cafs, error: cafErr } = await sb.from('dte_folios').select('*').eq('tipo_dte', tipoDte).eq('ambiente', amb).order('folio_desde')
      if (cafErr) throw new Error('No se pudo leer dte_folios: ' + cafErr.message)
      // deno-lint-ignore no-explicit-any
      const cafRow = (cafs || []).find((c: any) => c.folio_actual <= c.folio_hasta)
      if (!cafRow) return json({ error: `Sin folios CAF disponibles para DTE ${tipoDte} (${amb}). Carga un CAF en dte_folios.` }, 400)

      // Asigna folio. OJO: lectura+update NO es atómico; en producción conviene un RPC. En certificación (1 usuario) es seguro.
      const folio = cafRow.folio_actual
      const { error: updErr } = await sb.from('dte_folios').update({ folio_actual: folio + 1 }).eq('id', cafRow.id).eq('folio_actual', folio)
      if (updErr) throw new Error('No se pudo reservar el folio: ' + updErr.message)

      const caf = parseCaf(cafRow.caf_xml)
      const nowIso = nowChileIso()
      const emisor = getEmisor()
      const factura: FacturaInput = {
        tipoDte, folio, fecha: String(f.fecha || nowIso.slice(0, 10)),
        emisor, receptor: f.receptor, items: f.items, fmaPago: f.fmaPago,
      }
      const { documento, docId, tot } = armarDocumento(factura, caf, nowIso)
      const firma = firmarDocumento(documento, docId)
      const dteFirmado = `<DTE version="1.0">${documento}${firma}</DTE>`
      const resol = getResol()
      const envio = armarEnvioDTE(
        [dteFirmado],
        { rutEmisor: emisor.rut, rutEnvia: getConfig().rutEnvia, fchResol: resol.fchResol, nroResol: resol.nroResol, subtotales: [{ tipoDte, nro: 1 }] },
        nowIso,
      )

      if (f.dryRun) {
        console.log(`[sii-sync] emitir DRY-RUN ${docId} (${amb}) por ${email}`)
        return json({ ok: true, dryRun: true, ambiente: amb, folio, docId, total: tot.total, envioXml: envio })
      }

      console.log(`[sii-sync] emitir ${docId} (${amb}) por ${email}`)
      const trackId = await enviarAlSII(envio)
      let estado = { estado: 'enviado', glosa: '' }
      try { estado = await consultarEstado(trackId) } catch (_) { /* el estado puede tardar; queda 'enviado' */ }

      if (f.billingId) {
        await sb.from('billing').update({
          folio, dte_estado: estado.estado || 'enviado', dte_track_id: trackId,
          dte_xml: dteFirmado, dte_ambiente: amb, dte_emitido_at: new Date().toISOString(),
        }).eq('id', f.billingId)
      }
      return json({ ok: true, ambiente: amb, folio, docId, trackId, estado: estado.estado, glosa: estado.glosa, total: tot.total })
    }

    const periodo = String(body.periodo || '')
    if (!/^\d{4}-\d{2}$/.test(periodo)) return json({ error: 'periodo debe tener formato YYYY-MM' }, 400)
    if (ambiente !== 'produccion') {
      return json({
        error: 'El RCV solo existe en produccion. Prueba primero la autenticacion (action test-auth) y luego cambia SII_AMBIENTE a produccion.',
        ambiente,
      }, 400)
    }

    console.log(`[sii-sync] sync ${periodo} solicitado por ${email}`)
    let token = await obtenerToken()
    let ventas
    try {
      ventas = await getVentas(periodo, token)
    } catch (e) {
      // Token expirado a mitad de operacion: renovar y reintentar UNA vez
      console.log(`[sii-sync] consulta fallo, renovando token y reintentando: ${e instanceof Error ? e.message : e}`)
      token = await obtenerToken(true)
      ventas = await getVentas(periodo, token)
    }

    const resultado = await conciliar(ventas, periodo)
    console.log(
      `[sii-sync] ${periodo}: ${ventas.length} facturas SII | ` +
      `${resultado.actualizadas.length} actualizadas, ${resultado.ambiguas.length} ambiguas, ` +
      `${resultado.sinMatch.length} sin match, ${resultado.yaRegistradas.length} ya registradas, ` +
      `${resultado.errores.length} errores`
    )
    return json({ periodo, ambiente, totalSII: ventas.length, ...resultado })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[sii-sync] ERROR: ${msg}`)
    const noDisponible = msg.includes('no disponible')
    return json({
      error: noDisponible ? 'SII no disponible, intenta mas tarde' : msg,
      detalle: noDisponible ? msg : undefined,
    }, 502)
  }
})
