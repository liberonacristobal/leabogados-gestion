// Excel del Presupuesto anual: hojas con fórmulas vivas (Supuestos → Base → Arrastre → Costos → Escenarios → Mes a mes → Por socio → Metas → Resumen del año).
// Las fórmulas repiten el modelo de _shared/presupuesto.js; `evaluar` las calcula aquí mismo para guardar el valor al abrir el archivo y para probar que coinciden con el modelo.
import { parteMeta } from '../../supabase/functions/_shared/presupuesto.js'

const COL = (/** @type {number} */ i) => String.fromCharCode(65 + i)
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const PESOS = '#,##0', PCT = '0.0%', UF = '#,##0.00'

/** @param {string} f @param {string} z */ const F = (f, z = PESOS) => ({ f, z })
/** @param {any} v @param {string} z */ const N = (v, z = PESOS) => ({ v: Number(v) || 0, z })

/**
 * Hojas del libro. Una celda es texto, {v,z} (número con formato), {f,z} (fórmula con formato) o null (vacía).
 * @param {{ anio:number, anioBase:number, ufDic:number, baseCLP:number[], baseUF:number[], est:any, ESC:string[][], costos:any[], socios:{nombre:string,facturado:number}[], oficiales:any, mes26:{a:number|null,f:number|null,cob:number|null}[], metas?:{ancla:string,valor:number}, ratio?:number|null, cv?:number|null, refK?:string, referencia?:Record<string,{cierre:number}>, arrastre?:{ nombre:string, concepto:string, tipo:string, estado:string, n:number, mensual:number, meses:number, total:number, enApp:number, nota:string, porMes:number[] }[] }} P
 */
export function hojasPresupuesto(P) {
  const { est, ESC } = P, ne = ESC.length, iBase = Math.max(0, ESC.findIndex(([k]) => k === (P.refK || 'base')))   // iBase = escenario de referencia de las metas (Base)
  const sc = (/** @type {number} */ j) => COL(1 + j) // columna del escenario j en Supuestos y Escenarios
  const nC = P.costos.length, totC = nC + 2

  const supuestos = {
    nombre: 'Supuestos', anchos: [38, 16, 16, 16, 16, 16],
    filas: [
      [`Presupuesto ${P.anio} · supuestos`],
      [],
      [],
      ['Año del presupuesto', N(P.anio, '0')],
      ['UF de cierre del año base', N(P.ufDic, UF)],
      ['Reajuste anual de la UF (%)', N(est.reajusteUF, '0.0')],
      ['Tasa de primera categoría (%)', N(est.tasaIDPC, '0.0')],
      ['PPM del año', N(est.ppmAnual)],
      ['Aumento de reserva (%)', N(est.reserva, '0.0')],
      [],
      ['Supuesto', ...ESC.map(([, n]) => n)],
      ['Crecimiento real (%)', ...ESC.map(([k]) => N(est.p[k].g, '0.0'))],
      ['Alza de costos (%)', ...ESC.map(([k]) => N(est.p[k].alza, '0.0'))],
      ['Comisiones (% de lo cobrado)', ...ESC.map(([k]) => N(est.p[k].terc, '0.0'))],
      ['Días de cobro', ...ESC.map(([k]) => N(est.p[k].dias, '0'))],
      ['Facturado / vendido bruto (%) · metas', N(P.ratio ?? 0, '0.0')],
      ['Reserva en cuenta corriente ($)', N(est.reservaIni ?? 0)],
      ['Comisión sobre ventas (% del bruto) · metas', N(P.cv ?? 0, '0.0')],
    ],
  }
  const base = {
    nombre: 'Base', anchos: [8, 14, 18, 18, 18],
    filas: [
      ['N.º', 'Mes', 'Facturado base ($)', 'Facturado base (UF)', 'UF proyectada'],
      ...MESES.map((m, i) => [i + 1, m, N(P.baseCLP[i]), N(P.baseUF[i], UF), F(`Supuestos!$B$5*(1+Supuestos!$B$6/100)^(A${i + 2}/12)`, UF)]),
    ],
  }
  // Arrastre: una fila por línea (con los ajustes del borrador), sus meses y el total con fórmula; las quitadas valen 0 y dicen «quitada».
  const nA = (P.arrastre || []).length
  const arrastre = P.arrastre ? {
    nombre: `Arrastre ${P.anioBase}`, anchos: [26, 30, 12, 14, 14, 8, 16, 10, 16, 28, ...MESES.map(() => 12)],
    filas: [
      [`Arrastre ${P.anioBase} · líneas con los ajustes del presupuesto`],
      ['Cliente', 'Proyecto', 'Tipo', 'Estado', 'Por mes ($)', 'Meses', `Total ${P.anio} ($)`, 'Cuotas', 'Calculado ($)', 'Nota', ...MESES],
      ...P.arrastre.map((l) => [l.nombre, l.concepto, l.tipo, l.estado, l.tipo === 'Asesoría' ? N(l.mensual) : null, l.tipo === 'Asesoría' ? N(l.meses, '0') : null, N(l.total), l.tipo === 'Cuotas' ? N(l.n, '0') : null, N(l.enApp), l.nota, ...l.porMes.map((v) => N(v))]),
      ['Total', '', '', '', null, null, F(`SUM(G3:G${nA + 2})`), null, F(`SUM(I3:I${nA + 2})`), '', ...MESES.map((_, i) => F(`SUM(${COL(10 + i)}3:${COL(10 + i)}${nA + 2})`))],
    ],
  } : null
  const costos = {
    nombre: 'Costos', anchos: [34, 14, 16, 8, 16, ...ESC.map(() => 18)],
    filas: [
      ['Partida', 'Tipo', 'Monto mensual', 'Meses', 'Alza propia (%)', ...ESC.map(([, n]) => n)],
      ...P.costos.map((c, i) => [c.n, c.t || '', N(c.m), N(c.meses, '0'), c.alza == null ? null : N(c.alza, '0.0'), ...ESC.map((_, j) => F(`$C${i + 2}*$D${i + 2}*(1+IF(ISBLANK($E${i + 2}),Supuestos!${sc(j)}$13,$E${i + 2})/100)`))]),
      ['Total', '', null, null, null, ...ESC.map((_, j) => F(`SUM(${COL(5 + j)}2:${COL(5 + j)}${nC + 1})`))],
    ],
  }
  const r = (/** @type {number} */ k, /** @type {string} */ t, /** @type {(c:string)=>string} */ fn, z = PESOS) => [t, ...ESC.map((_, j) => F(fn(sc(j)), z))]
  const escenarios = {
    nombre: 'Escenarios', anchos: [40, 18, 18, 18],
    filas: [
      ['Concepto', ...ESC.map(([, n]) => n)],
      r(2, 'Facturado (UF)', (c) => `SUM(Base!$D$2:$D$13)*(1+Supuestos!${c}$12/100)`, UF),
      r(3, 'Facturado ($)', (c) => `SUMPRODUCT(Base!$D$2:$D$13,Base!$E$2:$E$13)*(1+Supuestos!${c}$12/100)`),
      r(4, 'Variación de cuentas por cobrar', (c) => `Supuestos!${c}$15/30*(Base!$D$13*(1+Supuestos!${c}$12/100)*Base!$E$13-Base!$C$13)`),
      r(5, 'Cobrado (caja)', (c) => `${c}3-${c}4`),
      r(6, 'Comisiones', (c) => `${c}5*Supuestos!${c}$14/100`),
      r(7, 'Costos de oficina', (c) => `Costos!${COL(5 + (c.charCodeAt(0) - 66))}${totC}`),
      r(8, 'Resultado antes de impuesto', (c) => `${c}5-${c}6-${c}7`),
      r(9, 'Impuesto de primera categoría', (c) => `MAX(0,${c}8)*Supuestos!$B$7/100`),
      r(10, 'Resultado después de impuesto', (c) => `${c}8-${c}9`),
      r(11, 'Aumento de reserva', (c) => `MAX(0,${c}10)*Supuestos!$B$9/100`),
      r(12, 'Retiros de los socios', (c) => `MAX(0,${c}10)*(1-Supuestos!$B$9/100)`),
      r(13, 'PPM del año', () => 'Supuestos!$B$8'),
      r(14, 'Impuesto por pagar (menos PPM)', (c) => `${c}9-${c}13`),
    ],
  }
  const mes = {
    nombre: 'Mes a mes', anchos: [14, 16, ...ESC.map(() => 18), ...ESC.map(() => 18)],
    filas: [
      ['Mes', 'UF proyectada', ...ESC.map(([, n]) => `${n} (UF)`), ...ESC.map(([, n]) => `${n} ($)`)],
      ...MESES.map((m, i) => [m, F(`Base!E${i + 2}`, UF),
        ...ESC.map((_, j) => F(`Base!$D${i + 2}*(1+Supuestos!${sc(j)}$12/100)`, UF)),
        ...ESC.map((_, j) => F(`${COL(2 + j)}${i + 2}*$B${i + 2}`))]),
      ['Total', null, ...ESC.map((_, j) => F(`SUM(${COL(2 + j)}2:${COL(2 + j)}13)`, UF)), ...ESC.map((_, j) => F(`SUM(${COL(2 + ne + j)}2:${COL(2 + ne + j)}13)`))],
    ],
  }
  const nS = P.socios.length, bc = sc(iBase)
  const socio = {
    nombre: 'Por socio', anchos: [22, 20, 16, 24, 24, 18, 28, 28],
    filas: [
      ['Socio', `Facturado ${P.anioBase} ($)`, 'Participación', `Facturado ${P.anio} · ${ESC[iBase][1]} ($)`, `Retiros · ${ESC[iBase][1]} ($)`, 'Parte de las metas', `Meta de facturación · ${ESC[iBase][1]} ($)`, `Meta de cobro · ${ESC[iBase][1]} ($)`],
      ...P.socios.map((s, i) => [s.nombre, N(s.facturado), F(`IF(B${nS + 2}=0,0,B${i + 2}/B${nS + 2})`, PCT), F(`C${i + 2}*Escenarios!$${bc}$3`), F(`C${i + 2}*Escenarios!$${bc}$12`), N(parteMeta(P.socios, s.nombre), PCT), F(`F${i + 2}*Escenarios!$${bc}$3`), F(`F${i + 2}*Escenarios!$${bc}$5`)]),
      ['Total', F(`SUM(B2:B${nS + 1})`), F(`SUM(C2:C${nS + 1})`, PCT), F(`SUM(D2:D${nS + 1})`), F(`SUM(E2:E${nS + 1})`), F(`SUM(F2:F${nS + 1})`, PCT), F(`SUM(G2:G${nS + 1})`), F(`SUM(H2:H${nS + 1})`)],
    ],
  }
  // Metas: la misma cascada del modelo en los dos sentidos. Se fija un componente (B2 = ventas, fact, caja, margen o retiros) y su valor (B3); el crecimiento exigido sale de despejarlo y el resto se calcula con los
  // supuestos del escenario Base. Fórmulas equivalentes a metasDesdeComponente / cadenaMeta de _shared/presupuesto.js (la prueba las compara).
  const bc2 = sc(iBase), sB = (/** @type {number} */ r) => `Supuestos!$${bc2}$${r}`
  const m0 = P.metas || { ancla: 'retiros', valor: 0 }, ref = P.referencia || {}
  const cierre = (/** @type {string} */ k) => (ref[k] ? N(ref[k].cierre) : null)
  const caja1 = '(B9+B8)/(1-' + sB(14) + '/100)'
  const metas = {
    nombre: 'Metas 2027', anchos: [46, 20, 22],
    filas: [
      [`Metas ${P.anio}`, null, `Cierre ${P.anioBase} estimado`],
      ['Componente fijado (ventas, fact, caja, margen o retiros)', String(m0.ancla)],
      ['Meta fijada ($)', N(m0.valor)],
      ['Facturado / vendido (%)', F('Supuestos!$B$16', '0.0')],
      ['Días de cobro ÷ 30', F(`${sB(15)}/30`, '0.000')],
      ['Facturado base, crecimiento 0 ($)', F('SUMPRODUCT(Base!$D$2:$D$13,Base!$E$2:$E$13)')],
      ['Peso de diciembre en el facturado', F('IF(B6=0,0,Base!$D$13*Base!$E$13/B6)', '0.0000')],
      ['Presupuesto de costos ($)', F(`Escenarios!$${bc2}$7`)],
      ['Resultado requerido ($)', F('IF(B2="margen",B3,IF(B2="retiros",B3/(1-Supuestos!$B$9/100)/(1-Supuestos!$B$7/100),0))')],
      ['Cobrado requerido ($)', F(`IF(B2="caja",B3,IF(B2="margen",${caja1},IF(B2="retiros",${caja1},0)))`)],
      ['Facturado requerido ($)', F('IF(B2="ventas",B3/(1-Supuestos!$B$18/100)*B4/100,IF(B2="fact",B3,(B10-B5*Base!$C$13)/(1-B5*B7)))')],
      ['Crecimiento real exigido (%)', F('IF(B6=0,0,(B11/B6-1)*100)', '0.0')],
      [],
      ['Vendido neto (estimación propia)', F('IF(B4>0,B11/(B4/100)*(1-Supuestos!$B$18/100),0)'), cierre('ventas')],
      ['Facturado', F('B11'), cierre('fact')],
      ['Cobrado', F('B11-B5*(B7*B11-Base!$C$13)'), cierre('caja')],
      ['Comisiones', F(`B16*${sB(14)}/100`)],
      ['Presupuesto de costos', F('B8'), cierre('costos')],
      ['Resultado', F('B16-B17-B18'), cierre('margen')],
      ['Impuesto de primera categoría', F('MAX(0,B19)*Supuestos!$B$7/100')],
      ['Después de impuesto', F('B19-B20')],
      ['Aumento de reserva', F('MAX(0,B21)*Supuestos!$B$9/100')],
      ['Retiros', F('MAX(0,B21)*(1-Supuestos!$B$9/100)'), cierre('retiros')],
      ['Reserva al cierre (cuenta corriente + aumento)', F('Supuestos!$B$17+B22')],
      ['Meses de costos de oficina que cubre', F('IF(B18=0,0,B24/(B18/12))', '0.0')],
      ['Vendido bruto (facturado ÷ relación)', F('IF(B4>0,B11/(B4/100),0)')],
      ['Comisiones de venta', F('B26*Supuestos!$B$18/100')],
    ],
  }
  const o = P.oficiales
  const resumen = {
    nombre: `Resumen ${P.anioBase}`, anchos: [26, 18, 18, 18, 18],
    filas: [
      [`Resumen ${P.anioBase} · cifras de Inicio`],
      ['Concepto', 'UF', '$'],
      ['Vendido', N(o.vend.uf, UF), N(o.vend.clp)],
      ['Facturado', N(o.fact.uf, UF), N(o.fact.clp)],
      ['Cobrado', N(o.cob.uf, UF), N(o.cob.clp)],
      ['Resultado', N(o.marg.uf, UF), N(o.marg.clp)],
      ['Meta de ventas', null, N(o.metaVentasCLP)],
      ['Meta de cobranza', null, N(o.metaCobroCLP)],
      [],
      ['Mes', `Facturado ${P.anioBase - 1} ($)`, `Facturado ${P.anioBase} ($)`, 'Variación', `Cobrado ${P.anioBase} ($)`],
      ...MESES.map((m, i) => { const x = P.mes26[i] || { a: null, f: null, cob: null }, f = i + 11; return [m, x.a == null ? null : N(x.a), x.f == null ? null : N(x.f), x.a && x.f != null ? F(`IF(B${f}=0,0,C${f}/B${f}-1)`, PCT) : null, x.cob == null ? null : N(x.cob)] }),
    ],
  }
  return [supuestos, base, ...(arrastre ? [arrastre] : []), costos, escenarios, mes, socio, metas, resumen]
}

/**
 * Calcula las fórmulas de las hojas (SUM, SUMPRODUCT, MAX, IF, ISBLANK y aritmética) y devuelve cada celda con su valor.
 * @param {{nombre:string, filas:any[][]}[]} hojas
 */
export function evaluar(hojas) {
  const por = /** @type {Record<string, any[][]>} */ ({})
  hojas.forEach((h) => { por[h.nombre] = h.filas })
  const memo = /** @type {Record<string, any>} */ ({})
  const colN = (/** @type {string} */ c) => c.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1
  const celda = (/** @type {string} */ h, /** @type {number} */ c, /** @type {number} */ r) => {
    const k = `${h}|${c}|${r}`
    if (k in memo) return memo[k]
    const x = (por[h] || [])[r]?.[c]
    let v
    if (x && typeof x === 'object' && 'f' in x) v = correr(x.f, h)
    else if (x && typeof x === 'object') v = x.v
    else v = x == null ? null : x
    return (memo[k] = v)
  }
  const num = (/** @type {any} */ v) => (typeof v === 'number' ? v : 0)
  const plano = (/** @type {any[]} */ a) => a.flat(Infinity)
  const fn = {
    SUM: (/** @type {any[]} */ ...a) => plano(a).reduce((s, v) => s + num(v), 0),
    SUMPRODUCT: (/** @type {any[]} */ a, /** @type {any[]} */ b) => a.reduce((s, v, i) => s + num(v) * num(b[i]), 0),
    MAX: (/** @type {any[]} */ ...a) => Math.max(...plano(a).map(num)),
    IF: (/** @type {any} */ c, /** @type {any} */ a, /** @type {any} */ b) => (c ? a : b),
    ISBLANK: (/** @type {any} */ v) => v == null || v === '',
  }
  /** @param {string} f @param {string} h */
  function correr(f, h) {
    const js = f.replace(/(?:(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))!)?\$?([A-Z]{1,2})\$?(\d+)(?::\$?([A-Z]{1,2})\$?(\d+))?/g, (_, q, s, c1, r1, c2, r2) => {
      const hh = JSON.stringify(q || s || h)
      if (c2 == null) return `CE(${hh},${colN(c1)},${Number(r1) - 1})`
      return `RG(${hh},${colN(c1)},${Number(r1) - 1},${colN(c2)},${Number(r2) - 1})`
    }).replace(/\^/g, '**').replace(/(?<![<>=!])=(?!=)/g, '==')
    const CE = (/** @type {string} */ hh, /** @type {number} */ c, /** @type {number} */ r) => { const v = celda(hh, c, r); return v == null ? 0 : v }
    const RG = (/** @type {string} */ hh, /** @type {number} */ c1, /** @type {number} */ r1, /** @type {number} */ c2, /** @type {number} */ r2) => { const o = []; for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) o.push(celda(hh, c, r)); return o }
    // ISBLANK necesita la celda sin convertir a 0
    const js2 = js.replace(/ISBLANK\(CE\(/g, 'ISBLANK(RAW(')
    const RAW = (/** @type {string} */ hh, /** @type {number} */ c, /** @type {number} */ r) => celda(hh, c, r)
    return new Function('CE', 'RG', 'RAW', ...Object.keys(fn), `return (${js2})`)(CE, RG, RAW, ...Object.values(fn))
  }
  return hojas.map((h) => ({ nombre: h.nombre, filas: h.filas.map((fila, r) => fila.map((x, c) => (x && typeof x === 'object' && 'f' in x ? { ...x, v: celda(h.nombre, c, r) } : x))) }))
}

/** Escribe el libro con SheetJS (carga perezosa, como el resto de las descargas de la app). @returns {Promise<string|false>} */
export async function descargarLibroPresupuesto(/** @type {Parameters<typeof hojasPresupuesto>[0]} */ P, /** @type {(m:string)=>void} */ avisar) {
  try {
    const XLSX = await import(/* @vite-ignore */ 'https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
    const wb = XLSX.utils.book_new()
    evaluar(hojasPresupuesto(P)).forEach((h, i) => {
      const ws = /** @type {Record<string, any>} */ ({}); let maxC = 0
      h.filas.forEach((fila, r) => fila.forEach((x, c) => {
        if (x == null) return
        maxC = Math.max(maxC, c)
        const ref = XLSX.utils.encode_cell({ r, c })
        if (typeof x === 'object') ws[ref] = 'f' in x ? { t: typeof x.v === 'string' ? 's' : 'n', f: x.f, v: x.v, z: x.z } : { t: 'n', v: x.v, z: x.z }
        else ws[ref] = { t: typeof x === 'number' ? 'n' : 's', v: x }
      }))
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, h.filas.length - 1), c: maxC } })
      ws['!cols'] = ((hojasPresupuesto(P)[i] || {}).anchos || []).map((/** @type {number} */ w) => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, ws, h.nombre)
    })
    XLSX.writeFile(wb, `Presupuesto_${P.anio}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    return 'Excel descargado'
  } catch (e) { avisar('No se pudo generar el Excel: ' + (/** @type {any} */ (e)?.message || e)); return false }
}
