// emision.ts — sobre <EnvioDTE>: Carátula + firma del <SetDTE> + envío al SII (DTEUpload) + estado.
//
// Reutiliza la danza de auth.ts (obtenerToken) y http.ts (fetchSII/conReintentos).
// ⚠ Todo el ida-y-vuelta con el SII y la codificación se validan en CERTIFICACIÓN (maullin):
//   - ENCODING: el DTE chileno tradicionalmente va en ISO-8859-1. Acá se emite UTF-8 (consistente
//     con los digests de forge, que firman bytes UTF-8). Si el SII exige latin1, hay que emitir y
//     digerir en ISO-8859-1 — punto a confirmar con texto acentuado real (razón social/glosa).
//   - DTEUpload (multipart) y QueryEstUp (SOAP): el formato exacto de campos/respuesta se afina
//     contra el ambiente de pruebas.

import { getConfig } from './config.ts'
import { fetchSII, conReintentos } from './http.ts'
import { obtenerToken } from './auth.ts'
import { firmarSetDTE } from './firma.ts'

const SIIDTE = 'http://www.sii.cl/SiiDte'
const RUT_SII = '60803000-K'

export interface CaratulaInput {
  rutEmisor: string
  rutEnvia: string
  fchResol: string                              // YYYY-MM-DD (resolución SII; en cert, la fecha de set-up)
  nroResol: number                              // 0 en certificación
  subtotales: { tipoDte: number; nro: number }[]
}

const splitRut = (r: string) => {
  const [num, dv] = String(r).replace(/\./g, '').toUpperCase().split('-')
  return { num: num || '', dv: dv || '' }
}

// Arma el EnvioDTE con SetDTE + Carátula y firma el SetDTE. `dtesFirmados` = <DTE>…</DTE> ya firmados.
export function armarEnvioDTE(dtesFirmados: string[], car: CaratulaInput, nowIso: string): string {
  const setId = 'SetDoc'
  const subtot = car.subtotales
    .map(s => `<SubTotDTE><TpoDTE>${s.tipoDte}</TpoDTE><NroDTE>${s.nro}</NroDTE></SubTotDTE>`)
    .join('')
  const caratula =
    `<Caratula version="1.0">` +
    `<RutEmisor>${car.rutEmisor}</RutEmisor>` +
    `<RutEnvia>${car.rutEnvia}</RutEnvia>` +
    `<RutReceptor>${RUT_SII}</RutReceptor>` +
    `<FchResol>${car.fchResol}</FchResol>` +
    `<NroResol>${car.nroResol}</NroResol>` +
    `<TmstFirmaEnv>${nowIso.slice(0, 19)}</TmstFirmaEnv>` +
    subtot +
    `</Caratula>`
  const setDte = `<SetDTE ID="${setId}">${caratula}${dtesFirmados.join('')}</SetDTE>`
  const firma = firmarSetDTE(setDte, setId)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<EnvioDTE xmlns="${SIIDTE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="${SIIDTE} EnvioDTE_v10.xsd" version="1.0">` +
    setDte + firma +
    `</EnvioDTE>`
  )
}

// Envía el sobre al SII (DTEUpload: multipart/form-data + cookie TOKEN). Devuelve el TrackID.
export async function enviarAlSII(envioXml: string): Promise<string> {
  const cfg = getConfig()
  const token = await obtenerToken()
  const e = splitRut(cfg.rutEnvia), c = splitRut(cfg.rutEmpresa)
  return await conReintentos('envío DTE al SII', async () => {
    const fd = new FormData()
    fd.append('rutSender', e.num); fd.append('dvSender', e.dv)
    fd.append('rutCompany', c.num); fd.append('dvCompany', c.dv)
    fd.append('archivo', new Blob([envioXml], { type: 'text/xml' }), 'envio.xml')
    const res = await fetchSII(cfg.uploadUrl, { method: 'POST', headers: { Cookie: `TOKEN=${token}` }, body: fd }, cfg.timeoutMs)
    const txt = await res.text()
    if (!res.ok) throw new Error(`DTEUpload HTTP ${res.status}: ${txt.slice(0, 200)}`)
    const m = txt.match(/<TRACKID>(\d+)<\/TRACKID>/i) || txt.match(/TRACKID["'>\s:]+(\d+)/i)
    if (!m) throw new Error(`DTEUpload no devolvió TRACKID: ${txt.slice(0, 250)}`)
    return m[1]
  })
}

// Consulta el estado de un envío por TrackID (QueryEstUp.jws). Devuelve estado + glosa crudos del SII.
export async function consultarEstado(trackId: string): Promise<{ estado: string; glosa: string }> {
  const cfg = getConfig()
  const token = await obtenerToken()
  const c = splitRut(cfg.rutEmpresa)
  const envelope =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:def="http://DefaultNamespace">' +
    '<soapenv:Header/><soapenv:Body>' +
    `<def:getEstUp><Token>${token}</Token><Rut>${c.num}</Rut><Dv>${c.dv}</Dv><TrackId>${trackId}</TrackId></def:getEstUp>` +
    '</soapenv:Body></soapenv:Envelope>'
  const res = await fetchSII(
    cfg.estadoUrl,
    { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: '""' }, body: envelope },
    cfg.timeoutMs,
  )
  const txt = await res.text()
  const estado = (txt.match(/<ESTADO>([^<]*)<\/ESTADO>/i) || [])[1] || ''
  const glosa = (txt.match(/<GLOSA>([^<]*)<\/GLOSA>/i) || [])[1] || txt.slice(0, 200)
  return { estado, glosa }
}
