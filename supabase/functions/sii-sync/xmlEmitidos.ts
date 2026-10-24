// xmlEmitidos.ts — trae del SII el XML firmado de las facturas emitidas fuera de la app (portal de facturación del SII)
// y lo guarda en billing.dte_xml. Entra con el certificado digital del estudio (como «Ingresar con Certificado Digital»),
// elige la empresa y usa «Archivo Respaldo» de Documentos Emitidos, filtrado por folio y tipo: el mismo camino que una
// persona en el navegador. Solo LEE el SII.
//
// El SII tiene preparado un reCAPTCHA en esa descarga (captcha.js), hoy apagado (404, verificado 24-10-2026). Si lo
// activa, el proceso se DETIENE y lo informa: nunca intenta saltarlo; esos XML vuelven a bajarse a mano.
// Alcance: solo desde XML_DESDE (decisión del usuario 24-10-2026: nada histórico).
import forge from 'forge'
import { cargarCertificado } from './auth.ts'

export const XML_DESDE = '2026-06-09'
const BASE = 'https://www1.sii.cl/cgi-bin/Portal001/'

type Sesion = { ir: (url: string, body?: string) => Promise<{ status: number; t: string }> }

async function abrirSesion(rutEmpresa: string): Promise<Sesion> {
  const c = cargarCertificado()
  const certPem = `-----BEGIN CERTIFICATE-----\n${c.certPemB64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`
  // deno-lint-ignore no-explicit-any
  const client = (Deno as any).createHttpClient({ cert: certPem, key: forge.pki.privateKeyToPem(c.key) })
  const jar = new Map<string, string>()
  const ir = async (url: string, body?: string) => {
    const r = await fetch(url, {
      client, method: body ? 'POST' : 'GET', body, redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FirmDesk/1.0)', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    } as RequestInit)
    for (const k of r.headers.getSetCookie?.() || []) { const kv = k.split(';')[0], i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()) }
    // El SII entrega ISO-8859-1.
    return { status: r.status, t: new TextDecoder('latin1').decode(new Uint8Array(await r.arrayBuffer())) }
  }
  const ref = `${BASE}mipeSelEmpresa.cgi`
  await ir(`https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?${ref}`, `referencia=${encodeURIComponent(ref)}`)
  await ir(ref, `RUT_EMP=${encodeURIComponent(rutEmpresa)}`)
  return { ir }
}

// ¿El SII activó el captcha de la descarga? (captcha.js existe y trae reCAPTCHA, o la página lo define en línea)
async function captchaActivo(s: Sesion, paginaLista: string): Promise<boolean> {
  if (/function\s+llamaRecaptchaConCallback|grecaptcha\.|recaptcha\/api\.js/i.test(paginaLista)) return true
  const js = await s.ir('https://www1.sii.cl/Portal001/JS/captcha.js')
  return js.status === 200 && /recaptcha|llamaRecaptcha/i.test(js.t)
}

const lista = (folio: string, tipo: number | null) =>
  `${BASE}mipeAdminDocsEmi.cgi?RUT_RECP=&FOLIO=${encodeURIComponent(folio)}&RZN_SOC=&FEC_DESDE=&FEC_HASTA=&TPO_DOC=${tipo ?? ''}&ESTADO=&ORDEN=&NUM_PAG=1`

export type Pendiente = { id: string; folio: string; tipo: number | null; monto: number }
export type Resultado = { id: string; folio: string; estado: 'cargado' | 'no_calza' | 'sin_documento' | 'error'; detalle?: string; xml?: string }

// Valida que el respaldo sea UN DTE del folio/tipo pedido y con su monto (±1 por redondeo). Devuelve el motivo si no calza.
export function validarRespaldo(xml: string, p: Pendiente): string | null {
  if (!/^\s*<\?xml/i.test(xml) || !/<DTE[\s>]/.test(xml)) return 'el SII no devolvió un XML'
  const dtes = xml.match(/<DTE[\s>]/g) || []
  if (dtes.length !== 1) return `el respaldo trae ${dtes.length} documentos`
  const folio = xml.match(/<Folio>(\d+)<\/Folio>/)?.[1]
  const tipo = Number(xml.match(/<TipoDTE>(\d+)<\/TipoDTE>/)?.[1] || 0)
  const total = Number(xml.match(/<MntTotal>(\d+)<\/MntTotal>/)?.[1] || NaN)
  if (folio !== String(Number(p.folio))) return `folio ${folio} distinto de ${p.folio}`
  if (p.tipo && tipo !== p.tipo) return `tipo ${tipo} distinto de ${p.tipo}`
  if (!(Math.abs(total - p.monto) <= 1)) return `monto ${total} distinto de ${p.monto}`
  if (!/<\/Signature>/.test(xml)) return 'el XML no trae la firma'
  return null
}

export async function bajarXmlEmitidos(rutEmpresa: string, pendientes: Pendiente[]): Promise<{ captcha: boolean; resultados: Resultado[] }> {
  let s = await abrirSesion(rutEmpresa)
  const resultados: Resultado[] = []
  for (const p of pendientes) {
    try {
      let pag = await s.ir(lista(p.folio, p.tipo))
      // Tras una descarga, el SII a veces devuelve la lista vacía en la misma sesión (visto 24-10 con el 2.º folio): sesión nueva y reintento.
      if (!/mipeGesDocEmi\.cgi/.test(pag.t)) { s = await abrirSesion(rutEmpresa); pag = await s.ir(lista(p.folio, p.tipo)) }
      if (/IngresoRutClave|InicioAutenticacion/i.test(pag.t) && !/mipeGesDocEmi/.test(pag.t)) throw new Error('el SII no abrió la sesión del certificado')
      if (await captchaActivo(s, pag.t)) return { captcha: true, resultados }
      if (!/mipeGesDocEmi\.cgi/.test(pag.t)) { resultados.push({ id: p.id, folio: p.folio, estado: 'sin_documento', detalle: 'el folio no aparece en Documentos Emitidos' }); continue }
      // Valor del botón «Archivo Respaldo» tal como lo trae la página (new_win_down('X')).
      const dl = [...pag.t.matchAll(/<[^>]*new_win_down\(\s*['"]([^'"]+)['"]\s*\)[^>]*>[^<]{0,40}/gi)].find((m) => /Respaldo/i.test(m[0]))?.[1]
      if (!dl) throw new Error('no se encontró el botón Archivo Respaldo')
      const r = await s.ir(`${BASE}mipeDownLoad.cgi?ORIGEN=ENV&RUT_RECP=&FOLIO=${encodeURIComponent(p.folio)}&RZN_SOC=&FEC_DESDE=&FEC_HASTA=&TPO_DOC=${p.tipo ?? ''}&ESTADO=&ORDEN=&DOWNLOAD=${encodeURIComponent(dl)}`)
      if (/recaptcha/i.test(r.t) && !/<DTE[\s>]/.test(r.t)) return { captcha: true, resultados }
      const motivo = validarRespaldo(r.t, p)
      resultados.push(motivo ? { id: p.id, folio: p.folio, estado: 'no_calza', detalle: motivo } : { id: p.id, folio: p.folio, estado: 'cargado', xml: r.t })
    } catch (e) {
      resultados.push({ id: p.id, folio: p.folio, estado: 'error', detalle: e instanceof Error ? e.message : String(e) })
    }
  }
  return { captcha: false, resultados }
}
