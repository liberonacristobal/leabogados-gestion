// Cifras por socio (Por socio y Panel de socios): la función compartida debe dar EXACTAMENTE lo que daban las fórmulas en línea de PorSocioVista.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kpisPorSocio } from '../src/lib/cifras.js'

// Referencia: copia literal de las fórmulas que estaban dentro de PorSocioVista antes de extraerlas (commit c70642a9).
function referencia(P, V, ym) {
  const y = Number(ym.slice(0, 4))
  const inPer = (d, p) => { const s = String(d || '').slice(0, 7); return p === 'mes' ? s === ym : (s >= `${y}-01` && s <= ym) }
  const sumP = (s, k, soc, p) => P.reduce((a, r) => a + ((r.s === s && (k == null || (Array.isArray(k) ? k.includes(r.k) : r.k === k)) && (!soc || r.soc === soc) && inPer(r.d, p)) ? r.m : 0), 0)
  const vend = (soc, p) => V.reduce((a, x) => a + ((!soc || x.soc === soc) && (p === 'mes' ? x.ym === ym : x.ym <= ym) ? x.m : 0), 0)
  const KF = ['emit', 'cext', 'reemb', 'nc'], KC = ['fac', 'ant', 'reemb']
  const card6 = (soc, p) => { const fac = sumP('f', KF, soc, p), cp = sumP('c', KC, soc, p), com = -sumP('c', 'com', soc, p), pe = sumP('c', 'perc', soc, p); return [vend(soc, p), fac, cp, com, pe, cp - com + pe, sumP('c', 'sub', soc, p)] }
  return card6
}

const SOCIOS = ['Socio A', 'Socio B', 'Sin socio']
const P = []
const clases = [['f', 'emit'], ['f', 'cext'], ['f', 'reemb'], ['f', 'nc'], ['f', 'com'], ['c', 'fac'], ['c', 'ant'], ['c', 'reemb'], ['c', 'com'], ['c', 'perc'], ['c', 'sub']]
let n = 0
for (const soc of SOCIOS) for (const [s, k] of clases) for (const d of ['2026-01-15', '2026-03-02', '2026-09-30', '2026-10-05', '2026-10-31', '2025-12-31', '2026-11-02']) P.push({ s, k, soc, d, m: (++n % 7 === 0 ? -1 : 1) * (n * 1234 + 17) })
const V = []
for (const soc of SOCIOS) for (const ym of ['2026-01', '2026-05', '2026-09', '2026-10', '2026-11']) V.push({ soc, ym, m: soc.length * 100000 + ym.length * 7 })

test('Por socio: la función compartida reproduce las fórmulas originales en cada socio, cada período y cada mes', () => {
  for (const ym of ['2026-01', '2026-03', '2026-09', '2026-10', '2026-11']) {
    const ref = referencia(P, V, ym), nuevo = kpisPorSocio({ P, V, ym }).card6
    for (const soc of [null, ...SOCIOS]) for (const p of ['mes', 'ytd']) assert.deepEqual(nuevo(soc, p), ref(soc, p), `${ym} ${soc} ${p}`)
  }
})

test('Por socio: sin partidas ni ventas todo es cero, sin NaN', () => {
  const r = kpisPorSocio({ P: [], V: [], ym: '2026-10' }).card6(null, 'ytd')
  assert.equal(r.length, 7)
  assert.ok(r.every(x => x === 0))   // -0 cuenta como 0 (las comisiones pagadas van con signo)
})
