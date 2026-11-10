// Datos de partida del Presupuesto anual (año siguiente). Cada cifra sale de la MISMA fuente que el resto de la app:
//  · Vendido, Facturado, Cobrado y Margen del año, con su meta: useResultadoAnio + pctsAnio (los de Inicio y el Panel de socios).
//  · Facturado propio por mes (pesos y UF del día de cada factura): resultadoMes (el de Resultado del año).
//  · Cobrado por mes: conciliación a factura o anticipo por fecha del depósito (como Inicio).
// Lo que no tiene una regla única en la app (concentración por cliente, días de cobro, recurrente) se calcula aquí con helpers de cifras.js y _shared.
import { useMemo } from 'react'
import { useResultadoAnio, pctsAnio } from './resultadoAnio.js'
import { resultadoMes, ufDelDia, finMesOHoy, currentYear, esPPMcosto, montoFactura, usePorSocioFuentes, partidasPorSocio, vendidoPorSocio, ADMIN_NAMES, SIN_SOCIO } from './compartido.jsx'
import { esRecurrente, esSubarriendo, ventaCLP, ventaUF, kpisPorSocio } from './cifras.js'
import { ultimosCerrados, baseMensual, diasDeCobro, concentracion, referencia2026, ufMedia, sumaConUF } from '../../supabase/functions/_shared/presupuesto.js'
import { retirosSocios, _SOCIO_SUELDO } from '../vistas/SociosView.jsx'

/** Categorías de costo que son fijas (el resto se trata como discrecional). */
export const CATEGORIAS_FIJAS = ['Remuneraciones', 'Leyes sociales', 'Arriendo y espacio', 'Arriendo y GGCC', 'Contadora']
/** Categorías cuyas filas son por persona: cada una es una partida propia (sueldo y leyes sociales de cada uno, con su reajuste). El resto de las categorías se suma en una sola partida. */
export const CATEGORIAS_POR_PERSONA = ['Remuneraciones', 'Leyes sociales']

const hoyISO = () => new Date().toLocaleDateString('en-CA')
const ym = (/** @type {number} */ y, /** @type {number} */ m) => `${y}-${String(m).padStart(2, '0')}`

/**
 * @param {{ sales:any[], billing:any[], terceros:any[], costosOfiRows:any[], expenses:any[], clients:any[], anticipos:any[], anioSel?:number|null }} p
 */
export function usePresupuestoDatos({ sales = [], billing = [], terceros = [], costosOfiRows = [], expenses = [], clients = [], anticipos = [], anioSel = null }) {
  const R = useResultadoAnio({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos, selYear: currentYear })
  const { fuRes, ufDias, ufRef, m, metaUF, resAnio, ingresosPorAnioVenta: ing, comisPagadasAnioVenta: com, metaCobranza, ingConc, ingAbonos, _esFactHon, extBillIds } = R

  const hoy = hoyISO(), anio = anioSel || currentYear + 1, ymHoy = hoy.slice(0, 7)

  // UF de cada mes del año en curso (fin de mes; el mes en curso, hoy) y UF media de los meses transcurridos: convierte lo que solo existe en pesos (selector UF). Lo que trae su propia UF no pasa por aquí.
  const mesHoy = Number(hoy.slice(5, 7))
  const uf26 = useMemo(() => {
    const porMes = Array.from({ length: 12 }, (_, i) => Number(ufDelDia(ufDias, finMesOHoy(`${currentYear}-${String(i + 1).padStart(2, '0')}`), ufRef)) || 0)
    return { porMes, med: ufMedia(porMes.slice(0, mesHoy)) ?? (Number(ufRef) || 0) }
  }, [ufDias, ufRef, mesHoy])

  // Facturado propio por mes, de enero del año anterior hasta el mes en curso (el en curso va «a la fecha»). Es lo pesado: solo se recalcula si cambian las fuentes.
  const serie = useMemo(() => {
    const deps = { billing, terceros, costosOfiRows, expenses, clients, ufd: ufDias, ufFb: ufRef }
    /** @type {Record<string,{fac:number,facUF:number,cos:number}>} */
    const o = {}
    for (let y = currentYear - 1; y <= currentYear; y++) for (let mm = 1; mm <= 12; mm++) {
      const ym = `${y}-${String(mm).padStart(2, '0')}`
      if (ym > ymHoy) break
      const r = resultadoMes(fuRes, deps, ym)
      o[ym] = { fac: r.fac || 0, facUF: r.facUF || 0, cos: r.cos || 0, cosUF: r.cosUF || 0 }
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
  // El mismo cobrado, en UF del día de cada depósito.
  const cobMesUF = useMemo(() => {
    /** @type {Record<string,number>} */
    const o = {}
    ;(ingConc || []).forEach((c) => { const a = (ingAbonos || []).find((x) => String(x.id) === String(c.movimiento_id)); const f = a ? String(a.fecha || '').slice(0, 10) : ''; if (f) o[f.slice(0, 7)] = (o[f.slice(0, 7)] || 0) + (Number(c.monto_aplicado) || 0) / (Number(ufDelDia(ufDias, f, ufRef)) || 1) })
    return o
  }, [ingConc, ingAbonos, ufDias, ufRef])

  // Facturado por cliente en el año (honorarios propios; sin lo facturado por cuenta de terceros), de mayor a menor.
  const clientes = useMemo(() => {
    /** @type {Record<string,{id:string,name:string,monto:number,uf:number,n:number}>} */
    const porCli = {}
    const nombreDe = (/** @type {any} */ id) => (clients || []).find((c) => String(c.id) === String(id))?.name || 'Sin cliente'
    ;(billing || []).forEach((b) => {
      if (!_esFactHon(b) || extBillIds.has(String(b.id)) || String(b.issued_at || '').slice(0, 4) !== String(currentYear)) return
      const k = String(b.client_id || 'x'), c = porCli[k] || (porCli[k] = { id: k, name: nombreDe(b.client_id), monto: 0, uf: 0, n: 0 })
      const mf = montoFactura(b); c.monto += mf; c.uf += mf / (Number(ufDelDia(ufDias, b.issued_at, ufRef)) || 1); c.n++
    })
    return Object.values(porCli).filter((c) => c.monto > 0).sort((a, b) => b.monto - a.monto)
  }, [billing, clients, extBillIds, ufDias, ufRef])  // eslint-disable-line react-hooks/exhaustive-deps

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
    metaVentasCLP: m.meta || 0, metaVentasUF: metaUF || 0, metaCobroCLP: metaCobranza || 0,
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
    /** @type {Record<string,{monto:number,uf:number,n:number}>} */ const tp = {}
    const tipoDe = (/** @type {any} */ id) => (clients || []).find((c) => String(c.id) === String(id))?.type || 'Sin tipo'
    clientes.forEach((c) => { const k = tipoDe(c.id), t = tp[k] || (tp[k] = { monto: 0, uf: 0, n: 0 }); t.monto += c.monto; t.uf += c.uf; t.n++ })
    const totT = Object.values(tp).reduce((a, v) => a + v.monto, 0)
    return {
      vend, cob, cruceV: iV >= 0 ? iV : null, cruceC,
      areas: Object.entries(ar).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([n, monto]) => ({ n, monto, pct: totA ? (monto / totA) * 100 : 0 })),
      tipos: Object.entries(tp).sort((a, b) => b[1].monto - a[1].monto).map(([n, t]) => ({ n, monto: t.monto, uf: t.uf, nClientes: t.n, pct: totT ? (t.monto / totT) * 100 : 0 })),
    }
  }, [V, ingConc, ingAbonos, clientes, clients, hoy])  // eslint-disable-line react-hooks/exhaustive-deps

  // Recurrente (ventas mensuales activas, sin subarriendo), anualizado como en Ventas.
  const rec = (sales || []).filter((s) => !s.deleted_at && esRecurrente(s) && !esSubarriendo(s))
  const recurrente = { n: rec.length, anualCLP: rec.reduce((a, s) => a + ventaCLP(s, ufRef), 0), anualUF: rec.reduce((a, s) => a + ventaUF(s, ufRef), 0) }

  // Costos de oficina: lo vigente al comenzar el año del presupuesto (un reajuste con `desde` anterior ya rige; uno posterior queda al monto previo), con la regla de vigencia de resultadoMes.
  // Sueldos y leyes sociales van por persona (una partida por fila, con su vigencia); el resto, sumado por categoría. El PPM va aparte (lo pagado hoy).
  const eff = (/** @type {any} */ r) => (r.desde && ymHoy < String(r.desde).slice(0, 7) ? (r.monto_prev ?? r.monto) : r.monto)
  const effAnio = (/** @type {any} */ r) => (r.desde && `${anio}-01` < String(r.desde).slice(0, 7) ? (r.monto_prev ?? r.monto) : r.monto)
  /** @type {any[]} */
  const costos = []
  /** @type {Record<string,any>} */
  const agrupa = {}
  let ppmMes = 0
  ;(costosOfiRows || []).forEach((r) => {
    if (!r || r.es_ingreso) return
    if (esPPMcosto(r)) { ppmMes += Number(eff(r)) || 0; return }
    const v = Number(effAnio(r)) || 0, cat = r.categoria || 'Otros'
    if (!(v > 0)) return
    if (CATEGORIAS_POR_PERSONA.includes(cat)) {
      const base = `${cat}|${r.item || ''}`, n = costos.filter((c) => String(c.id).startsWith(base)).length
      const vig = r.desde && r.monto_prev != null && Number(r.monto_prev) > 0 ? { desde: String(r.desde).slice(0, 10), mPrev: Math.round(Number(r.monto_prev)) } : {}
      costos.push({ id: n ? `${base}#${n}` : base, n: r.item || cat, m: Math.round(v), meses: 12, t: 'fijo', alza: /** @type {number|null} */ (null), g: cat, ...vig })
    } else if (agrupa[cat]) agrupa[cat].m += v
    else costos.push((agrupa[cat] = { id: cat, n: cat, m: v, meses: 12, t: CATEGORIAS_FIJAS.includes(cat) ? 'fijo' : 'discrecional', alza: /** @type {number|null} */ (null) }))
  })
  costos.forEach((c) => { c.m = Math.round(c.m) })

  // Presupuesto de costos del año en curso por mes (misma regla de Presupuesto vs real, en Resultado del año): vigente por mes, sin PPM ni ingresos.
  const budMes = (/** @type {number} */ mes) => (costosOfiRows || []).filter((r) => r && r.activo !== false && !r.es_ingreso && !esPPMcosto(r)).reduce((a, r) => a + (Number(r.desde && `${currentYear}-${String(mes).padStart(2, '0')}` < String(r.desde).slice(0, 7) ? (r.monto_prev ?? r.monto) : r.monto) || 0), 0)
  const cerrados = Array.from({ length: mesHoy - 1 }, (_, i) => i + 1), faltan = Array.from({ length: 12 - (mesHoy - 1) }, (_, i) => mesHoy + i)
  const costos26 = {
    real: cerrados.reduce((a, m) => a + (serie[ym(currentYear, m)]?.cos || 0), 0), ppto: cerrados.reduce((a, m) => a + budMes(m), 0), pptoResto: faltan.reduce((a, m) => a + budMes(m), 0),
    desde: cerrados.length ? ym(currentYear, 1) : null, hasta: cerrados.length ? ym(currentYear, cerrados.length) : null,
    // En UF: lo real con la UF de cada mes (resultadoMes) y el presupuesto con la UF del mes que corresponde.
    realUF: cerrados.reduce((a, m) => a + (serie[ym(currentYear, m)]?.cosUF || 0), 0),
    pptoUF: cerrados.reduce((a, m) => a + budMes(m) / (uf26.porMes[m - 1] || 1), 0), pptoRestoUF: faltan.reduce((a, m) => a + budMes(m) / (uf26.porMes[m - 1] || 1), 0),
  }

  // Retiros y sueldos de los socios del año: la misma fuente de la página Socios (retirosSocios).
  const ufAt = (/** @type {string} */ f) => Number(ufDelDia(ufDias, f, ufRef)) || 0
  const RS = useMemo(() => retirosSocios({ expenses, clients, socios: [], yr: currentYear }), [expenses, clients])
  const retiros26 = {
    total: RS.totalRet, n: RS.nRet, porSocio: RS.retTot, sueldos: RS.sueldos, sueldoTot: RS.sueldoTot, socios: RS.SOC,
    // En UF: cada transferencia con la UF de su día; los sueldos (por socio) igual.
    totalUF: sumaConUF(RS.movs.map((x) => ({ monto: x.amt, fecha: x.date })), ufAt, uf26.med).uf,
    porSocioUF: Object.fromEntries(RS.SOC.map((n) => [n, sumaConUF(RS.retSoc.filter((r) => r.socio === n).flatMap((r) => r.movs).map((x) => ({ monto: x.amt, fecha: x.date })), ufAt, uf26.med).uf])),
    sueldosUF: Object.fromEntries(RS.SOC.map((n) => [n, sumaConUF((expenses || []).filter((e) => RS.inOfi(e) && ['sueldos', 'bono'].includes(String(e.category || '').trim().toLowerCase()) && _SOCIO_SUELDO(e) === n).map((e) => ({ monto: Number(e.amount) || 0, fecha: String(e.date || '').slice(0, 10) })), ufAt, uf26.med).uf])),
    desde: RS.movs.length ? RS.movs.reduce((a, x) => (x.date < a ? x.date : a), '9999-99-99') : null, hasta: RS.movs.length ? RS.movs.reduce((a, x) => (x.date > a ? x.date : a), '0000-00-00') : null,
  }

  // Pagos a terceros como % de lo cobrado (comisiones pagadas del año contra cobrado propio): los mismos totales de Inicio.
  const terc = (ing?.total || 0) > 0 ? ((com?.total || 0) / ing.total) * 100 : null

  // Referencia 2026: real a la fecha + lo que resta del año (promedio de los últimos 3 meses cerrados por componente; helper único referencia2026).
  const ult3 = cerrados.slice(-3)
  const referencia = referencia2026({
    hoyISO: hoy,
    aFecha: { ventas: oficiales.vend.clp, fact: oficiales.fact.clp, caja: oficiales.cob.clp, retiros: retiros26.total },
    ultimos: {
      ventas: ult3.map((m) => (evo.vend[m - 1] ?? 0) - (m > 1 ? evo.vend[m - 2] ?? 0 : 0)),
      fact: ult3.map((m) => serie[ym(currentYear, m)]?.fac ?? 0),
      caja: ult3.map((m) => cobMes[ym(currentYear, m)] ?? 0),
    },
    costos: { real: costos26.real, pptoResto: costos26.pptoResto }, terc: (ing?.total || 0) > 0 ? ((com?.total || 0) / ing.total) * 100 : null,
  })
  // La misma referencia en UF: lo real a la fecha con la UF de cada movimiento (cifras oficiales de Inicio, retiros, costos) y lo que resta del año con la UF vigente (estimación propia).
  const ufResto = Number(ufRef) || uf26.med, rUF = (/** @type {number} */ aFechaUF, /** @type {number} */ resto) => ({ aFecha: aFechaUF, cierre: aFechaUF + resto / ufResto })
  const refUFv = rUF(oficiales.vend.uf, referencia.ventas.resto), refUFf = rUF(oficiales.fact.uf, referencia.fact.resto), refUFc = rUF(oficiales.cob.uf, referencia.caja.resto)
  const tc = 1 - (terc || 0) / 100, costosUF = { aFecha: costos26.realUF, cierre: costos26.realUF + costos26.pptoRestoUF }
  const refUF = {
    ventas: refUFv, fact: refUFf, caja: refUFc, costos: costosUF,
    margen: { aFecha: refUFc.aFecha * tc - costosUF.aFecha, cierre: refUFc.cierre * tc - costosUF.cierre },
    retiros: { aFecha: retiros26.totalUF, cierre: retiros26.totalUF },
  }
  // Relación facturado/vendido del año a la fecha: estimación propia (aún sin ciclo completo), para llevar una meta de ventas a facturado.
  const ratioFactVend = oficiales.vend.clp > 0 ? (oficiales.fact.clp / oficiales.vend.clp) * 100 : null

  return {
    hoy, anio, anioBase: currentYear, metaVentasUF: metaUF || 0, uf26, refUF, cobMesUF, costos26, retiros26, referencia, ratioFactVend, ufRef, ufDic, serie, cobMes, base, sinBase: base.baseCLP.every((x) => !x), cierres, oficiales,
    clientes, totalFact, evo, concentracion5: concentracion(clientes.map((c) => c.monto), totalFact, 5),
    recurrente, costos, ppmMes, terc, dias, socios,
  }
}
