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
import { obtenerToken } from './auth.ts'
import { getVentas } from './rcv.ts'
import { conciliar } from './match.ts'
import { getConfig } from './config.ts'

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
      `${resultado.sinMatch.length} sin match, ${resultado.yaRegistradas} ya registradas, ` +
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
