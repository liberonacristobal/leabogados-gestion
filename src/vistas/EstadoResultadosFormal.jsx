// Estado de resultados formal: el estado de resultados como se arma en finanzas (ingresos de explotación, costo de ventas, margen bruto, gastos de administración,
// resultado antes de impuestos, PPM y resultado después de impuestos), con una columna por mes, el total del año, el mismo período del año anterior y el porcentaje sobre
// ingresos. No calcula nada propio: cada columna es resultadoMes (la misma función de Inicio, Oficina y Resultado del año), así que el resultado coincide con el de esas
// pantallas; el impuesto es el PPM puro de impuestosMensuales. Cifras en miles de pesos o en UF (la moneda de Oficina); los subtotales se arman con las cifras ya
// redondeadas para que el estado sume. El Excel baja las cifras exactas.
import { useMemo, useState } from 'react'
import { C, SEC_LBL, BtnDescarga, fmtFechaDMY, useIsDesktop, appAlert, appConfirm } from '../lib/base.jsx'
import { resultadoMes, useFuentesResultado, useImpuestosFuentes, useUF, useUFFechas, ufDelDia, finMesOHoy, usePersistedState, UF_FALLBACK, currentYear, fmtMill, montoFactura, saldoBill, avisarBillingCambio, logActividad, esPPMcosto } from '../lib/compartido.jsx'
import { useResultadoAnio } from '../lib/resultadoAnio.js'
import { ResultadoAnioView } from './ResultadoAnioView.jsx'
import { puenteCaja } from '../../supabase/functions/_shared/puenteCaja.js'
import { idpcDesdePuente } from '../../supabase/functions/_shared/idpcEstimado.js'
import { desfaseFinAnio } from '../../supabase/functions/_shared/desfasePagos.js'
import { presupuestoVsReal } from '../../supabase/functions/_shared/presupuestoVsReal.js'
import { descargarXlsx } from '../lib/seleccionLote.jsx'
import { descargarEstadoResultadosPdf } from '../lib/pdfEstadoResultados.js'
import { DEMO, supabase } from '../supabase'
import { impuestosMensuales, pagosConBoleta, idOficina } from '../../supabase/functions/_shared/impuestosMensuales.js'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MC = MESES.map(m => m.slice(0, 3))
const pad = n => String(n).padStart(2, '0')
const fN = n => n === 0 ? '0' : (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('es-CL')
const fPct = (a, b) => { if (!(b > 0)) return ''; const v = Math.round(a / b * 1000) / 10; return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %' }
const fVar = (a, p) => { if (!p) return ''; const v = Math.round((a - p) / Math.abs(p) * 1000) / 10; if (Math.abs(v) > 999) return v > 0 ? '>+999 %' : '<−999 %'; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %' }
const suma = a => a.reduce((x, y) => x + y, 0)
const ORDEN = ['rem', 'cot', 'arr', 'con', 'otr', 'pre', 'gv', 'sub']

export function EstadoResultadosFormal({ billing = [], terceros = [], costosOfiRows = [], expenses = [], clients = [], sales = [], anticipos = [], user, onOpenGasto, onCargarBoleta, backLabel = 'Oficina', onBack, onGo }) {
  const D = useIsDesktop()
  const fu = useFuentesResultado()
  const year = currentYear, curM = new Date().getMonth() + 1, n = curM + 1
  const [selM, setSelM] = useState(curM)
  const [vista, setVista] = useState('pct')   // celular: tercera columna = % de ingresos o comparación con el año anterior
  const [moneda, setMoneda] = usePersistedState('oficina_moneda', 'CLP')
  const enUF = moneda === 'UF'
  const ufState = useUF(), ufRef = ufState.uf || UF_FALLBACK, ufDias = useUFFechas(billing)
  const deps = { billing, terceros, costosOfiRows, expenses, clients, ufd: ufDias, ufFb: ufRef }
  const imps = useImpuestosFuentes(), ofiId = useMemo(() => idOficina(clients), [clients])

  // Un año (mismos meses, de enero al mes en curso): resultadoMes de cada mes y su PPM puro (en pesos y en UF del fin de ese mes).
  const anio = (Y) => {
    const R = Array.from({ length: curM }, (_, i) => resultadoMes(fu, deps, `${Y}-${pad(i + 1)}`))
    const pagos = DEMO ? (imps.pagos || []) : pagosConBoleta({ expenses, ofiId, boletaSet: fu.boleta, terceros }), docs = (fu.sii && fu.sii.length ? fu.sii : imps.docs) || []
    const ppm = R.map((_, i) => { const per = `${Y}-${pad(i + 1)}`, clp = impuestosMensuales({ per, docs, boletas: imps.boletas, pagos, liquidaciones: imps.liquidaciones, declarados: imps.declarados, informado: imps.valores?.[per]?.ppm, destinos: imps.destinos || {}, terceros, boletaSet: [...fu.boleta] }).ppm.monto || 0
      return { clp, uf: clp / (ufDelDia(ufDias, finMesOHoy(per), ufRef) || ufRef) } })
    return { R, ppm }
  }
  const A1 = useMemo(() => anio(year), [fu, billing, terceros, costosOfiRows, expenses, clients, imps, ufDias, ufRef, curM, year])   // eslint-disable-line react-hooks/exhaustive-deps
  const A0 = useMemo(() => anio(year - 1), [fu, billing, terceros, costosOfiRows, expenses, clients, imps, ufDias, ufRef, curM, year])   // eslint-disable-line react-hooks/exhaustive-deps

  // IDPC estimado del año: puente del «Resultado antes de impuestos» de ESTE estado a la base de caja (reglas únicas puenteCaja e idpcEstimado). Cobrado = el de Inicio (cobrado propio más comisión percibida,
  // por fecha del depósito, solo lo ligado a facturas y anticipos); comisiones pagadas = las de Inicio. Los costos pagados se toman iguales a los devengados mientras no se mida el desfase de pago
  // (cotizaciones y F29 del mes anterior): queda rotulado. Los depósitos sin identificar se muestran, fuera de la base.
  const RA = useResultadoAnio({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos, selYear: year })
  const [verIdpc, setVerIdpc] = useState(false)
  const idpc = useMemo(() => {
    const IA = RA.ingresosPorAnioVenta, R = A1.R
    const cobMes = ym => (IA.byMonth[ym] || 0) + ((IA.percByMonth && IA.percByMonth[ym]) || 0)
    const cobrado = (IA.total || 0) + (IA.percibidas || 0)
    const fact = suma(R.map(m => m.ing)), cos = suma(R.map(m => m.cos)), com = suma(R.map(m => m.com)), comPag = RA.comisPagadasAnioVenta.total || 0
    const p = puenteCaja({ resultadoAntes: suma(R.map(m => m.res)), facturado: fact, cobrado, devengado: cos + com, pagado: cos + comPag })
    // Comprobación del cobrado: facturas propias emitidas en el año, sin las cubiertas por anticipos (esas entran por el anticipo conciliado); cobrado por cartola (de cualquier fecha: una factura de enero puede estar cobrada en diciembre) frente al cobrado por saldo de cada factura.
    const billById = {}; billing.forEach(b => { billById[String(b.id)] = b }); const abonoById = {}; RA.ingAbonos.forEach(m => { abonoById[String(m.id)] = m })
    const conAnticipo = new Set((anticipos || []).filter(x => x && x.billing_id != null).map(x => String(x.billing_id)))   // facturas cubiertas por anticipos ligados a ellas (anticipos.billing_id): entran por el anticipo conciliado
    const porAnticipo = b => b.prepaid_anticipo_id != null || conAnticipo.has(String(b.id)) || /anticipo/i.test(String(b.payment_ref || ''))
    const delAnio = b => b && RA._esFactHon(b) && !RA.extBillIds.has(String(b.id)) && !porAnticipo(b) && String(b.issued_at || '').slice(0, 4) === String(year)
    const cartolaDe = {}; let porCartola = 0
    RA.ingConc.forEach(c => { if (c.tipo_destino !== 'factura') return; const b = billById[String(c.factura_id)], m = abonoById[String(c.movimiento_id)]; if (!delAnio(b) || !m || m.categoria === 'Subarriendo') return; const v = Number(c.monto_aplicado) || 0; porCartola += v; cartolaDe[String(b.id)] = (cartolaDe[String(b.id)] || 0) + v })
    const facs = billing.filter(delAnio), montoFacs = suma(facs.map(b => montoFactura(b))), porSaldo = montoFacs - suma(facs.map(b => saldoBill(b)))
    const sinRespaldo = facs.map(b => ({ b, dif: montoFactura(b) - saldoBill(b) - (cartolaDe[String(b.id)] || 0) })).filter(x => x.dif > 1000)
    const difCobrado = porCartola - porSaldo, cuadra = Math.abs(difCobrado) <= Math.max(500000, 0.01 * montoFacs)   // tolerancia: 1 % de lo facturado o $500.000
    const cobMeses = Array.from({ length: Math.max(0, curM - 1) }, (_, i) => cobMes(`${year}-${pad(i + 1)}`)), ult = A1.R[Math.max(0, curM - 2)]
    // Desfase de pago de fin de año: cotizaciones y F29 sin PPM (retención de honorarios e impuesto único) se pagan el mes siguiente; el último período cerrado hace de proxy de diciembre.
    const pagosI = DEMO ? (imps.pagos || []) : pagosConBoleta({ expenses, ofiId, boletaSet: fu.boleta, terceros }), docsI = (fu.sii && fu.sii.length ? fu.sii : imps.docs) || []
    const sinPpm = per => { const i = impuestosMensuales({ per, docs: docsI, boletas: imps.boletas, pagos: pagosI, liquidaciones: imps.liquidaciones, declarados: imps.declarados, informado: imps.valores?.[per]?.ppm, destinos: imps.destinos || {}, terceros, boletaSet: [...fu.boleta] }); return (i.retencion.monto || 0) + (i.unico.monto || 0) }
    const perUlt = `${year}-${pad(Math.max(1, curM - 1))}`
    const des = desfaseFinAnio({ expenses, ofiId, anio: year, perUlt, f29SinPpmInicial: sinPpm(`${year - 1}-12`), f29SinPpmUlt: sinPpm(perUlt) })
    const e = idpcDesdePuente({ baseAlCorte: p.base, mesesRestantes: 12 - curM, cobradoMes: cobMeses, pagadoUltimoMes: ult ? (ult.cos + ult.com) : 0, ppmPagado: suma(A1.ppm.map(x => x.clp)), ppmUltimoMes: A1.ppm[Math.max(0, curM - 2)]?.clp || 0, ajusteFinAnio: des.desfase })
    return { p, e, des, porCartola, porSaldo, difCobrado, cuadra, sinRespaldo: { n: sinRespaldo.length, monto: suma(sinRespaldo.map(x => x.dif)) }, sinIdentificar: IA.porIdentificar || 0 }
  }, [RA, A1, billing, curM, year])   // eslint-disable-line react-hooks/exhaustive-deps

  // Salud de datos › «Fecha de pago y depósito»: la fuente de la verdad de la fecha de cobro es el abono conciliado en el banco (regla de CLAUDE.md); una factura cuya fecha de pago difiere de la del último abono conciliado del año se avisa (caso Bustos: dos conciliaciones cruzadas).
  const checkFechas = useMemo(() => {
    const billById = {}; billing.forEach(b => { billById[String(b.id)] = b }); const abonoById = {}; RA.ingAbonos.forEach(m => { abonoById[String(m.id)] = m })
    const ultDep = {}
    RA.ingConc.forEach(c => { if (c.tipo_destino !== 'factura') return; const m = abonoById[String(c.movimiento_id)]; if (!m) return; const f = String(m.fecha || '').slice(0, 10); if (!ultDep[String(c.factura_id)] || f > ultDep[String(c.factura_id)]) ultDep[String(c.factura_id)] = f })
    const dias = (a, b) => Math.round(Math.abs(new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 864e5)
    const lista = []
    Object.keys(ultDep).forEach(id => { const b = billById[id], dep = ultDep[id]; if (!b || b.deleted_at || b.status === 'Anulada' || !b.paid_at || !dep.startsWith(String(year))) return; const d = dias(String(b.paid_at).slice(0, 10), dep); if (d > 0) lista.push({ b, d, dep }) })
    lista.sort((x, y) => y.d - x.d)
    const nombre = b => (clients.find(c => String(c.id) === String(b.client_id)) || {}).name || 'cliente', n = lista.length
    // Alinear: la fecha de pago pasa a ser la del último depósito conciliado (la fuente de la verdad); queda en la bitácora.
    const alinear = async () => {
      if (DEMO) { appAlert('En la demo no se guardan cambios.'); return }
      if (!(await appConfirm(`Se cambiará la fecha de pago de ${n} factura${n !== 1 ? 's' : ''} a la de su último depósito conciliado en el banco. ¿Continuar?`))) return
      let ok = 0
      for (const x of lista) { const { error } = await supabase.from('billing').update({ paid_at: x.dep, payment_date: x.dep, updated_at: new Date().toISOString() }).eq('id', x.b.id); if (!error) ok++ }
      try { logActividad('banco.alinear_fechas', { tabla: 'billing', detalle: { title: `Alineó la fecha de pago de ${ok} factura${ok !== 1 ? 's' : ''} con su depósito conciliado`, n: ok } }) } catch (_) { /* la bitácora no frena la acción */ }
      avisarBillingCambio(); appAlert(`Listo: ${ok} de ${n} fechas alineadas con su depósito.`)
    }
    // Cierre de año: un pago del 31-12 que el banco abona el 03-01 cae en el año nuevo; del 15-dic al 31-ene se listan los abonos del 28-dic al 04-ene para revisarlos a mano.
    const hoyD = new Date(), mesH = hoyD.getMonth() + 1, Yc = mesH === 12 ? year : (mesH === 1 ? year - 1 : null)
    let cierre = []
    if (Yc != null) {
      const ini = `${Yc}-12-28`, fin = `${Yc + 1}-01-04`, corte = `${Yc}-12-31`
      const ab = RA.ingAbonos.filter(m => { const f = String(m.fecha || '').slice(0, 10); return f >= ini && f <= fin })
      const antes = ab.filter(m => String(m.fecha).slice(0, 10) <= corte), despues = ab.filter(m => String(m.fecha).slice(0, 10) > corte)
      const sm = a => a.reduce((x, m) => x + (Number(m.monto) || 0), 0)
      cierre = [[ab.length === 0, 'Abonos del cierre de año', ab.length ? `${antes.length} hasta el 31-12 (${fmtMill(sm(antes))}) y ${despues.length} desde el 01-01 (${fmtMill(sm(despues))}): revisa la fecha en que el banco los abonó` : 'sin abonos entre el 28-12 y el 04-01', null]]
    }
    return [[n === 0, 'Fecha de pago y depósito', n ? `${n} factura${n !== 1 ? 's' : ''} con la fecha de pago distinta de la del abono conciliado en el banco: ${lista.slice(0, 3).map(x => `${nombre(x.b)} ${x.b.invoice_no}`).join(', ')}` : 'cada fecha de pago coincide con su depósito conciliado', n ? { label: 'Alinear', on: alinear } : null], ...cierre]
  }, [RA, billing, clients, year])

  // Líneas de gastos: la unión de las de ambos años (en su orden), con el subarriendo como menor gasto (signo contrario).
  const gKeys = useMemo(() => { const m = {}; [A1, A0].forEach(A => A.R.forEach(r => (r.cosLines || []).forEach(l => { if (!m[l.k]) m[l.k] = l.l }))); return Object.keys(m).sort((a, b) => ORDEN.indexOf(a) - ORDEN.indexOf(b)).map(k => ({ k, l: m[k] })) }, [A1, A0])

  // Tabla de un año en la moneda elegida y a una escala (`esc`: 1000 = miles de pesos; 1 = UF o pesos exactos). Cada celda se redondea y los subtotales suman celdas ya redondeadas;
  // el total del año es el redondeo del total exacto de cada línea. Los gastos van en negativo (el subarriendo recuperado, positivo).
  const tabla = (A, esc) => {
    const r = x => Math.round((Number(x) || 0) / esc), fila = (get) => [...A.R.map((m, i) => r(get(m, i))), r(suma(A.R.map((m, i) => get(m, i))))]
    const hon = fila(m => enUF ? m.facUF : m.fac), rex = fila(m => enUF ? m.rexUF : m.rex), com = fila(m => -(enUF ? m.comUF : m.com))
    const gas = gKeys.map(g => ({ ...g, v: fila(m => -((m.cosLines || []).filter(l => l.k === g.k).reduce((a, l) => a + (enUF ? l.mUF : l.m), 0))) }))
    const imp = fila((_, i) => -(enUF ? A.ppm[i].uf : A.ppm[i].clp))
    const ing = hon.map((x, i) => x + rex[i]), mb = ing.map((x, i) => x + com[i]), totGas = Array.from({ length: n }, (_, i) => gas.reduce((a, g) => a + g.v[i], 0))
    const res = mb.map((x, i) => x + totGas[i]), neto = res.map((x, i) => x + imp[i])
    return { hon, rex, com, gas, imp, ing, mb, totGas, res, neto }
  }
  const esc = enUF ? 1 : 1000
  const T1 = tabla(A1, esc), T0 = tabla(A0, esc)
  const p0 = (v0) => v0 ? v0[n - 1] : 0   // total del año anterior (mismo período)
  const prevEst = A0.R.some(r => !r.cerrado)

  const cerrado = i => A1.R[i]?.cerrado
  const colsIdx = D ? Array.from({ length: n }, (_, i) => i) : [selM - 1, curM]   // celular: el mes elegido y el total del año
  const nomCol = i => i === curM ? 'Total' : MC[i]
  const goMes = i => () => onGo && onGo('estadoResultados', `${year}-${pad(Math.min(i + 1, curM))}`)   // la columna Total abre el mes en curso; el año ya está en esta página
  const gasIdx = k => gKeys.findIndex(g => g.k === k)
  const filas = [
    { t: 'sec', l: 'Ingresos de explotación (Revenue)' },
    { t: 'it', l: 'Honorarios facturados', v: T1.hon, w: T0.hon, go: i => () => onGo && onGo('estadoResultados', i < curM ? `${year}-${pad(i + 1)}` : undefined, { bloque: 'ing', sub: 'fac' }) },
    { t: 'it', l: 'Comisiones de externos', v: T1.rex, w: T0.rex, go: goMes },
    { t: 'sub', l: 'Total ingresos de explotación', v: T1.ing, w: T0.ing },
    { t: 'sec', l: 'Costo de ventas (COGS)' },
    { t: 'it', l: 'Comisiones devengadas', v: T1.com, w: T0.com, go: () => () => onGo && onGo('proveedores') },
    { t: 'sub', l: 'Margen bruto (Gross profit)', v: T1.mb, w: T0.mb, pct: true },
    { t: 'sec', l: 'Gastos de administración (Opex)' },
    ...T1.gas.map(g => ({ t: 'it', l: g.l, v: g.v, w: T0.gas[gasIdx(g.k)].v, go: () => () => onGo && onGo('costos') })),
    { t: 'sub', l: 'Total gastos de administración (Opex)', v: T1.totGas, w: T0.totGas },
    { t: 'sub', l: 'Resultado antes de impuestos (EBIT)', v: T1.res, w: T0.res, pct: true },
    { t: 'it', l: 'PPM, impuesto de primera categoría (pago provisional)', v: T1.imp, w: T0.imp },
    { t: 'res', l: 'Resultado después de impuestos (Net income)', v: T1.neto, w: T0.neto, pct: true },
    { t: 'sec', l: 'Partida informativa' },
    { t: 'inf', l: 'EBITDA, igual al EBIT (el activo fijo se lleva a gasto al pagarlo)', v: T1.res, w: T0.res },
  ]

  const exp = () => {
    const X1 = tabla(A1, 1), X0 = tabla(A0, 1)
    const f = (l, a, b) => [l, ...a, p0(b)]
    // Segunda hoja: el IDPC estimado del año con su puente (siempre en pesos, rotulado como estimación).
    const { p: pp, e: ee, des } = idpc, hoy = fmtFechaDMY(new Date().toISOString().slice(0, 10))
    const hojaIdpc = { hoja: 'IDPC estimado', head: ['Concepto', 'Monto (CLP)'], anchos: [58, 18], numCols: [1], filas: [
      ['Resultado antes de impuestos (Estado de resultados)', Math.round(pp.resultadoAntes)], ['Variación de cuentas por cobrar', Math.round(pp.varCxC)], ['Variación de cuentas por pagar', Math.round(pp.varCxP)],
      ['Base al ' + hoy, pp.base], ['Proyección de los meses que faltan, moderada', ee.proyeccion], ['Desfase de pago a fin de año', ee.ajusteFinAnio], ['Base del año', ee.baseAnio],
      ['Incentivo al ahorro, 50 %', -ee.incentivo], ['Base afecta', ee.baseAfecta], ['IDPC 12,5 %', ee.idpc], ['PPM del año', -ee.ppm], ['Saldo a abril', ee.saldo],
      ['', ''], ['Depósitos sin identificar, fuera de la base', Math.round(idpc.sinIdentificar)], ['Facturas pagadas sin respaldo en la cartola', Math.round(idpc.sinRespaldo.monto)], ['Comprobación del cobrado', idpc.cuadra ? 'Cuadra' : 'No cuadra'],
      ['', ''], ['Estimación, régimen Pro Pyme general. Es un piso: los depósitos sin identificar no entran. Proyección moderada sin crecimiento.', ''] ] }
    // Tercera hoja: presupuesto vs real de los costos de oficina (la misma regla de la página, solo meses cerrados).
    const rmesPv = {}; A1.R.forEach((r, i) => { rmesPv[i + 1] = r })
    const PV = presupuestoVsReal({ costosOfiRows, rmes: rmesPv, yr: year, curY: currentYear, curM, esPPM: esPPMcosto })
    const hojaPvr = PV ? { hoja: 'Presupuesto vs real', head: ['Concepto', 'Presupuesto', 'Real', 'Desvío'], anchos: [40, 16, 16, 16], numCols: [1, 2, 3], filas: [
      ['MES A MES', '', '', ''], ...PV.filas.map(f => [MESES[f.m - 1].charAt(0).toUpperCase() + MESES[f.m - 1].slice(1) + (f.est ? ' (estimado)' : ''), Math.round(f.bt), Math.round(f.rt), Math.round(f.rt - f.bt)]),
      ...(PV.resto.length ? [[`${MESES[PV.cerM].charAt(0).toUpperCase() + MESES[PV.cerM].slice(1)}${PV.resto.length > 1 ? ' a diciembre' : ''} (proyectado)`, Math.round(PV.budResto), '', '']] : []),
      [String(year) + ' proyectado', Math.round(PV.budAnio), Math.round(PV.proy), Math.round(PV.proy - PV.budAnio)],
      ['', '', '', ''], [`POR CATEGORÍA, ENERO A ${MESES[PV.cerM - 1].toUpperCase()}`, '', '', ''],
      ...PV.CATS.map(([k, l]) => { const t = PV.catTot(k); return [l, Math.round(t.b), Math.round(t.r), Math.round(t.r - t.b)] }),
      ['Total', Math.round(PV.bud), Math.round(PV.real), Math.round(PV.dv)],
      ['', '', '', ''], ['Costos brutos, sin descontar el subarriendo. Solo meses cerrados; los meses «estimado» usan el presupuesto mientras no se carguen sus costos reales.', '', '', ''] ] } : null
    descargarXlsx({ extras: hojaPvr ? [hojaIdpc, hojaPvr] : [hojaIdpc], nombre: `Estado_de_resultados_${year}${enUF ? '_UF' : ''}`, hoja: 'Estado de resultados', head: ['Concepto', ...MC.slice(0, curM), 'Total', `${year - 1} (mismo período)`], anchos: [48, ...Array(n + 1).fill(13)], numCols: Array.from({ length: n + 1 }, (_, i) => i + 1),
      filas: [f('Honorarios facturados', X1.hon, X0.hon), f('Comisiones de externos', X1.rex, X0.rex), f('Total ingresos de explotación (Revenue)', X1.ing, X0.ing), f('Comisiones devengadas', X1.com, X0.com), f('Margen bruto (Gross profit)', X1.mb, X0.mb),
        ...X1.gas.map((g, k) => f(g.l, g.v, X0.gas[k].v)), f('Total gastos de administración (Opex)', X1.totGas, X0.totGas), f('Resultado antes de impuestos (EBIT)', X1.res, X0.res), f('PPM, impuesto de primera categoría', X1.imp, X0.imp), f('Resultado después de impuestos (Net income)', X1.neto, X0.neto), f('EBITDA (igual al EBIT, el activo fijo se lleva a gasto al pagarlo)', X1.res, X0.res)] })
  }

  // PDF: las mismas filas y cifras de la tabla (celdas ya formateadas), todos los meses, carta horizontal.
  const pdf = () => descargarEstadoResultadosPdf({ titulo: 'Estado de resultados', periodo: `Enero a ${MESES[curM - 1]} de ${year}`, unidad: enUF ? 'UF' : 'miles de pesos', emitido: fmtFechaDMY(new Date().toISOString().slice(0, 10)),
    meses: MC.slice(0, curM), estimado: A1.R.map(r => !r.cerrado), anioPrev: String(year - 1), prevEst: prevEst,
    filas: filas.map(f => f.t === 'sec' ? { t: 'sec', l: f.l } : { t: f.t, l: f.l, c: [...f.v.slice(0, curM).map(fN), fN(f.v[curM]), fN(f.w[curM]), fVar(f.v[curM], f.w[curM]), f.pct || f.t === 'it' || f.t === 'sub' ? fPct(f.v[curM], T1.ing[curM]) : ''] }) },
    `Estado_de_resultados_${year}${enUF ? '_UF' : ''}.pdf`)

  const pad2 = D ? '7px 12px' : '6px 8px'
  const W = D ? 84 : 72
  // Columnas fijas a la derecha, de izquierda a derecha: total, año anterior, variación y % ingresos (en celular, solo las de la vista elegida).
  const colsDer = D ? ['tot', 'prev', 'var', 'pct'] : (vista === 'prev' ? ['tot', 'prev', 'var'] : ['tot', 'pct'])
  const right = k => (colsDer.length - 1 - colsDer.indexOf(k)) * W
  const fijo = (k, z) => ({ position: 'sticky', right: right(k), zIndex: z, minWidth: W, ...(k === 'tot' ? { boxShadow: `-1px 0 0 ${C.border}` } : {}) })
  const celdaSt = (f, v, extra) => ({ padding: pad2, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: f.t === 'it' || f.t === 'inf' ? 400 : 800, color: f.t === 'inf' ? C.muted : (v < 0 && f.t !== 'it' ? C.overdueText : (f.t === 'it' && v < 0 ? C.text : C.accent)), background: f.t === 'res' ? C.bgSoft : C.card, borderTop: f.t === 'res' ? `1.5px solid ${C.accent}` : f.t === 'sub' ? `1px solid ${C.border}` : 'none', ...extra })
  const muteSt = { fontWeight: 600, color: C.muted }
  const hd = (k, txt, sub) => <th key={k} style={{ ...fijo(k, 2), background: k === 'tot' ? C.border : C.bgSoft, padding: pad2, textAlign: 'right', ...SEC_LBL, fontSize: 10, whiteSpace: 'nowrap' }}>{txt}{sub && <span style={{ display: 'block', fontSize: 8.5, fontWeight: 600, color: C.muted, letterSpacing: 0, textTransform: 'none' }}>{sub}</span>}</th>
  const celdaDer = (k, f) => {
    if (k === 'tot') return <td key={k} style={celdaSt(f, f.v[curM], { ...fijo(k, 1), background: f.t === 'res' ? C.bgSoft : C.bgSoft })}>{fN(f.v[curM])}</td>
    if (k === 'prev') return <td key={k} style={celdaSt(f, f.w[curM], { ...fijo(k, 1), ...muteSt })}>{fN(f.w[curM])}</td>
    if (k === 'var') return <td key={k} style={celdaSt(f, 0, { ...fijo(k, 1), ...muteSt })}>{fVar(f.v[curM], f.w[curM])}</td>
    return <td key={k} style={celdaSt(f, 0, { ...fijo(k, 1), ...muteSt })}>{f.pct || f.t === 'it' || f.t === 'sub' ? fPct(f.v[curM], T1.ing[curM]) : ''}</td>
  }
  const colsMes = D ? Array.from({ length: curM }, (_, i) => i) : (vista === 'prev' ? [] : [selM - 1])   // celular, comparando con el año anterior: solo total, año anterior y variación
  const selSt = { fontSize: 12, fontWeight: 700, color: C.accent, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 8px', fontFamily: 'inherit' }
  const unidad = enUF ? 'UF' : 'miles de pesos'

  return (
    <div style={{ padding: D ? '0 20px 40px' : '0 2px 40px' }}>
      <div onClick={onBack} style={{ fontSize: 12, fontWeight: 700, color: C.accent, cursor: 'pointer', margin: '2px 2px 8px' }}>← {backLabel}</div>
      <div style={{ margin: '0 2px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: D ? 20 : 17, fontWeight: 800, color: C.accent, whiteSpace: 'nowrap' }}>Estado de resultados</div>
          <BtnDescarga onClick={pdf} titulo='Descargar PDF' n='file' />
          <BtnDescarga onClick={exp} titulo='Descargar Excel' n='sheet' />
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{D ? `Enero a ${MESES[curM - 1]} de ${year}, al ${fmtFechaDMY(new Date().toISOString().slice(0, 10))}. Cifras en ${unidad}.` : `Ene a ${MC[curM - 1]} ${year}, ${unidad}`}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: D ? 8 : 6, flexWrap: 'wrap', justifyContent: D ? 'flex-end' : 'flex-start' }}>
          {!D && vista !== 'prev' && <select value={selM} onChange={e => setSelM(Number(e.target.value))} style={selSt}>{MESES.slice(0, curM).map((m, i) => <option key={m} value={i + 1}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}</select>}
          {!D && <select value={vista} onChange={e => setVista(e.target.value)} style={selSt}><option value='pct'>% de ingresos</option><option value='prev'>vs {year - 1}</option></select>}
          <select value={moneda} onChange={e => setMoneda(e.target.value)} style={selSt}><option value='CLP'>CLP</option><option value='UF'>UF</option></select>
        </div>
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: D ? 12.5 : 12 }}>
            <thead><tr>
              <th style={{ position: 'sticky', left: 0, zIndex: 2, background: C.bgSoft, padding: pad2, textAlign: 'left', ...SEC_LBL, fontSize: 10, minWidth: D ? 270 : 150 }}>Concepto</th>
              {colsMes.map(i => <th key={i} onClick={goMes(i)} style={{ background: C.bgSoft, padding: pad2, textAlign: 'right', ...SEC_LBL, fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>{nomCol(i)}{!cerrado(i) && <span style={{ display: 'block', fontSize: 8.5, fontWeight: 600, color: C.muted, letterSpacing: 0, textTransform: 'none' }}>estimado</span>}</th>)}
              {colsDer.map(k => k === 'tot' ? hd(k, 'Total') : k === 'prev' ? hd(k, String(year - 1), prevEst ? 'estimado' : 'mismo período') : k === 'var' ? hd(k, 'Var. %') : hd(k, '% ingresos'))}
            </tr></thead>
            <tbody>
              {filas.map((f, k) => f.t === 'sec'
                ? <tr key={k}><td colSpan={colsMes.length + colsDer.length + 1} style={{ padding: D ? '12px 12px 4px' : '10px 8px 3px', ...SEC_LBL, fontSize: 10.5 }}>{f.l}</td></tr>
                : <tr key={k}>
                  <td style={{ position: 'sticky', left: 0, zIndex: 1, background: f.t === 'res' ? C.bgSoft : C.card, padding: pad2, paddingLeft: f.t === 'it' || f.t === 'inf' ? (D ? 26 : 16) : (D ? 12 : 8), fontWeight: f.t === 'it' || f.t === 'inf' ? 400 : 800, color: f.t === 'inf' ? C.muted : f.t === 'it' ? C.text : C.accent, borderTop: f.t === 'res' ? `1.5px solid ${C.accent}` : f.t === 'sub' ? `1px solid ${C.border}` : 'none', whiteSpace: D ? 'nowrap' : 'normal' }}>{f.l}</td>
                  {colsMes.map(i => <td key={i} onClick={f.go ? f.go(i) : undefined} style={celdaSt(f, f.v[i], { cursor: f.go ? 'pointer' : 'default' })}>{fN(f.v[i])}</td>)}
                  {colsDer.map(kk => celdaDer(kk, f))}
                </tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, margin: '10px 2px 0', lineHeight: 1.5 }}>
        Los gastos se muestran en negativo; el subarriendo y los gastos recuperados reducen los gastos. Los meses «estimado» usan el presupuesto de oficina mientras no se carguen sus costos reales. Los subtotales suman las cifras redondeadas a {enUF ? 'UF enteras' : 'miles'}. El impuesto es solo el PPM del período, anticipo del impuesto de primera categoría; el impuesto anual se liquida en abril. El PPM es el declarado en el F29; mientras un mes no se declara, se estima con la tasa declarada sobre la base del mes. {year - 1} se compara de enero a {MESES[curM - 1]}{prevEst ? ' y sus costos son estimados, porque no están cargados los costos reales de ese año' : ''}.{enUF ? ' En UF, cada cifra va a la UF del día de su movimiento.' : ''}
      </div>

      {(() => {
        const { p, e } = idpc, fila = (k, sg, l, v, o = {}) => <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: D ? '8px 14px' : '8px 12px', borderTop: `1px solid ${C.bgSoft}`, background: o.tot ? C.bgSoft : undefined, fontSize: D ? 13 : 12, whiteSpace: 'nowrap' }}>
          <span style={{ width: 12, textAlign: 'center', color: C.muted, fontWeight: 700, flexShrink: 0 }}>{sg}</span>
          <span style={{ flex: 1, minWidth: 0, fontWeight: o.tot || o.big ? 800 : 600, color: o.tot || o.big ? C.accent : (o.mute ? C.muted : C.text) }}>{l}</span>
          <span style={{ fontWeight: o.tot || o.big ? 800 : 700, fontVariantNumeric: 'tabular-nums', color: o.neg ? C.overdueText : (o.tot || o.big ? C.accent : (o.mute ? C.muted : C.text)) }}>{v}</span></div>
        const proy = curM < 11 ? `Proyección ${MC[curM]}–dic` : (curM === 11 ? 'Proyección diciembre' : null)
        return <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '0 2px 8px', ...SEC_LBL, fontSize: 10.5 }}><span>IDPC estimado del año</span><span style={{ color: C.muted, textTransform: 'none', letterSpacing: 0 }}>estimación</span></div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            {idpc.cuadra
              ? <>{fila('i', '', 'IDPC estimado del año', fmtMill(e.idpc), { big: true })}{fila('s', '', 'Saldo a abril', fmtMill(e.saldo), { big: true, neg: e.saldo < 0 })}</>
              : <div style={{ padding: '12px 14px', fontSize: 12, color: C.overdueText, fontWeight: 600 }}>Estimación no disponible: {idpc.sinRespaldo.n} {idpc.sinRespaldo.n === 1 ? 'factura pagada' : 'facturas pagadas'} del año sin respaldo en la cartola, por {fmtMill(idpc.sinRespaldo.monto)}. Concílialas en Banco o corrige su estado.</div>}
            <div onClick={() => setVerIdpc(!verIdpc)} style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: C.azulInfo, cursor: 'pointer', borderTop: `1px solid ${C.bgSoft}` }}>{verIdpc ? 'Ocultar cálculo' : 'Ver cálculo'} ›</div>
            {verIdpc && <>
              {fila('r', '', 'Resultado antes de impuestos', fmtMill(p.resultadoAntes))}
              {fila('c', '', 'Variación de cuentas por cobrar', fmtMill(p.varCxC), { neg: p.varCxC < 0 })}
              {fila('pg', '', 'Variación de cuentas por pagar', fmtMill(p.varCxP), { neg: p.varCxP < 0 })}
              {fila('b1', '=', 'Base al ' + fmtFechaDMY(new Date().toISOString().slice(0, 10)), fmtMill(p.base), { tot: true })}
              {proy && fila('py', '', proy, fmtMill(e.proyeccion), { neg: e.proyeccion < 0 })}
              {fila('ds', '', 'Desfase de pago a fin de año', fmtMill(idpc.des.desfase), { neg: idpc.des.desfase < 0 })}
              {fila('b2', '=', 'Base del año', fmtMill(e.baseAnio), { tot: true })}
              {fila('in', '−', 'Incentivo al ahorro, 50 %', fmtMill(e.incentivo))}
              {fila('b3', '=', 'Base afecta', fmtMill(e.baseAfecta), { tot: true })}
              {fila('id', '', 'IDPC 12,5 %', fmtMill(e.idpc))}
              {fila('pp', '−', 'PPM del año', fmtMill(e.ppm))}
              {fila('sa', '=', 'Saldo a abril', fmtMill(e.saldo), { tot: true, neg: e.saldo < 0 })}
              {fila('si', '', 'Depósitos sin identificar, fuera de la base', fmtMill(idpc.sinIdentificar), { mute: true })}
              {fila('co', '', 'Facturas pagadas sin respaldo en la cartola', fmtMill(idpc.sinRespaldo.monto), { mute: true })}
            </>}
          </div>
          <div style={{ fontSize: 11, color: C.muted, margin: '10px 2px 0', lineHeight: 1.5 }}>
            Estimación en pesos, régimen Pro Pyme general. Parte del Resultado antes de impuestos de este Estado y lo lleva a caja con el cobrado de Inicio (facturas y anticipos conciliados) y las comisiones pagadas. Los costos se toman como pagados en el mes en que se devengan, salvo el desfase de un mes de cotizaciones y F29 (retención e impuesto único), que se ajusta a fin de año con diciembre anterior y el último período cerrado. Es un piso: los depósitos sin identificar no entran. Proyección moderada de los meses que faltan, sin crecimiento.
          </div>
        </div>
      })()}

      {/* Lo que antes vivía solo en «Resultado del año»: Presupuesto vs real y Salud de datos (la planilla de costos por mes sigue en su página). */}
      <ResultadoAnioView soloControl isDesktop={D} billing={billing} terceros={terceros} costosOfiRows={costosOfiRows} expenses={expenses} clients={clients} user={user} onOpenGasto={onOpenGasto} onCargarBoleta={onCargarBoleta} checksExtra={checkFechas} />
    </div>)
}
