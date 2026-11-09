// Datos de partida del Presupuesto anual (año siguiente). Cada cifra sale de la MISMA fuente que el resto de la app:
//  · Vendido, Facturado, Cobrado y Margen del año, con su meta: useResultadoAnio + pctsAnio (los de Inicio y el Panel de socios).
//  · Facturado propio por mes (pesos y UF del día de cada factura): resultadoMes (el de Resultado del año).
//  · Cobrado por mes: conciliación a factura o anticipo por fecha del depósito (como Inicio).
// Lo que no tiene una regla única en la app (concentración por cliente, días de cobro, recurrente) se calcula aquí con helpers de cifras.js y _shared.
import { useMemo } from 'react'
import { useResultadoAnio, pctsAnio } from './resultadoAnio.js'
import { resultadoMes, ufDelDia, currentYear, esPPMcosto, montoFactura, usePorSocioFuentes, partidasPorSocio, vendidoPorSocio, ADMIN_NAMES, SIN_SOCIO } from './compartido.jsx'
import { esRecurrente, esSubarriendo, ventaCLP, ventaUF, kpisPorSocio } from './cifras.js'
import { ultimosCerrados, baseMensual, diasDeCobro, concentracion } from '../../supabase/functions/_shared/presupuesto.js'

/** Categorías de costo que son fijas (el resto se trata como discrecional). */
export const CATEGORIAS_FIJAS = ['Remuneraciones', 'Leyes sociales', 'Arriendo y espacio', 'Arriendo y GGCC', 'Contadora']

const hoyISO = () => new Date().toLocaleDateString('en-CA')

/**
 * @param {{ sales:any[], billing:any[], terceros:any[], costosOfiRows:any[], expenses:any[], clients:any[], anticipos:any[] }} p
 */
export function usePresupuestoDatos({ sales = [], billing = [], terceros = [], costosOfiRows = [], expenses = [], clients = [], anticipos = [] }) {
  const R = useResultadoAnio({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos, selYear: currentYear })
  const { fuRes, ufDias, ufRef, m, metaUF, resAnio, ingresosPorAnioVenta: ing, comisPagadasAnioVenta: com, metaCobranza, ingConc, ingAbonos, _esFactHon, extBillIds } = R

  const hoy = hoyISO(), anio = currentYear + 1, ymHoy = hoy.slice(0, 7)

  // Facturado propio por mes, de enero del año anterior hasta el mes en curso (el en curso va «a la fecha»). Es lo pesado: solo se recalcula si cambian las fuentes.
  const serie = useMemo(() => {
    const deps = { billing, terceros, costosOfiRows, expenses, clients, ufd: ufDias, ufFb: ufRef }
    /** @type {Record<string,{fac:number,facUF:number}>} */
    const o = {}
    for (let y = currentYear - 1; y <= currentYear; y++) for (let mm = 1; mm <= 12; mm++) {
      const ym = `${y}-${String(mm).padStart(2, '0')}`
      if (ym > ymHoy) break
      const r = resultadoMes(fuRes, deps, ym)
      o[ym] = { fac: r.fac || 0, facUF: r.facUF || 0 }
    }
    return o
  }, [fuRes, billing, terceros, costosOfiRows, expenses, clients, ufDias, ufRef, ymHoy])

  // Cobrado por mes (banco): abonos no internos conciliados a factura o anticipo, por fecha del depósito.
  const cobMes = useMemo(() => {
    /** @type {Record<string,string>} */
    const fechaAbono = {}
    ;(ingAbonos || []).forEach((a) => { fechaAbono[String(a.id)] = String(a.fecha || '').slice(0, 10) })
    /** @type {Record<string,number>} */
    const o = {}
    ;(ingConc || []).forEach((c) => { const f = fechaAbono[String(c.movimiento_id)]; if (f) o[f.slice(0, 7)] = (o[f.slice(0, 7)] || 0) + (Number(c.monto_aplicado) || 0) })
    return o
  }, [ingConc, ingAbonos])

  // Facturado por cliente en el año (honorarios propios; sin lo facturado por cuenta de terceros), de mayor a menor.
  const clientes = useMemo(() => {
    /** @type {Record<string,{id:string,name:string,monto:number,n:number}>} */
    const porCli = {}
    const nombreDe = (/** @type {any} */ id) => (clients || []).find((c) => String(c.id) === String(id))?.name || 'Sin cliente'
    ;(billing || []).forEach((b) => {
      if (!_esFactHon(b) || extBillIds.has(String(b.id)) || String(b.issued_at || '').slice(0, 4) !== String(currentYear)) return
      const k = String(b.client_id || 'x'), c = porCli[k] || (porCli[k] = { id: k, name: nombreDe(b.client_id), monto: 0, n: 0 })
      c.monto += montoFactura(b); c.n++
    })
    return Object.values(porCli).filter((c) => c.monto > 0).sort((a, b) => b.monto - a.monto)
  }, [billing, clients, extBillIds])  // eslint-disable-line react-hooks/exhaustive-deps

  const dias = useMemo(() => diasDeCobro(billing, currentYear), [billing])

  // Facturado del año por socio con la regla única de atribución de «Por socio» (decisión guardada → subarriendo → responsable de la venta → abogado del cliente).
  const [fuSocio] = usePorSocioFuentes()
  const P = useMemo(() => partidasPorSocio({ billing, sales, clients, anticipos, terceros, expenses, ic: fuSocio.ic, ia: fuSocio.ia, ov: fuSocio.ov, fondoExtra: {} }), [billing, sales, clients, anticipos, terceros, expenses, fuSocio])
  const V = useMemo(() => vendidoPorSocio(sales, clients, ufRef, currentYear), [sales, clients, ufRef])
  const { emitido } = useMemo(() => kpisPorSocio({ P, V, ym: ymHoy }), [P, V, ymHoy])
  const socios = [...ADMIN_NAMES, SIN_SOCIO].map((nombre) => ({ nombre, facturado: Math.max(0, emitido(nombre, 'ytd').f || 0) }))

  // Base: últimos 12 meses cerrados, cada uno en el mes calendario del año del presupuesto.
  const cierres = ultimosCerrados(hoy).map((ym) => ({ ym, clp: serie[ym]?.fac || 0, uf: serie[ym]?.facUF || 0 }))
  const ufDic = ufDelDia(ufDias, `${currentYear}-12-31`, ufRef)
  const base = baseMensual(cierres, ufDic)

  // Cifras oficiales del año (las de Inicio), con su meta.
  const { ventaPct, factPct, cobroPct } = pctsAnio({ m, resAnio, metaUF, ingYTD: ing?.total || 0, metaCobranza })
  const oficiales = {
    vend: { uf: m.brutoUF, clp: m.bruto, pct: m.meta > 0 ? ventaPct : null },
    fact: { uf: resAnio.verUF?.fac || 0, clp: resAnio.verCLP?.fac || 0, pct: m.bruto > 0 ? factPct : null },
    cob: { uf: ing?.totalUF || 0, clp: ing?.total || 0, pct: metaCobranza > 0 ? cobroPct : null },
    marg: { uf: resAnio.verUF?.res || 0, clp: resAnio.verCLP?.res || 0, pct: resAnio.pct },
    metaVentasCLP: m.meta || 0, metaCobroCLP: metaCobranza || 0,
  }
  const totalFact = clientes.reduce((a, c) => a + c.monto, 0)

  // Evolución del año: vendido acumulado por mes de inicio de cada venta y cobrado acumulado por fecha del depósito, ambos llevados al total oficial de Inicio (estimación propia: reparte el total oficial según las partidas).
  const evo = useMemo(() => {
    const Y = currentYear, H = Number(hoy.slice(5, 7)) - 1
    const kV = V.reduce((a, x) => a + (x.m || 0), 0) > 0 && oficiales.vend.clp > 0 ? oficiales.vend.clp / V.reduce((a, x) => a + (x.m || 0), 0) : 1
    const porMes = Array(12).fill(0)
    V.forEach((x) => { const i = String(x.ym).slice(0, 4) === String(Y) ? Number(String(x.ym).slice(5, 7)) - 1 : 0; porMes[Math.max(0, Math.min(11, i))] += (x.m || 0) * kV })
    let ac = 0
    const vend = porMes.map((v, i) => (i <= H ? (ac += v) : null))
    const fechaAbono = /** @type {Record<string,string>} */ ({})
    ;(ingAbonos || []).forEach((a) => { fechaAbono[String(a.id)] = String(a.fecha || '').slice(0, 10) })
    const dep = (ingConc || []).map((c) => ({ f: fechaAbono[String(c.movimiento_id)] || '', m: Number(c.monto_aplicado) || 0 })).filter((x) => x.f.slice(0, 4) === String(Y)).sort((a, b) => (a.f < b.f ? -1 : 1))
    const tot = dep.reduce((a, x) => a + x.m, 0), kC = tot > 0 && oficiales.cob.clp > 0 ? oficiales.cob.clp / tot : 1
    let cc = 0, cruceC = /** @type {string|null} */ (null)
    const cobMesAc = Array(12).fill(0)
    dep.forEach((x) => { cc += x.m * kC; if (!cruceC && oficiales.metaCobroCLP > 0 && cc >= oficiales.metaCobroCLP) cruceC = x.f; cobMesAc[Number(x.f.slice(5, 7)) - 1] = cc })
    let u = 0; const cob = cobMesAc.map((v, i) => { if (v > 0) u = v; return i <= H ? u : null })
    const iV = oficiales.metaVentasCLP > 0 ? vend.findIndex((v) => v != null && v >= oficiales.metaVentasCLP) : -1
    /** @type {Record<string,number>} */ const ar = {}
    V.forEach((x) => { const k = x.s?.area || 'Sin área'; ar[k] = (ar[k] || 0) + (x.m || 0) * kV })
    const totA = Object.values(ar).reduce((a, v) => a + v, 0)
    /** @type {Record<string,{monto:number,n:number}>} */ const tp = {}
    const tipoDe = (/** @type {any} */ id) => (clients || []).find((c) => String(c.id) === String(id))?.type || 'Sin tipo'
    clientes.forEach((c) => { const k = tipoDe(c.id), t = tp[k] || (tp[k] = { monto: 0, n: 0 }); t.monto += c.monto; t.n++ })
    const totT = Object.values(tp).reduce((a, v) => a + v.monto, 0)
    return {
      vend, cob, cruceV: iV >= 0 ? iV : null, cruceC,
      areas: Object.entries(ar).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([n, monto]) => ({ n, monto, pct: totA ? (monto / totA) * 100 : 0 })),
      tipos: Object.entries(tp).sort((a, b) => b[1].monto - a[1].monto).map(([n, t]) => ({ n, monto: t.monto, nClientes: t.n, pct: totT ? (t.monto / totT) * 100 : 0 })),
    }
  }, [V, ingConc, ingAbonos, clientes, clients, hoy])  // eslint-disable-line react-hooks/exhaustive-deps

  // Recurrente (ventas mensuales activas, sin subarriendo), anualizado como en Ventas.
  const rec = (sales || []).filter((s) => !s.deleted_at && esRecurrente(s) && !esSubarriendo(s))
  const recurrente = { n: rec.length, anualCLP: rec.reduce((a, s) => a + ventaCLP(s, ufRef), 0), anualUF: rec.reduce((a, s) => a + ventaUF(s, ufRef), 0) }

  // Costos de oficina vigentes por categoría (sin PPM ni ingresos), con la regla de vigencia de resultadoMes; el PPM aparte.
  const eff = (/** @type {any} */ r) => (r.desde && ymHoy < String(r.desde).slice(0, 7) ? (r.monto_prev ?? r.monto) : r.monto)
  /** @type {Record<string,number>} */
  const porCat = {}
  let ppmMes = 0
  ;(costosOfiRows || []).forEach((r) => {
    if (!r || r.es_ingreso) return
    const v = Number(eff(r)) || 0
    if (esPPMcosto(r)) { ppmMes += v; return }
    porCat[r.categoria || 'Otros'] = (porCat[r.categoria || 'Otros'] || 0) + v
  })
  const costos = Object.entries(porCat).filter(([, v]) => v > 0).map(([n, v], i) => ({ id: i, n, m: Math.round(v), meses: 12, t: CATEGORIAS_FIJAS.includes(n) ? 'fijo' : 'discrecional', alza: /** @type {number|null} */ (null) }))

  // Pagos a terceros como % de lo cobrado (comisiones pagadas del año contra cobrado propio): los mismos totales de Inicio.
  const terc = (ing?.total || 0) > 0 ? ((com?.total || 0) / ing.total) * 100 : null

  return {
    hoy, anio, anioBase: currentYear, ufRef, ufDic, serie, cobMes, base, sinBase: base.baseCLP.every((x) => !x), cierres, oficiales,
    clientes, totalFact, evo, concentracion5: concentracion(clientes.map((c) => c.monto), totalFact, 5),
    recurrente, costos, ppmMes, terc, dias, socios,
  }
}
