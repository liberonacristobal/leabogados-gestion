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

// ────────────────────────────────────────────────────────────────────────────
// COMPRAS (Registro de Compras del RCV) — DRAFT, solo LECTURA. Espeja getVentas.
//
// A diferencia de una venta (donde el estudio es el emisor y el cliente el
// receptor), en una compra el estudio es el RECEPTOR y el proveedor es el
// EMISOR. Por eso aqui capturamos los datos del EMISOR (proveedor).
//
// PUNTOS A VERIFICAR CONTRA LA RESPUESTA REAL DEL SII (getDetalleCompra) ANTES
// DE DESPLEGAR — no tengo certeza de estos y estan marcados abajo:
//   (V1) Nombres de campo del detalle de compra: en ventas son detRutDoc/detDvDoc/
//        detRznSoc/detNroDoc/detTipoDoc/detFchDoc/detMntNeto/detMntExe/detMntTotal.
//        En COMPRAS la respuesta suele traer ADEMAS el IVA desglosado (campo tipo
//        detMntIVA). Confirmar el nombre EXACTO de cada campo con un dump real.
//   (V2) Si getDetalleCompra tambien EXIGE codTipoDoc especifico (como ventas) o
//        acepta '0' (todos). Si lo exige, hay que iterar por cada tipo — abajo se
//        itera por [33, 34] por defecto; el universo de compras es mas amplio
//        (46 factura de compra, 56 nota debito, 61 nota credito, 914 DIN...).
//        Ver COMPRA_TIPOS: ampliar segun lo que reciba el estudio.
//   (V3) estadoContab: en ventas es 'REGISTRO'. En compras el RCV distingue
//        estados: REGISTRO, PENDIENTE, NO_INCLUIR, RECLAMADO. Confirmar cual(es)
//        interesan (probablemente 'REGISTRO'; quizas tambien 'PENDIENTE').
//   (V4) namespace: se asume el mismo NAMESPACE con sufijo '/getDetalleCompra'.
//        Confirmar que el facadeService no exige otro namespace para compras.
//   (V5) codRespuesta: se asume misma semantica que ventas (0 = OK, 99 = vacio).

export interface CompraSII {
  rutEmisor: string       // RUT del proveedor (emisor del documento)
  nombreEmisor: string    // razon social del proveedor
  folio: number
  tipoDte: number
  fechaEmision: string    // ISO YYYY-MM-DD
  montoNeto: number
  montoExento: number
  montoIva: number
  montoTotal: number
}

// VERIFICAR (V2): tipos de documento de compra a consultar. Si getDetalleCompra
// acepta '0' (todos) se puede reemplazar esta iteracion por una sola llamada.
const COMPRA_TIPOS = [33, 34] // TODO: ampliar (46, 56, 61, 914...) segun (V2)/(V3)

// Consulta el detalle de compras de UN tipo de documento. Espejo de detallePorTipo.
async function detalleComprasPorTipo(tipoDoc: number, periodo: string, token: string): Promise<any[]> {
  const { rcvBase, rutEmpresa, timeoutMs } = getConfig()
  const limpio = rutEmpresa.replace(/\./g, '').toUpperCase()
  const [rut, dv] = limpio.split('-')
  if (!rut || !dv) throw new Error('SII_RUT_EMPRESA invalido (formato esperado: 77700387-9)')

  // VERIFICAR (V4): endpoint getDetalleCompra (espejo de getDetalleVenta).
  const url = `${rcvBase}/consdcvinternetui/services/data/facadeService/getDetalleCompra`
  const body = JSON.stringify({
    metaData: {
      conversationId: token,
      transactionId: transId(),
      // VERIFICAR (V4): ¿mismo namespace con sufijo getDetalleCompra?
      namespace: `${NAMESPACE}/getDetalleCompra`,
    },
    data: {
      // En compras, el estudio es el RECEPTOR. VERIFICAR (V1): confirmar si la API
      // espera rutEmisor/dvEmisor (como ventas, refiriendose al titular de la
      // consulta) o rutReceptor/dvReceptor. En ventas se envia rutEmisor = titular.
      rutEmisor: rut,
      dvEmisor: dv,
      ptributario: periodo.replace('-', ''),  // YYYY-MM -> YYYYMM
      // VERIFICAR (V3): estado contable a consultar en compras.
      estadoContab: 'REGISTRO',
      codTipoDoc: String(tipoDoc),
      operacion: 'COMPRA',
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
  if (!res.ok) throw new Error(`RCV compra HTTP ${res.status}: ${text.slice(0, 200)}`)

  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`RCV compra: respuesta no es JSON (token invalido o sesion expirada): ${text.slice(0, 150)}`)
  }

  const cod = Number(json?.respEstado?.codRespuesta ?? 0)
  // VERIFICAR (V5): se asume misma semantica que ventas (99 = sin documentos).
  if (cod === 99) return []
  if (cod !== 0) {
    const msg = json?.respEstado?.msgeRespuesta || json?.respEstado?.codError || ('codigo ' + cod)
    console.log(`[sii-sync] RCV compra tipo ${tipoDoc} respEstado: ${JSON.stringify(json?.respEstado || {})}`)
    throw new Error(`RCV compra: ${msg}`)
  }
  return Array.isArray(json?.data) ? json.data : []
}

export async function getCompras(periodo: string, token: string): Promise<CompraSII[]> {
  return await conReintentos('consulta RCV compras', async () => {
    // VERIFICAR (V2): si la API exige tipo especifico, se itera; si acepta todos,
    // basta una sola llamada con codTipoDoc '0'.
    const porTipo = await Promise.all(COMPRA_TIPOS.map((t) => detalleComprasPorTipo(t, periodo, token)))
    const docs = porTipo.flat()
    console.log(`[sii-sync] RCV compras ${periodo}: ${COMPRA_TIPOS.map((t, i) => `${porTipo[i].length} tipo ${t}`).join(' + ')}`)

    return docs
      .map((d) => ({
        // VERIFICAR (V1): confirmar TODOS estos nombres de campo con un dump real de
        // getDetalleCompra. Los de abajo son los de ventas (detRutDoc etc.), que
        // NO tengo confirmados para compras. El IVA (detMntIVA) en particular no
        // existe en la respuesta de ventas — confirmar su nombre exacto.
        tipoDte: Number(d.detTipoDoc ?? 0),
        folio: Number(d.detNroDoc ?? 0),
        rutEmisor: `${d.detRutDoc ?? ''}-${String(d.detDvDoc ?? '').toUpperCase()}`,
        nombreEmisor: String(d.detRznSoc ?? ''),
        fechaEmision: fechaISO(String(d.detFchDoc ?? '')),
        montoNeto: Number(d.detMntNeto ?? 0),
        montoExento: Number(d.detMntExe ?? 0),
        montoIva: Number(d.detMntIVA ?? 0), // VERIFICAR (V1): nombre del campo IVA
        montoTotal: Number(d.detMntTotal ?? 0),
      }))
      .filter((c) => c.folio > 0)
  })
}
