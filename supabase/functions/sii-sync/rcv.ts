// rcv.ts — consulta del Registro de Compras y Ventas, tipo VENTA.
//
// HALLAZGOS (probados contra produccion con script local, 2026-06):
// - El facadeService acepta el token de la danza en DOS cookies: TOKEN y
//   CSESSIONID, ambas con el mismo valor. Sin bootstrap de SPA ni recaptcha.
// - getDetalleVenta EXIGE codTipoDoc especifico (33, 34, ...): con '0' (todos)
//   responde codError cdvc17.05.04. Por eso se consulta cada tipo por separado.
// - codRespuesta 0 = OK con filas; 99 = "no hay documentos" (lista vacia, no error).
//
// El RCV solo existe en PRODUCCION (www4); con SII_AMBIENTE=certificacion la danza
// de auth sirve para validar la firma pero esta consulta no aplica.
//
// Solo se consultan DTE 33 (factura electronica) y 34 (factura exenta). El estudio
// emite exentas (34): montoTotal = montoExento, IVA 0, por lo que el match contra
// billing.amount (que guarda el TOTAL) es directo.

// deno-lint-ignore-file no-explicit-any
import { getConfig } from './config.ts'
import { fetchSII, conReintentos } from './http.ts'

export interface VentaSII {
  rutReceptor: string
  nombreReceptor: string
  folio: number
  tipoDte: number
  fechaEmision: string   // ISO YYYY-MM-DD
  montoNeto: number
  montoExento: number
  montoTotal: number
}

const NAMESPACE = 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService'
// La interfaz del SII envia un transactionId corto (hex de 13 chars)
const transId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 13)

// "06/06/2026" (formato del SII) -> "2026-06-06"
function fechaISO(f: string): string {
  const m = (f || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (f || '')
}

// Consulta el detalle de ventas de UN tipo de documento. Devuelve filas crudas.
async function detallePorTipo(tipoDoc: number, periodo: string, token: string): Promise<any[]> {
  const { rcvBase, rutEmpresa, timeoutMs } = getConfig()
  const limpio = rutEmpresa.replace(/\./g, '').toUpperCase()
  const [rut, dv] = limpio.split('-')
  if (!rut || !dv) throw new Error('SII_RUT_EMPRESA invalido (formato esperado: 77700387-9)')

  const url = `${rcvBase}/consdcvinternetui/services/data/facadeService/getDetalleVenta`
  const body = JSON.stringify({
    metaData: {
      conversationId: token,
      transactionId: transId(),
      namespace: `${NAMESPACE}/getDetalleVenta`,
    },
    data: {
      rutEmisor: rut,
      dvEmisor: dv,
      ptributario: periodo.replace('-', ''),  // YYYY-MM -> YYYYMM
      estadoContab: 'REGISTRO',
      codTipoDoc: String(tipoDoc),
      operacion: 'VENTA',
    },
  })

  const res = await fetchSII(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; FirmDesk/1.0)',
      'Referer': `${rcvBase}/consdcvinternetui/`,
      'Cookie': `TOKEN=${token}; CSESSIONID=${token}`,
    },
    body,
  }, timeoutMs)
  const text = await res.text()
  if (!res.ok) throw new Error(`RCV HTTP ${res.status}: ${text.slice(0, 200)}`)

  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`RCV: respuesta no es JSON (token invalido o sesion expirada): ${text.slice(0, 150)}`)
  }

  const cod = Number(json?.respEstado?.codRespuesta ?? 0)
  // 99 = "no hay documentos de este tipo en el periodo": no es error, lista vacia
  if (cod === 99) return []
  if (cod !== 0) {
    const msg = json?.respEstado?.msgeRespuesta || json?.respEstado?.codError || ('codigo ' + cod)
    console.log(`[sii-sync] RCV tipo ${tipoDoc} respEstado: ${JSON.stringify(json?.respEstado || {})}`)
    throw new Error(`RCV: ${msg}`)
  }
  return Array.isArray(json?.data) ? json.data : []
}

export async function getVentas(periodo: string, token: string): Promise<VentaSII[]> {
  return await conReintentos('consulta RCV', async () => {
    // El backend exige tipo especifico: 33 (afecta) y 34 (exenta) por separado
    const [t33, t34] = await Promise.all([
      detallePorTipo(33, periodo, token),
      detallePorTipo(34, periodo, token),
    ])
    const docs = [...t33, ...t34]
    console.log(`[sii-sync] RCV ${periodo}: ${t33.length} tipo 33 + ${t34.length} tipo 34`)

    return docs
      .map((d) => ({
        tipoDte: Number(d.detTipoDoc ?? 0),
        folio: Number(d.detNroDoc ?? 0),
        rutReceptor: `${d.detRutDoc ?? ''}-${String(d.detDvDoc ?? '').toUpperCase()}`,
        nombreReceptor: String(d.detRznSoc ?? ''),
        fechaEmision: fechaISO(String(d.detFchDoc ?? '')),
        montoNeto: Number(d.detMntNeto ?? 0),
        montoExento: Number(d.detMntExe ?? 0),
        montoTotal: Number(d.detMntTotal ?? 0),
      }))
      .filter((v) => v.folio > 0)
  })
}
