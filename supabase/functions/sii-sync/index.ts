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
import { armarLibroVentas } from './libro.ts'

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

// Log de auditoría de emisión (best-effort, nunca bloquea). Registra cada intento: éxito o folio perdido.
// deno-lint-ignore no-explicit-any
async function logDte(sb: any, rows: any[]) { try { if (rows?.length) await sb.from('dte_log').insert(rows) } catch (_) { /* el log no debe romper la emisión */ } }

// Arma + firma UN DTE: lee su CAF, reserva folio, construye el <Documento> y lo firma.
// Reutilizado por 'emitir' (uno) y 'emitir-set' (varios en un mismo EnvioDTE, p.ej. el set de certificación).
// deno-lint-ignore no-explicit-any
async function construirFirmado(sb: any, amb: string, f: any, nowIso: string) {
  const tipoDte = parseInt(String(f.tipoDte || 0), 10)
  if (![33, 34, 61, 56].includes(tipoDte)) throw new Error(`tipoDte inválido (${tipoDte}); usar 33/34/61/56`)
  if (!f.receptor?.rut || !Array.isArray(f.items) || f.items.length === 0) throw new Error('Falta receptor.rut o items')
  // Folio ATÓMICO: la función siguiente_folio() reserva e incrementa en una sola transacción (FOR UPDATE SKIP LOCKED),
  // así dos emisiones simultáneas NUNCA toman el mismo folio (folios duplicados = problema serio con el SII).
  const { data: fol, error: folErr } = await sb.rpc('siguiente_folio', { p_tipo: tipoDte, p_ambiente: amb })
  if (folErr) throw new Error('No se pudo reservar folio: ' + folErr.message)
  const row = Array.isArray(fol) ? fol[0] : fol
  if (!row || row.folio == null) throw new Error(`Sin folios CAF disponibles para DTE ${tipoDte} (${amb}). Carga un CAF en dte_folios.`)
  const folio = row.folio as number
  const caf = parseCaf(row.caf_xml as string)
  const factura: FacturaInput = {
    tipoDte, folio, fecha: String(f.fecha || nowIso.slice(0, 10)),
    emisor: getEmisor(), receptor: f.receptor, items: f.items, fmaPago: f.fmaPago,
    exenta: f.exenta, referencias: f.referencias,
  }
  const { documento, docId, tot } = armarDocumento(factura, caf, nowIso)
  const firma = firmarDocumento(documento, docId)
  return { dteFirmado: `<DTE version="1.0">${documento}${firma}</DTE>`, folio, docId, tot, tipoDte }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Metodo no permitido' }, 405)

  // deno-lint-ignore no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { /* body vacio */ }

  // Acceso: admin (email en el JWT) O el cron con su secreto (para jobs programados como verificar-estados).
  const email = emailDelJwt(req)
  const cronOk = !!body.cronSecret && body.cronSecret === Deno.env.get('CRON_SECRET')
  if (!cronOk && (!email || !ADMINS.includes(email))) {
    console.log(`[sii-sync] acceso denegado (email: ${email || 'sin email'})`)
    return json({ error: 'Solo administradores pueden usar el SII' }, 403)
  }
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

    // Emisión directa al SII. Reusa el CAF de dte_folios; arma+firma+envía en un EnvioDTE.
    //   'emitir'      → 1 factura: { tipoDte, fecha?, receptor:{rut,rs,giro?,dir?,comuna?}, items:[{nombre,desc?,qty?,precio?,monto}], fmaPago?, billingId?, dryRun? }
    //   'emitir-set'  → varias (set de certificación): { facturas:[ {…igual que arriba…}, … ], dryRun? }  → un solo sobre con todas
    // dryRun=true arma y firma pero NO envía (inspeccionar el XML / preparar el set de pruebas).
    if (body.action === 'emitir' || body.action === 'emitir-set') {
      const amb = ambiente === 'produccion' ? 'prod' : 'cert'
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const nowIso = nowChileIso()
      const lista = body.action === 'emitir-set' ? (Array.isArray(body.facturas) ? body.facturas : []) : [body]
      if (!lista.length) return json({ error: 'Sin facturas para emitir' }, 400)

      // Idempotencia: si esa factura YA fue emitida (dte_track_id), no re-emitir (evita doble folio / doble DTE ante reintentos o doble click).
      if (body.action === 'emitir' && body.billingId && !body.dryRun) {
        const { data: ya } = await sb.from('billing').select('dte_track_id, folio, dte_estado').eq('id', body.billingId).maybeSingle()
        if (ya?.dte_track_id) return json({ ok: true, yaEmitida: true, folio: ya.folio, trackId: ya.dte_track_id, estado: ya.dte_estado })
      }

      const firmados = []
      for (const f of lista) firmados.push(await construirFirmado(sb, amb, f, nowIso))

      // Subtotales por tipo de DTE para la Carátula.
      const porTipo: Record<number, number> = {}
      firmados.forEach(d => { porTipo[d.tipoDte] = (porTipo[d.tipoDte] || 0) + 1 })
      const subtotales = Object.entries(porTipo).map(([t, nro]) => ({ tipoDte: +t, nro }))
      const resol = getResol()
      const envio = armarEnvioDTE(
        firmados.map(d => d.dteFirmado),
        { rutEmisor: getEmisor().rut, rutEnvia: getConfig().rutEnvia, fchResol: resol.fchResol, nroResol: resol.nroResol, subtotales },
        nowIso,
      )
      const docs = firmados.map(d => ({ docId: d.docId, folio: d.folio, total: d.tot.total }))

      if (body.dryRun) {
        console.log(`[sii-sync] emitir DRY-RUN ${docs.map(d => d.docId).join(',')} (${amb}) por ${email}`)
        return json({ ok: true, dryRun: true, ambiente: amb, folio: firmados[0]?.folio, total: firmados[0]?.tot.total, docs, envioXml: envio })
      }

      console.log(`[sii-sync] emitir ${docs.map(d => d.docId).join(',')} (${amb}) por ${email}`)
      let trackId: string
      try {
        trackId = await enviarAlSII(envio)
      } catch (e) {
        // Folios perdidos: la emisión reservó folios pero el SII falló. Quedan registrados en el log (el SII admite gaps justificados).
        await logDte(sb, firmados.map(d => ({ billing_id: body.billingId || null, tipo_dte: d.tipoDte, folio: d.folio, estado: 'error', error: String(e instanceof Error ? e.message : e), ambiente: amb, created_by: email })))
        throw e
      }
      let estado = { estado: 'enviado', glosa: '' }
      try { estado = await consultarEstado(trackId) } catch (_) { /* el estado puede tardar; queda 'enviado' */ }
      await logDte(sb, firmados.map(d => ({ billing_id: body.billingId || null, tipo_dte: d.tipoDte, folio: d.folio, track_id: trackId, estado: estado.estado || 'enviado', ambiente: amb, created_by: email })))

      // En el flujo simple (1 factura con billingId) persiste el DTE en su fila.
      if (body.action === 'emitir' && body.billingId) {
        const d = firmados[0]
        await sb.from('billing').update({
          folio: String(d.folio), dte_estado: estado.estado || 'enviado', dte_track_id: trackId,
          dte_xml: d.dteFirmado, dte_ambiente: amb, dte_emitido_at: new Date().toISOString(),
        }).eq('id', body.billingId)
      }
      return json({ ok: true, ambiente: amb, folio: firmados[0]?.folio, trackId, estado: estado.estado, glosa: estado.glosa, docs, dteXml: body.action === 'emitir' ? firmados[0]?.dteFirmado : undefined })
    }

    // Libro de Ventas electrónico (IECV) para la certificación. Devuelve el XML firmado.
    // body: { action:'libro-ventas', periodo:'YYYY-MM', detalle:[{tpoDoc,nroDoc,fchDoc,rutDoc,rznSoc?,mntExe?,mntNeto?,iva?,mntTotal}] }
    if (body.action === 'libro-ventas') {
      const amb = ambiente === 'produccion' ? 'prod' : 'cert'
      const resol = getResol()
      const xml = armarLibroVentas(
        { rutEmisor: getEmisor().rut, rutEnvia: getConfig().rutEnvia, periodo: String(body.periodo || ''), fchResol: resol.fchResol, nroResol: resol.nroResol },
        Array.isArray(body.detalle) ? body.detalle : [],
        nowChileIso(),
      )
      console.log(`[sii-sync] libro-ventas ${body.periodo} (${amb}) por ${email}`)
      return json({ ok: true, ambiente: amb, libroXml: xml })
    }

    // Re-consultar el estado de un DTE por TrackID (el SII tarda en procesar; puede RECHAZAR). Actualiza billing si se pasa billingId.
    // body: { action:'estado', trackId, billingId? }
    if (body.action === 'estado') {
      const r = await consultarEstado(String(body.trackId || ''))
      const e = (r.estado || '').toUpperCase()
      // Mapa coarse del estado del envío del SII (se afina en certificación con los códigos reales).
      const norm = /ACEPT|^EPR|DOK/.test(e) ? 'aceptada' : /RECH|RCH|RFR|RSC|ANC/.test(e) ? 'rechazada' : (e ? e.toLowerCase() : 'enviado')
      if (body.billingId) {
        const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
        await sb.from('billing').update({ dte_estado: norm }).eq('id', body.billingId)
      }
      return json({ ok: true, estado: norm, glosa: r.glosa, crudo: r.estado })
    }

    // Folios CAF disponibles por tipo (para el módulo: alerta de folios bajos). Devuelve solo el CONTEO, nunca el CAF.
    // body: { action:'folios-estado' }
    if (body.action === 'folios-estado') {
      const amb = ambiente === 'produccion' ? 'prod' : 'cert'
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data } = await sb.from('dte_folios').select('tipo_dte, folio_actual, folio_hasta').eq('ambiente', amb)
      // deno-lint-ignore no-explicit-any
      const folios = (data || []).map((r: any) => ({ tipoDte: r.tipo_dte, disponibles: Math.max(0, r.folio_hasta - r.folio_actual + 1) }))
      return json({ ok: true, ambiente: amb, folios })
    }

    // REPORTE AUTOMÁTICO #1: re-consulta el estado de los DTE aún sin resolver (enviado), marca aceptada/rechazada,
    // y AVISA POR CORREO a los admins si alguno fue rechazado. Pensado para el cron diario (action + cronSecret).
    // body: { action:'verificar-estados', cronSecret? }
    if (body.action === 'verificar-estados') {
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data: all } = await sb.from('billing').select('id, folio, dte_track_id, dte_estado, receptor_name').not('dte_track_id', 'is', null).limit(300)
      // deno-lint-ignore no-explicit-any
      const pend = (all || []).filter((b: any) => !['aceptada', 'rechazada'].includes(b.dte_estado || ''))
      // deno-lint-ignore no-explicit-any
      const rechazadas: any[] = []
      let revisados = 0, cambiados = 0
      for (const b of pend) {
        try {
          const r = await consultarEstado(String(b.dte_track_id))
          const e = (r.estado || '').toUpperCase()
          const norm = /ACEPT|^EPR|DOK/.test(e) ? 'aceptada' : /RECH|RCH|RFR|RSC|ANC/.test(e) ? 'rechazada' : 'enviado'
          revisados++
          if (norm !== (b.dte_estado || 'enviado')) {
            await sb.from('billing').update({ dte_estado: norm }).eq('id', b.id)
            cambiados++
            if (norm === 'rechazada') rechazadas.push({ folio: b.folio, glosa: r.glosa, receptor: b.receptor_name })
          }
        } catch (_) { /* sigue con la siguiente factura */ }
      }
      if (rechazadas.length) {
        const filas = rechazadas.map(x => `<li>Folio ${x.folio || '—'}${x.receptor ? ` · ${x.receptor}` : ''}${x.glosa ? ` · ${x.glosa}` : ''}</li>`).join('')
        const html = `<div style="font-family:Arial,sans-serif;color:#1a1a1a"><h3 style="color:#A32D2D;margin:0 0 8px">DTE rechazadas por el SII</h3><p>El SII rechazó ${rechazadas.length} factura(s) electrónica(s). Revísalas en Facturación y vuelve a emitir:</p><ul>${filas}</ul></div>`
        try {
          await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-task`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Deno.env.get('SUPABASE_ANON_KEY') },
            body: JSON.stringify({ mail: { to: ['cl@leabogados.cl', 'ee@leabogados.cl'], subject: `${rechazadas.length} DTE rechazada(s) por el SII`, html } }),
          })
        } catch (_) { /* el aviso no debe romper el job */ }
      }
      console.log(`[sii-sync] verificar-estados: ${revisados} revisados, ${cambiados} cambiados, ${rechazadas.length} rechazadas`)
      return json({ ok: true, revisados, cambiados, rechazadas: rechazadas.length })
    }

    // REPORTE AUTOMÁTICO #2: resumen semanal de facturación → correo a los admins (los lunes, por cron).
    // body: { action:'resumen-semanal', cronSecret? }
    if (body.action === 'resumen-semanal') {
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const hoy = nowChileIso().slice(0, 10)
      const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
      const { data: bills } = await sb.from('billing').select('amount,paid_amount,status,invoice_no,due,dte_estado,dte_track_id,dte_emitido_at,email_sent_at,deleted_at').limit(5000)
      // deno-lint-ignore no-explicit-any
      const vivos = (bills || []).filter((b: any) => !b.deleted_at)
      // deno-lint-ignore no-explicit-any
      const saldo = (b: any) => ['Pagado', 'Anulada', 'Anulado'].includes(b.status) ? 0 : Math.max(0, (b.amount || 0) - (b.paid_amount || 0))
      // deno-lint-ignore no-explicit-any
      const porCobrarB = vivos.filter((b: any) => b.invoice_no && ['Pendiente', 'Vencido'].includes(b.status))
      const emitidasSemana = vivos.filter((b: any) => (b.dte_emitido_at || '').slice(0, 10) >= hace7).length
      const porCobrar = porCobrarB.reduce((s: number, b: any) => s + saldo(b), 0)
      const vencido = porCobrarB.filter((b: any) => (b.due || '') && (b.due || '') < hoy).reduce((s: number, b: any) => s + saldo(b), 0)
      const rechazadas = vivos.filter((b: any) => (b.dte_estado || '') === 'rechazada').length
      const porEnviar = vivos.filter((b: any) => b.dte_track_id && !b.email_sent_at && ['Pendiente', 'Vencido'].includes(b.status)).length
      const fm = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CL')
      const fila = (lbl: string, val: string, col?: string) => `<tr><td style="padding:7px 8px;border-bottom:1px solid #eee;color:#537281">${lbl}</td><td style="padding:7px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;color:${col || '#003C50'}">${val}</td></tr>`
      const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e4e8eb;border-radius:12px;overflow:hidden"><div style="background:#003C50;padding:16px 22px;color:#fff"><b>Resumen semanal de facturación</b></div><div style="padding:18px 22px;color:#1a1a1a;font-size:14px"><table style="width:100%;border-collapse:collapse">${fila('Emitidas esta semana', String(emitidasSemana))}${fila('Por cobrar', fm(porCobrar))}${fila('De eso, vencido', fm(vencido), vencido > 0 ? '#A32D2D' : '#003C50')}${fila('Facturas por enviar', String(porEnviar), porEnviar > 0 ? '#854F0B' : '#003C50')}${fila('DTE rechazadas por el SII', String(rechazadas), rechazadas > 0 ? '#A32D2D' : '#0F6E56')}</table></div></div>`
      try {
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-task`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Deno.env.get('SUPABASE_ANON_KEY') },
          body: JSON.stringify({ mail: { to: ['cl@leabogados.cl', 'ee@leabogados.cl'], subject: 'Resumen semanal de facturación', html } }),
        })
      } catch (_) { /* no romper el job */ }
      console.log(`[sii-sync] resumen-semanal enviado`)
      return json({ ok: true, emitidasSemana, porCobrar, vencido, rechazadas, porEnviar })
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
