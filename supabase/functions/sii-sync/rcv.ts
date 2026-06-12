// rcv.ts — consulta del Registro de Compras y Ventas, tipo VENTA.
//
// NOTA DE DIAGNOSTICO: el RCV moderno (www4.sii.cl facadeService) responde JSON,
// no el XML masivo de los servicios antiguos — el parseo es directo. El RCV solo
// existe en PRODUCCION; con SII_AMBIENTE=certificacion esta consulta no aplica
// (el token de maullin no es valido en www4).
//
// Solo se devuelven DTE tipo 33 (factura electronica) y 34 (factura exenta).
// El estudio emite exentas (34): montoTotal = montoExento, IVA 0, por lo que el
// match contra billing.amount (que guarda el TOTAL) es directo.

// deno-lint-ignore-file no-explicit-any
import { getConfig } from './config.ts'
import { fetchSII, conReintentos } from './http.ts'

export interface VentaSII {
  rutReceptor: string
  folio: number
  tipoDte: number
  fechaEmision: string   // ISO YYYY-MM-DD
  montoNeto: number
  montoExento: number
  montoTotal: number
}

// "06/06/2026" (formato del SII) -> "2026-06-06"
function fechaISO(f: string): string {
  const m = (f || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (f || '')
}

export async function getVentas(periodo: string, token: string): Promise<VentaSII[]> {
  const { rcvUrl, rutEmpresa, timeoutMs } = getConfig()
  const limpio = rutEmpresa.replace(/\./g, '').toUpperCase()
  const [rut, dv] = limpio.split('-')
  if (!rut || !dv) throw new Error('SII_RUT_EMPRESA invalido (formato esperado: 77700387-9)')

  const body = {
    metaData: {
      namespace: 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getDetalleCompraVenta',
      conversationId: token,
      transactionId: crypto.randomUUID(),
      page: null,
    },
    data: {
      rutEmisor: rut,
      dvEmisor: dv,
      ptributario: periodo.replace('-', ''),  // YYYY-MM -> YYYYMM
      estadoContab: 'REGISTRO',
      operacion: 'VENTA',
      busquedaInicial: true,
    },
  }

  return await conReintentos('consulta RCV', async () => {
    const res = await fetchSII(rcvUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Cookie': `TOKEN=${token}`,
      },
      body: JSON.stringify(body),
    }, timeoutMs)
    const text = await res.text()
    if (!res.ok) throw new Error(`RCV HTTP ${res.status}: ${text.slice(0, 200)}`)

    let json: any
    try {
      json = JSON.parse(text)
    } catch {
      // El SII devuelve HTML de login cuando el token no es valido
      throw new Error(`RCV: respuesta no es JSON (token invalido o sesion expirada): ${text.slice(0, 150)}`)
    }

    const cod = json?.respEstado?.codRespuesta
    if (cod !== undefined && cod !== 0 && cod !== '0') {
      throw new Error(`RCV: ${json?.respEstado?.msgeRespuesta || 'codigo ' + cod}`)
    }

    const docs: any[] = Array.isArray(json?.data) ? json.data : []
    console.log(`[sii-sync] RCV ${periodo}: ${docs.length} documentos recibidos`)

    return docs
      .map((d) => ({
        tipoDte: Number(d.detTipoDoc ?? 0),
        folio: Number(d.detNroDoc ?? 0),
        rutReceptor: `${d.detRutDoc ?? ''}-${String(d.detDvDoc ?? '').toUpperCase()}`,
        fechaEmision: fechaISO(String(d.detFchDoc ?? '')),
        montoNeto: Number(d.detMntNeto ?? 0),
        montoExento: Number(d.detMntExe ?? 0),
        montoTotal: Number(d.detMntTotal ?? 0),
      }))
      .filter((v) => (v.tipoDte === 33 || v.tipoDte === 34) && v.folio > 0)
  })
}
