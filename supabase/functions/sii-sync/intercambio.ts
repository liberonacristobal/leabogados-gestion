// intercambio.ts — etapa «Intercambio de información» de la certificación (y, en producción, la respuesta a facturas recibidas).
// A partir de un EnvioDTE RECIBIDO arma los tres XML firmados que pide el SII (formato_ic, esquemas RespuestaEnvioDTE_v10,
// EnvioRecibos_v10 y Recibos_v10):
//   1. RespuestaDTE · RecepcionEnvio  → acuse de recibo del envío y de cada documento.
//   2. RespuestaDTE · ResultadoDTE    → aprobación (o rechazo) comercial de cada documento.
//   3. EnvioRecibos                   → recibo de las mercaderías o servicios, Ley 19.983.
// Funciones puras salvo la firma (certificado del estudio). Mismo criterio de firma que el EnvioDTE: el elemento firmado lleva
// el xmlns SiiDte heredado y el sobre no declara xsi (ver emision.ts). Validado con firma.sh (lxml + cryptography + xmllint).
import { firmarReferencia } from './firma.ts'

const SIIDTE = 'http://www.sii.cl/SiiDte'
const DECLARACION = 'El acuse de recibo que se declara en este acto, de acuerdo a lo dispuesto en la letra b) del Art. 4, y la letra c) del Art. 5 de la Ley 19.983, acredita que la entrega de mercaderias o servicio(s) prestado(s) ha(n) sido recibido(s).'
const rut = (r: unknown) => String(r ?? '').replace(/\./g, '').replace(/\s/g, '').toUpperCase()
const t = (s: unknown) => String(s ?? '').replace(/[<>&]/g, ' ').replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '').replace(/\s+/g, ' ').trim()
const g = (tag: string, s: string) => (s.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1]?.trim() || ''

export interface DocRecibido { tipoDte: number; folio: number; fchEmis: string; rutEmisor: string; rutRecep: string; mntTotal: number }
export interface EnvioRecibido { setId: string; rutEmisor: string; rutReceptor: string; digest: string; docs: DocRecibido[] }
export interface Contacto { nombre?: string; mail?: string; fono?: string }

// Lee lo necesario de un EnvioDTE recibido (sin validar su firma: eso lo hace el SII en la certificación).
export function leerEnvioRecibido(xml: string): EnvioRecibido {
  const set = xml.match(/<SetDTE\s+ID="([^"]+)"/)
  if (!set) throw new Error('El archivo no es un EnvioDTE (no trae SetDTE).')
  const car = (xml.match(/<Caratula[\s\S]*?<\/Caratula>/) || [''])[0]
  const docs = [...xml.matchAll(/<Documento[\s\S]*?<\/Documento>/g)].map(m => {
    const d = m[0], id = (d.match(/<IdDoc>[\s\S]*?<\/IdDoc>/) || [''])[0]
    return { tipoDte: Number(g('TipoDTE', id)), folio: Number(g('Folio', id)), fchEmis: g('FchEmis', id), rutEmisor: rut(g('RUTEmisor', d)), rutRecep: rut(g('RUTRecep', d)), mntTotal: Number(g('MntTotal', d)) || 0 }
  })
  if (!docs.length) throw new Error('El EnvioDTE no trae documentos.')
  // Digest del SetDTE: el DigestValue de la firma cuyo Reference apunta al SetDTE.
  const sigSet = [...xml.matchAll(/<Signature[\s\S]*?<\/Signature>/g)].map(m => m[0]).find(s => s.includes(`URI="#${set[1]}"`)) || ''
  return { setId: set[1], rutEmisor: rut(g('RutEmisor', car)), rutReceptor: rut(g('RutReceptor', car)), digest: g('DigestValue', sigSet), docs }
}

const caratulaResp = (rutResponde: string, rutRecibe: string, idRespuesta: number, nroDetalles: number, c: Contacto, ts: string) =>
  `<Caratula version="1.0"><RutResponde>${rut(rutResponde)}</RutResponde><RutRecibe>${rut(rutRecibe)}</RutRecibe><IdRespuesta>${idRespuesta}</IdRespuesta>` +
  `<NroDetalles>${nroDetalles}</NroDetalles>${c.nombre ? `<NmbContacto>${t(c.nombre).slice(0, 40)}</NmbContacto>` : ''}${c.fono ? `<FonoContacto>${t(c.fono).slice(0, 40)}</FonoContacto>` : ''}` +
  `${c.mail ? `<MailContacto>${t(c.mail).slice(0, 80)}</MailContacto>` : ''}<TmstFirmaResp>${ts}</TmstFirmaResp></Caratula>`

const firmado = (raiz: string, elemento: string, tag: string, id: string) => {
  const canon = elemento.replace(`<${tag} `, `<${tag} xmlns="${SIIDTE}" `)
  return `<?xml version="1.0" encoding="ISO-8859-1"?><${raiz} xmlns="${SIIDTE}" version="1.0">${elemento}${firmarReferencia(canon, '#' + id)}</${raiz}>`
}
const docCampos = (d: DocRecibido) => `<TipoDTE>${d.tipoDte}</TipoDTE><Folio>${d.folio}</Folio><FchEmis>${d.fchEmis}</FchEmis><RUTEmisor>${d.rutEmisor}</RUTEmisor><RUTRecep>${d.rutRecep}</RUTRecep><MntTotal>${d.mntTotal}</MntTotal>`

// 1 · Acuse de recibo del envío. Cada documento: 0 = recibido OK; 3 = el RUT receptor no es el nuestro.
export function armarRecepcionEnvio(env: EnvioRecibido, o: { rutResponde: string; nmbEnvio: string; codEnvio?: number; idRespuesta?: number; contacto?: Contacto; ts: string }): string {
  const propio = rut(o.rutResponde)
  const det = env.docs.map(d => { const ok = d.rutRecep === propio
    return `<RecepcionDTE>${docCampos(d)}<EstadoRecepDTE>${ok ? 0 : 3}</EstadoRecepDTE><RecepDTEGlosa>${ok ? 'DTE Recibido OK' : 'DTE No Recibido - Error en RUT Receptor'}</RecepDTEGlosa></RecepcionDTE>` }).join('')
  const resultado = `<Resultado ID="ResultadoEnvio">${caratulaResp(propio, env.rutEmisor, o.idRespuesta || 1, 1, o.contacto || {}, o.ts)}` +
    `<RecepcionEnvio><NmbEnvio>${t(o.nmbEnvio).slice(0, 80) || 'envio.xml'}</NmbEnvio><FchRecep>${o.ts}</FchRecep><CodEnvio>${o.codEnvio || 1}</CodEnvio>` +
    `<EnvioDTEID>${t(env.setId).slice(0, 80)}</EnvioDTEID>${env.digest ? `<Digest>${env.digest}</Digest>` : ''}<RutEmisor>${env.rutEmisor}</RutEmisor><RutReceptor>${env.rutReceptor}</RutReceptor>` +
    `<EstadoRecepEnv>0</EstadoRecepEnv><RecepEnvGlosa>Envio Recibido Conforme</RecepEnvGlosa><NroDTE>${env.docs.length}</NroDTE>${det}</RecepcionEnvio></Resultado>`
  return firmado('RespuestaDTE', resultado, 'Resultado', 'ResultadoEnvio')
}

// 2 · Aprobación comercial. 0 = aceptado; 2 = rechazado (RUT receptor ajeno, CodRchDsc -1).
export function armarResultadoDTE(env: EnvioRecibido, o: { rutResponde: string; codEnvio?: number; idRespuesta?: number; contacto?: Contacto; ts: string }): string {
  const propio = rut(o.rutResponde)
  const det = env.docs.map(d => { const ok = d.rutRecep === propio
    return `<ResultadoDTE>${docCampos(d)}<CodEnvio>${o.codEnvio || 1}</CodEnvio><EstadoDTE>${ok ? 0 : 2}</EstadoDTE><EstadoDTEGlosa>${ok ? 'DTE Aceptado OK' : 'DTE Rechazado - RUT Receptor no corresponde'}</EstadoDTEGlosa>${ok ? '' : '<CodRchDsc>-1</CodRchDsc>'}</ResultadoDTE>` }).join('')
  const resultado = `<Resultado ID="ResultadoDTE">${caratulaResp(propio, env.rutEmisor, o.idRespuesta || 2, env.docs.length, o.contacto || {}, o.ts)}${det}</Resultado>`
  return firmado('RespuestaDTE', resultado, 'Resultado', 'ResultadoDTE')
}

// 3 · Recibo de mercaderías o servicios (Ley 19.983). Cada DocumentoRecibo se firma; luego el SetRecibos completo.
export function armarEnvioRecibos(env: EnvioRecibido, o: { rutResponde: string; rutFirma: string; recinto?: string; contacto?: Contacto; ts: string }): string {
  const propio = rut(o.rutResponde), c = o.contacto || {}
  const recibos = env.docs.filter(d => d.rutRecep === propio).map((d, i) => {
    const id = `R${i + 1}`
    const doc = `<DocumentoRecibo ID="${id}"><TipoDoc>${d.tipoDte}</TipoDoc><Folio>${d.folio}</Folio><FchEmis>${d.fchEmis}</FchEmis><RUTEmisor>${d.rutEmisor}</RUTEmisor>` +
      `<RUTRecep>${d.rutRecep}</RUTRecep><MntTotal>${d.mntTotal}</MntTotal><Recinto>${t(o.recinto || 'Oficina').slice(0, 80)}</Recinto><RutFirma>${rut(o.rutFirma)}</RutFirma>` +
      `<Declaracion>${DECLARACION}</Declaracion><TmstFirmaRecibo>${o.ts}</TmstFirmaRecibo></DocumentoRecibo>`
    return `<Recibo version="1.0">${doc}${firmarReferencia(doc.replace('<DocumentoRecibo ', `<DocumentoRecibo xmlns="${SIIDTE}" `), '#' + id)}</Recibo>`
  })
  if (!recibos.length) throw new Error('Ningún documento del envío está dirigido al estudio: no corresponde recibo.')
  const set = `<SetRecibos ID="SetDteRecibidos"><Caratula version="1.0"><RutResponde>${propio}</RutResponde><RutRecibe>${env.rutEmisor}</RutRecibe>` +
    `${c.nombre ? `<NmbContacto>${t(c.nombre).slice(0, 40)}</NmbContacto>` : ''}${c.fono ? `<FonoContacto>${t(c.fono).slice(0, 40)}</FonoContacto>` : ''}${c.mail ? `<MailContacto>${t(c.mail).slice(0, 80)}</MailContacto>` : ''}` +
    `<TmstFirmaEnv>${o.ts}</TmstFirmaEnv></Caratula>${recibos.join('')}</SetRecibos>`
  return firmado('EnvioRecibos', set, 'SetRecibos', 'SetDteRecibidos')
}
