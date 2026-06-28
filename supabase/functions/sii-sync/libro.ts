// libro.ts — Libro de Ventas electrónico (IECV) para la certificación del SII.
//
// El SII exige, además de los DTE del set de pruebas, el Libro de Ventas (LibroCompraVenta).
// Este módulo lo ARMA y FIRMA (reusa firmarReferencia de firma.ts). El ENDPOINT de envío del
// libro se confirma en certificación; por ahora la ruta lo devuelve firmado para revisar/subir
// por el portal. ⚠ Esquema (TipoLibro, FolioNotificacion, campos del resumen) se valida en cert.

// deno-lint-ignore-file no-explicit-any
import { firmarReferencia } from './firma.ts'

const SIIDTE = 'http://www.sii.cl/SiiDte'
const num = (v: any) => Math.round(Number(v) || 0)
const rut = (r: any) => String(r ?? '').replace(/\./g, '').replace(/\s/g, '').toUpperCase()
const txt = (s: any) => String(s ?? '').replace(/[<>&]/g, ' ').replace(/\s+/g, ' ').trim()

export interface LibroDetalle {
  tpoDoc: number; nroDoc: number; fchDoc: string; rutDoc: string; rznSoc?: string
  mntExe?: number; mntNeto?: number; iva?: number; mntTotal: number
}
export interface LibroCaratula {
  rutEmisor: string; rutEnvia: string; periodo: string; fchResol: string; nroResol: number
}

export function armarLibroVentas(car: LibroCaratula, detalle: LibroDetalle[], nowIso: string): string {
  const libroId = 'LibroVenta'

  // Resumen por tipo de documento (TotalesPeriodo).
  const porTipo: Record<number, { tot: number; exe: number; neto: number; iva: number; total: number }> = {}
  detalle.forEach(d => {
    const r = porTipo[d.tpoDoc] || { tot: 0, exe: 0, neto: 0, iva: 0, total: 0 }
    r.tot++; r.exe += num(d.mntExe); r.neto += num(d.mntNeto); r.iva += num(d.iva); r.total += num(d.mntTotal)
    porTipo[d.tpoDoc] = r
  })
  const resumen = Object.entries(porTipo).map(([t, r]) =>
    `<TotalesPeriodo><TpoDoc>${t}</TpoDoc><TotDoc>${r.tot}</TotDoc>` +
    (r.exe ? `<TotMntExe>${r.exe}</TotMntExe>` : '') +
    (r.neto ? `<TotMntNeto>${r.neto}</TotMntNeto>` : '') +
    (r.iva ? `<TotMntIVA>${r.iva}</TotMntIVA>` : '') +
    `<TotMntTotal>${r.total}</TotMntTotal></TotalesPeriodo>`,
  ).join('')

  const det = detalle.map(d =>
    `<Detalle>` +
    `<TpoDoc>${d.tpoDoc}</TpoDoc><NroDoc>${d.nroDoc}</NroDoc><FchDoc>${d.fchDoc}</FchDoc>` +
    `<RUTDoc>${rut(d.rutDoc)}</RUTDoc>` +
    (d.rznSoc ? `<RznSoc>${txt(d.rznSoc).slice(0, 50)}</RznSoc>` : '') +
    (d.mntExe ? `<MntExe>${num(d.mntExe)}</MntExe>` : '') +
    (d.mntNeto ? `<MntNeto>${num(d.mntNeto)}</MntNeto>` : '') +
    (d.iva ? `<MntIVA>${num(d.iva)}</MntIVA>` : '') +
    `<MntTotal>${num(d.mntTotal)}</MntTotal>` +
    `</Detalle>`,
  ).join('')

  const envioLibro =
    `<EnvioLibro ID="${libroId}">` +
    `<Caratula>` +
    `<RutEmisorLibro>${rut(car.rutEmisor)}</RutEmisorLibro>` +
    `<RutEnvia>${rut(car.rutEnvia)}</RutEnvia>` +
    `<PeriodoTributario>${car.periodo}</PeriodoTributario>` +
    `<FchResol>${car.fchResol}</FchResol>` +
    `<NroResol>${car.nroResol}</NroResol>` +
    `<TipoOperacion>VENTA</TipoOperacion>` +
    `<TipoLibro>MENSUAL</TipoLibro>` +
    `<TipoEnvio>TOTAL</TipoEnvio>` +
    `<FolioNotificacion>1</FolioNotificacion>` +
    `</Caratula>` +
    `<ResumenPeriodo>${resumen}</ResumenPeriodo>` +
    det +
    `<TmstFirma>${nowIso.slice(0, 19)}</TmstFirma>` +
    `</EnvioLibro>`

  // Firma con el xmlns SiiDte heredado del contenedor (mismo criterio que el DTE).
  const canon = `<EnvioLibro xmlns="${SIIDTE}" ` + envioLibro.slice('<EnvioLibro '.length)
  const firma = firmarReferencia(canon, '#' + libroId)

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<LibroCompraVenta xmlns="${SIIDTE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="${SIIDTE} LibroCV_v10.xsd" version="1.0">` +
    envioLibro + firma +
    `</LibroCompraVenta>`
  )
}
