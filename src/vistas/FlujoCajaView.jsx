// Flujo de caja (página autónoma): barras apiladas de ingresos y egresos por semana o mes, con el saldo acumulado.
// No calcula nada propio: lee useFlujoCaja (flujoCajaProyectado, la misma cifra de Inicio, Oficina y Panel). El escenario «Sin morosos» deja fuera a los
// clientes con facturas morosas; «Con morosos» los proyecta como a cualquier otro.
import { useEffect, useMemo, useRef, useState } from 'react'
import { C, SIcon, isoLocal, fmtFechaDMY, folioN, appAlert } from '../lib/base.jsx'
import { useFlujoCaja, useEscenarioFlujo, fmtMill, MES_C } from '../lib/compartido.jsx'
import { useControlProyeccion } from '../lib/controlProyeccionHook.js'
import { useOrden } from '../lib/orden.jsx'

const SER = { alDia: ['Emitidas al día', C.serie1], venc: ['Emitidas vencidas', C.serie2], cuotas: ['Cuotas por facturar', C.serie3] }
const VISTAS = [['barras', 'Barras'], ['lineas', 'Líneas'], ['cascada', 'Cascada']]
const EGR = { of: ['Operación', C.egrOp], com: ['Comisiones', C.egrCom] }
const fM = n => (n < 0 ? '−' : '') + fmtMill(Math.abs(n))
const pesos = v => (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('es-CL')
const isoDe = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const sumaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDe(d) }
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const dm = iso => fmtFechaDMY(iso).slice(0, 5)

// Paso «redondo» del eje: el menor de la serie que deja ≤6 marcas.
function marcas(max, min) {
  const rng = max - min, paso = [1, 2, 2.5, 5, 10, 20, 25, 50, 100].map(x => x * 1e6).find(p => rng / p <= 6) || 1e8, out = []
  for (let v = Math.ceil(min / paso) * paso; v <= max + 1; v += paso) out.push(v)
  return out
}

export function FlujoCajaView({ billing: billingTodo = [], costosOfiRows = [], terceros = [], anticipos = [], expenses = [], clients = [], sales = [], fantasmaIds = null, isDesktop = false, onOpenClientFicha, onOpenFactura, onOpenCostos, onOpenPorFacturar }) {
  const billing = useMemo(() => (fantasmaIds && fantasmaIds.size) ? (billingTodo || []).filter(b => !fantasmaIds.has(String(b.id))) : billingTodo, [billingTodo, fantasmaIds])
  const [conMor, setConMor] = useEscenarioFlujo()
  const [gran, setGran] = useState('sem')
  const [vista, setVistaS] = useState(() => { try { const v = localStorage.getItem('flujo_vista'); return VISTAS.some(x => x[0] === v) ? v : 'barras' } catch (_) { return 'barras' } })
  const setVista = v => { try { localStorage.setItem('flujo_vista', v) } catch (_) {} setVistaS(v) }
  const F = useFlujoCaja({ billing, terceros, costosOfiRows, anticipos, expenses, clients, sales, conMorosos: conMor })
  const control = useControlProyeccion({ F, sales, billing, terceros, costosOfiRows, expenses, clients, anticipos })
  const [vis, setVis] = useState({ alDia: 1, venc: 1, cuotas: 1, of: 1, com: 1, saldo: 1 })
  const [sel, setSel] = useState(null), [hov, setHov] = useState(null), [tipo, setTipo] = useState(null)
  const [tab, setTab] = useState('cli'), [fil, setFil] = useState('todos'), [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const wrapRef = useRef(null), tabsRef = useRef(null), detRef = useRef(null)
  const [W, setW] = useState(0)
  useEffect(() => { const el = wrapRef.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth - 16)); ro.observe(el); setW(el.clientWidth - 16); return () => ro.disconnect() }, [])
  useEffect(() => { setSel(null); setTipo(null) }, [gran, conMor])

  const nomDe = useMemo(() => { const m = {}; (clients || []).forEach(c => { if (c) m[String(c.id)] = c.name }); return m }, [clients])
  const nom = cid => nomDe[String(cid)] || 'Sin cliente'
  const morosoDe = useMemo(() => new Set(F.clientes.filter(c => c.duda > 0).map(c => String(c.cid))), [F])
  // Un cobro = una fila del detalle: de dónde viene (factura o cuota), cuándo se espera y cuánto.
  const cobros = useMemo(() => F.cobros.concat(conMor ? [] : F.exclMor.items).map(x => ({
    b: x.b, cid: String(x.b.client_id || ''), t: isoDe(x.t), m: x.m, k: x.k === 'prog' ? 'cuotas' : (x.v ? 'venc' : 'alDia'), est: !!x.est, mor: morosoDe.has(String(x.b.client_id || '')),
    excl: !conMor && morosoDe.has(String(x.b.client_id || '')),
    txt: x.k === 'prog' ? String(x.b.concept || 'Cuota').replace(/^.*? — /, '') : `Factura N° ${folioN(x.b.invoice_no)}` })).sort((a, b) => a.t.localeCompare(b.t)), [F, conMor, morosoDe])

  const grupos = useMemo(() => {
    const incl = c => !c.excl
    if (gran === 'sem') {
      let run = 0
      return F.weeks.map((w, i) => { const fin = sumaDias(w.ini, 6), items = cobros.filter(c => (c.t >= w.ini && c.t <= fin) || (i === 0 && c.t < w.ini)), ser = { alDia: 0, venc: 0, cuotas: 0 }
        items.filter(incl).forEach(c => { ser[c.k] += c.m })
        const ing = ser.alDia + ser.venc + ser.cuotas, egr = w.of + w.com; run = w.run
        return { key: w.ini, label: dm(w.ini), tit: 'Semana del ' + fmtFechaDMY(w.ini), sub: 'al ' + fmtFechaDMY(fin), ser, of: w.of, com: w.com, ing, egr, neto: ing - egr, saldo: run, items } }) }
    const m = {}
    cobros.forEach(c => { const k = c.t.slice(0, 7); (m[k] = m[k] || { key: k, label: MES_C[+k.slice(5, 7) - 1] + '-' + k.slice(2, 4), tit: MES_LARGO[+k.slice(5, 7) - 1] + ' de ' + k.slice(0, 4), sub: '', ser: { alDia: 0, venc: 0, cuotas: 0 }, of: 0, com: 0, items: [] }).items.push(c) })
    return Object.values(m).sort((a, b) => a.key.localeCompare(b.key)).map(g => { g.items.filter(incl).forEach(c => { g.ser[c.k] += c.m }); g.ing = g.ser.alDia + g.ser.venc + g.ser.cuotas; g.egr = 0; g.neto = g.ing; g.saldo = null; return g })
  }, [F, cobros, gran])
  const sem8 = F.weeks
  const ing8 = F.E, egr8 = F.O + F.C
  const minSaldo = sem8.reduce((a, w) => (w.run < a.s ? { s: w.run, w } : a), { s: Infinity, w: null })

  const irA = r => setTimeout(() => { try { r.current && r.current.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch (_) {} }, 30)
  const elegir = i => { setSel(s => (s === i ? null : i)); setTipo(null); if (!isDesktop) setHov(null); setTimeout(() => { try { detRef.current && detRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) } catch (_) {} }, 60) }

  // ── Gráfico
  const H = W < 520 ? 280 : 320, L = 46, R = 12, T = 26, B = 34, n = grupos.length, sem = gran === 'sem'
  const geo = useMemo(() => {
    if (!W || !n) return null
    const ingMax = Math.max(...grupos.map(x => x.ing), 1), egrMax = sem ? Math.max(...grupos.map(x => x.egr), 0) : 0
    let ymax = ingMax * 1.14, ymin = -egrMax * 1.25
    if (sem && vis.saldo) { ymax = Math.max(ymax, ...grupos.map(x => x.saldo)); ymin = Math.min(ymin, ...grupos.map(x => x.saldo)) }
    if (vista === 'cascada') { const sal = sem ? grupos.map(x => x.saldo) : grupos.reduce((a, x, i) => (a.push((a[i - 1] || 0) + x.ing), a), []); ymax = (Math.max(0, ...sal) * 1.14) || 1; ymin = Math.min(0, ...sal) * 1.25 }
    else if (!sem) ymin = 0
    const y = v => T + (ymax - v) / (ymax - ymin) * (H - T - B), bw = (W - L - R) / n, w = Math.min(bw * .64, sem ? 56 : 34)
    return { y, bw, w, tk: marcas(ymax, ymin) }
  }, [W, n, grupos, sem, vis.saldo, H, vista])

  const barras = () => {
    if (!geo) return null
    const { y, bw, w, tk } = geo, out = []
    tk.forEach(v => out.push(<g key={'t' + v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.border} strokeDasharray='3 4' /><text x={L - 8} y={y(v) + 3.5} textAnchor='end' fontSize='10.5' fill={C.textSoft}>{v === 0 ? '$0' : fM(v)}</text></g>))
    out.push(<line key='cero' x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke={C.done} strokeWidth='1.2' />)
    // La cifra de cada barra se sube sobre la línea del saldo cuando esta le pasa por encima (la línea no se mueve: es la cifra la que se aparta).
    const pl = sem && vis.saldo && vista === 'barras' ? grupos.map((x, i) => [L + bw * i + bw / 2, y(x.saldo)]) : []
    const yLinea = xp => { for (let j = 0; j < pl.length - 1; j++) if (xp >= pl[j][0] && xp <= pl[j + 1][0]) return pl[j][1] + (pl[j + 1][1] - pl[j][1]) * (xp - pl[j][0]) / (pl[j + 1][0] - pl[j][0]); return null }
    const ySinLinea = (xp, ly) => { const ys = [-20, -10, 0, 10, 20].map(d => yLinea(xp + d)).filter(v => v != null && v > ly - 14 && v < ly + 6); return Math.max(12, ys.length ? Math.min(ly, ...ys) - 10 : ly) }
    grupos.forEach((x, i) => {
      const cx = L + bw * i + bw / 2, x0 = cx - w / 2, atenuada = res && !x.items.some(c => c.cid === res)
      out.push(<rect key={'b' + i} x={L + bw * i + 2} y={T} width={bw - 4} height={H - T - B} rx='10' fill={sel === i ? C.selBg : hov === i ? C.bgSoft : 'transparent'} stroke={sel === i ? C.accent : 'none'} strokeWidth='1.4' />)
      let acc = 0; const ks = Object.keys(SER).filter(k => vis[k] && x.ser[k] > 0)
      if (vista === 'barras') ks.forEach((k, j) => { const v = x.ser[k], y1 = y(acc + v), y2 = y(acc), top = j === ks.length - 1, hh = Math.max(0, y2 - y1), r = top ? Math.min(7, hh / 2, w / 2) : 0; acc += v
        out.push(<path key={'s' + i + k} opacity={atenuada ? .32 : 1} fill={SER[k][1]} d={r ? `M${x0},${y1 + r} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} V${y2} H${x0} Z` : `M${x0},${y1} h${w} V${y2} H${x0} Z`} />) })
      if (sem && vista === 'barras') { let ac = 0; const eks = Object.keys(EGR).filter(k => vis[k] && x[k] > 0)
        eks.forEach((k, j) => { const v = x[k], y1 = y(-ac), y2 = y(-ac - v), last = j === eks.length - 1, hh = Math.max(0, y2 - y1), r = last ? Math.min(7, hh / 2, w / 2) : 0; ac += v
          out.push(<path key={'e' + i + k} opacity={atenuada ? .32 : 1} fill={EGR[k][1]} d={r ? `M${x0},${y1} h${w} V${y2 - r} q0,${r} ${-r},${r} h${-(w - 2 * r)} q${-r},0 ${-r},${-r} Z` : `M${x0},${y1} h${w} V${y2} H${x0} Z`} />) }) }
      const tot = ks.reduce((a, k) => a + x.ser[k], 0)
      if (vista === 'barras' && tot > 0 && (sem || n <= 14)) out.push(<text key={'v' + i} x={cx} y={ySinLinea(cx, y(tot) - 6)} textAnchor='middle' fontSize='10.5' fontWeight='700' fill={C.accent}>{fM(tot)}</text>)
      out.push(<text key={'x' + i} x={cx} y={H - 12} textAnchor='middle' fontSize='11' fontWeight={sel === i ? 800 : 600} fill={sel === i ? C.accent : C.muted}>{!sem && n > 16 && i % 2 ? '' : x.label}</text>)
    })
    const cxs = grupos.map((x, i) => L + bw * i + bw / 2), linea = (arr, col, k) => out.push(<g key={k}><path d={'M' + arr.map((v, i) => cxs[i] + ',' + y(v)).join(' L')} fill='none' stroke={col} strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round' />{arr.map((v, i) => <circle key={i} cx={cxs[i]} cy={y(v)} r='4.5' fill={col} stroke={C.surface} strokeWidth='2' />)}</g>)
    if (vista === 'lineas') { linea(grupos.map(x => x.ing), C.serie1, 'li'); if (sem) linea(grupos.map(x => -x.egr), C.egrOp, 'le') }
    if (vista === 'cascada') { let prev = 0
      grupos.forEach((x, i) => { const d = sem ? x.neto : x.ing, b2 = prev + d, y1 = y(Math.max(prev, b2)), y2 = y(Math.min(prev, b2)), x0 = cxs[i] - w / 2; prev = b2
        out.push(<g key={'c' + i}><rect x={x0} y={y1} width={w} height={Math.max(2, y2 - y1)} rx='5' fill={d >= 0 ? C.normal : C.overdue} fillOpacity='.6' />
          {i < n - 1 && <line x1={x0 + w} x2={cxs[i + 1] - w / 2} y1={y(b2)} y2={y(b2)} stroke={C.done} strokeDasharray='3 3' />}
          <text x={cxs[i]} y={y1 - 6} textAnchor='middle' fontSize='10.5' fontWeight='700' fill={C.accent}>{(d >= 0 ? '+' : '') + fM(d)}</text></g>) }) }
    if (sem && vis.saldo && vista !== 'cascada') { const pts = grupos.map((x, i) => [L + bw * i + bw / 2, y(x.saldo)])
      out.push(<path key='saldo' d={'M' + pts.map(p => p.join(',')).join(' L')} fill='none' stroke={C.text} strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round' />)
      pts.forEach((p, i) => out.push(<circle key={'p' + i} cx={p[0]} cy={p[1]} r='5' fill={grupos[i].saldo < 0 ? C.overdue : C.normal} stroke={C.surface} strokeWidth='2' />)) }
    grupos.forEach((x, i) => out.push(<rect key={'h' + i} x={L + bw * i} y={T} width={bw} height={H - T - B} fill='transparent' style={{ cursor: 'pointer' }} tabIndex={0} role='button'
      aria-label={`${x.tit}: ingresos ${fM(x.ing)}${sem ? `, saldo ${fM(x.saldo)}` : ''}`} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onFocus={() => setHov(i)} onBlur={() => setHov(null)}
      onClick={() => elegir(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(i) } }} />))
    return out
  }

  // ── Cuadro al pasar el mouse
  const tip = () => {
    if (hov == null || !geo || !grupos[hov]) return null
    const g = grupos[hov], cx = L + geo.bw * hov + geo.bw / 2, tw = 250, izq = cx + 18 + tw > W - 4
    const its = g.items.filter(c => !c.excl).sort((a, b) => b.m - a.m), ex = g.items.length - its.length
    const fila = (c, l, v, neg) => <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 0' }}><i style={{ width: 9, height: 9, borderRadius: 3, background: c, flexShrink: 0 }} /><span style={{ flex: 1, color: C.muted }}>{l}</span><b style={{ color: C.text }}>{v}</b></div>
    const tot = (l, v, col) => <div key={l} style={{ display: 'flex', gap: 7, padding: '2px 0' }}><span style={{ flex: 1, color: C.muted }}>{l}</span><b style={{ color: col || C.accent }}>{v}</b></div>
    return <div style={{ position: 'absolute', left: Math.max(4, (izq ? cx - tw - 18 : cx + 18) + 8), top: 30, width: tw, zIndex: 5, pointerEvents: 'none', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 10px 28px rgba(0,60,80,.2)', padding: '10px 12px', fontSize: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.accent, marginBottom: 6 }}>{g.tit}{g.sub && <span style={{ fontWeight: 500, color: C.textSoft }}> {g.sub}</span>}</div>
      {Object.keys(SER).filter(k => vis[k] && g.ser[k]).map(k => fila(SER[k][1], SER[k][0], fM(g.ser[k])))}
      <div style={{ borderTop: `1px solid ${C.border}`, margin: '6px 0' }} />
      {tot('Ingresos', fM(g.ing))}
      {sem && <>{Object.keys(EGR).filter(k => vis[k] && g[k]).map(k => fila(EGR[k][1], EGR[k][0], fM(-g[k])))}{tot('Neto de la semana', (g.neto >= 0 ? '+' : '') + fM(g.neto))}{tot('Saldo acumulado', fM(g.saldo), g.saldo < 0 ? C.overdueText : C.greenText)}</>}
      <div style={{ color: C.textSoft, fontSize: 11, marginTop: 6 }}>{its.length} cobro{its.length !== 1 ? 's' : ''}{its[0] ? ` · el mayor: ${nom(its[0].cid)} ${fM(its[0].m)}` : ''}{ex && !conMor ? ` · ${ex} excluido${ex !== 1 ? 's' : ''} por morosidad` : ''}</div>
      <div style={{ color: C.textSoft, fontSize: 11, marginTop: 2 }}><b>{isDesktop ? 'Clic' : 'Toca'}</b> para ver el detalle</div>
    </div>
  }

  // Fila clicable operable con teclado (Enter o espacio): lo que abre con el clic se abre igual con el teclado.
  const act = (fn, rol = 'button') => ({ onClick: fn, tabIndex: 0, ...(rol ? { role: rol } : {}), onKeyDown: e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fn(e) } } })
  const chip = (on, label, onClick, dot, off) => <button key={label} onClick={onClick} aria-pressed={on} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${on && !dot ? C.accent : C.border}`, background: on && !dot ? C.selBg : C.surface, color: on && !dot ? C.accent : C.muted, borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: off ? .45 : 1, textDecoration: off ? 'line-through' : 'none' }}>{dot && <i style={{ width: 9, height: 9, borderRadius: 3, background: dot, display: 'inline-block' }} />}{label}</button>
  const seg = (v, set, opts) => <div style={{ display: 'inline-flex', border: `1px solid ${C.border}`, background: C.surface, borderRadius: 10, overflow: 'hidden' }}>{opts.map(([k, l]) => <button key={String(k)} onClick={() => set(k)} style={{ border: 0, padding: isDesktop ? '7px 12px' : '7px 9px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: v === k ? C.accent : 'transparent', color: v === k ? C.surface : C.muted }}>{l}</button>)}</div>
  const btn = (label, onClick, ic) => <button onClick={onClick} aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${C.border}`, background: C.surface, borderRadius: 10, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, color: C.accent, cursor: 'pointer' }}>{ic && <SIcon n={ic} s={13} c={C.accent} />}{ic && !isDesktop ? null : label}</button>
  const kLbl = { fontSize: isDesktop ? 10.5 : 10, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', color: C.accent }

  // ── KPIs (cada uno abre su lista)
  const kpi = (tint, icon, lab, val, sub, on) => <button key={lab} onClick={on} className='pv-c' style={{ display: 'flex', gap: 9, alignItems: 'flex-start', textAlign: 'left', border: `1px solid ${C.tileLine}`, background: C.tileBg, borderRadius: 12, padding: isDesktop ? '12px 14px' : '10px 11px', minWidth: 0, cursor: 'pointer' }}>
    <span style={{ width: 26, height: 26, borderRadius: 8, background: tint.bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}><SIcon n={icon} s={14} c={tint.fg} /></span>
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={kLbl}>{lab}</span><span style={{ fontSize: isDesktop ? 22 : 18, fontWeight: 800, letterSpacing: -.6, color: tint.fg, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{val}</span><span style={{ fontSize: 11.5, color: C.textSoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span></span></button>
  const irSemana = i => { setGran('sem'); setTimeout(() => { setSel(i); setTipo(null); setTimeout(() => { try { detRef.current && detRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) } catch (_) {} }, 60) }, 30) }

  // ── Detalle de la barra elegida
  const x = sel != null ? grupos[sel] : null
  const detalle = (() => {
    if (!x) return <div style={{ padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}><b style={{ color: C.accent, fontSize: 15 }}>Detalle</b><span style={{ fontSize: 12, color: C.textSoft }}>Toca una barra para ver sus cobros: cliente, factura o cuota, fecha esperada y monto.</span></div>
    const todos = x.items.slice().sort((a, b) => b.m - a.m), inc = todos.filter(c => !c.excl), ex = todos.filter(c => c.excl)
    const por = {}; inc.forEach(c => { por[c.k] = (por[c.k] || 0) + c.m })
    const lista = tipo ? inc.filter(c => c.k === tipo) : inc
    const fila = (c, i, apagada) => <div key={i} {...act(() => onOpenFactura && c.b && onOpenFactura(c.b))} style={{ display: 'grid', gridTemplateColumns: '12px minmax(0,1fr) auto', gap: 10, alignItems: 'center', padding: '9px 16px', borderTop: `1px solid ${C.bgSoft}`, cursor: onOpenFactura ? 'pointer' : 'default', opacity: apagada ? .55 : 1 }}>
      <i style={{ width: 9, height: 9, borderRadius: 3, background: SER[c.k][1] }} />
      <span style={{ minWidth: 0 }}><span onClick={e => { e.stopPropagation(); onOpenClientFicha && c.cid && onOpenClientFicha(c.cid) }} style={{ fontWeight: 700, color: C.accent, overflowWrap: 'anywhere', cursor: 'pointer' }}>{nom(c.cid)}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: C.textSoft }}>{c.txt} · esperado {fmtFechaDMY(c.t)}{c.est ? ' · plazo estimado' : ''}{c.mor ? ' · cliente moroso' : ''}</span></span>
      <b style={{ color: C.text, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{pesos(c.m)}</b></div>
    return <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '14px 16px 8px' }}><b style={{ fontSize: 15, color: C.accent }}>{x.tit}</b><span style={{ fontSize: 12, color: C.textSoft }}>{x.sub}</span><span style={{ flex: 1 }} />{btn('Cerrar', () => setSel(null))}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 16px 10px' }}>{Object.keys(SER).filter(k => por[k]).map(k => chip(tipo === k, `${SER[k][0]} · ${fM(por[k])}`, () => setTipo(t => t === k ? null : k), SER[k][1]))}{tipo && chip(false, 'Ver todo', () => setTipo(null))}</div>
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>{lista.length ? lista.map((c, i) => fila(c, i)) : <div style={{ padding: '10px 16px', fontSize: 13, color: C.muted }}>Sin cobros esperados en este período.</div>}
        {ex.length > 0 && <>{<div style={{ padding: '9px 16px', background: C.soonBg, color: C.soonText, fontSize: 12.5, fontWeight: 700 }}>{ex.length} cobro{ex.length !== 1 ? 's' : ''} excluido{ex.length !== 1 ? 's' : ''} por clientes con facturas morosas · {fM(ex.reduce((a, c) => a + c.m, 0))}</div>}{ex.map((c, i) => fila(c, 'x' + i, true))}</>}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 16px', borderTop: `1.5px solid ${C.accent}`, background: C.bgSoft, fontWeight: 800, color: C.accent, borderRadius: '0 0 14px 14px' }}><span>Ingresos del período</span><span>{pesos(inc.reduce((a, c) => a + c.m, 0))}</span></div></div>
  })()

  // ── Pestañas
  const th = { position: 'sticky', top: 0, zIndex: 1, background: C.bgSoft, color: C.accent, fontSize: isDesktop ? 10 : 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: isDesktop ? .5 : 0, padding: isDesktop ? '9px 10px' : '9px 4px', textAlign: 'right', whiteSpace: 'nowrap' }
  const td = { padding: isDesktop ? '9px 10px' : '9px 4px', textAlign: 'right', borderTop: `1px solid ${C.bgSoft}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: isDesktop ? 12.5 : 12 }
  const dim = <span style={{ color: C.done }}>—</span>
  const lista = F.clientes.filter(c => fil === 'todos' || (fil === 'ent' && c.entra) || (fil === 'mor' && c.duda) || (fil === 'pf' && c.sin)).filter(c => !q || nom(c.cid).toLowerCase().includes(q.toLowerCase()))
  const { filas: ord, th: thO } = useOrden(lista, { Cliente: c => nom(c.cid), Cobranza: c => c.entra, Comisiones: c => c.com, Morosa: c => c.duda, 'Por facturar': c => c.sin })
  const descargar = async () => { try {
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const head = ['Cliente', 'Plazo de pago (días)', 'Facturas pagadas usadas', 'Cobranza proyectada 8 sem.', 'Comisiones proyectadas 8 sem.', 'Flujo neto', 'Cartera morosa', 'Cuotas vencidas sin facturar', 'Comisiones sujetas a ese cobro', 'Facturas vencidas']
      const data = F.clientes.map(c => [nom(c.cid), c.ritmo, c.hist, Math.round(c.entra), Math.round(c.com), Math.round(c.entra - c.com), Math.round(c.duda), Math.round(c.sin), Math.round(c.comFuera), c.nVenc])
      const semanas = [['Semana del', 'Cobranza', 'Gastos de operación', 'Comisiones', 'Saldo acumulado'], ...F.weeks.map(w => [fmtFechaDMY(w.ini), Math.round(w.entra), Math.round(w.of), Math.round(w.com), Math.round(w.run)])]
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...data]), 'Por cliente'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(semanas), 'Por semana')
      XLSX.writeFile(wb, `Flujo_de_caja_${isoLocal(Date.now())}.xlsx`)
    } catch (e) { appAlert('No se pudo generar el Excel: ' + (e.message || e)) } }

  const tabla = <div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
      {[['todos', 'Todos'], ['ent', 'Con cobros'], ['mor', 'Morosa'], ['pf', 'Por facturar']].map(([k, l]) => chip(fil === k, l, () => setFil(k)))}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder='Buscar cliente…' aria-label='Buscar cliente' style={{ flex: 1, minWidth: 150, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', background: C.surface, color: C.text, font: 'inherit' }} />
      </div>
    <div style={{ overflow: 'auto', maxHeight: 340, border: `1px solid ${C.border}`, borderRadius: 12 }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>{thO('Cliente', { ...th, textAlign: 'left' })}{thO('Cobranza', th)}{thO('Comisiones', th)}{thO('Morosa', th)}{isDesktop && thO('Por facturar', th)}</tr></thead>
      <tbody>{ord.map(c => <tr key={c.cid} {...act(() => c.cid && onOpenClientFicha && onOpenClientFicha(c.cid), null)} onMouseEnter={() => setRes(c.cid)} onMouseLeave={() => setRes(null)} style={{ cursor: c.cid ? 'pointer' : 'default' }}>
        <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: isDesktop ? 140 : 100 }}><span style={{ fontWeight: 700, color: C.accent }}>{nom(c.cid)}</span><span style={{ display: 'block', fontSize: 11, color: C.textSoft }}>plazo de pago {c.ritmo} días{c.hist >= 3 ? '' : ' (estimado)'}{c.nVenc > 0 ? ` · ${c.nVenc} vencida${c.nVenc !== 1 ? 's' : ''}` : ''}{!conMor && c.duda > 0 ? ' · excluida' : ''}</span></td>
        <td style={td}>{c.entra ? <span style={{ color: C.greenText }}>+{fM(c.entra)}</span> : dim}</td>
        <td style={td}>{c.com ? <span style={{ color: C.overdueText }}>−{fM(c.com)}</span> : dim}{c.comFuera > 0 && <span style={{ display: 'block', fontSize: 11, color: C.textSoft }}>{fM(c.comFuera)} sujetas</span>}</td>
        <td style={td}>{c.duda ? <span style={{ color: C.overdueText }}>{fM(c.duda)}</span> : dim}</td>
        {isDesktop && <td style={td}>{c.sin ? <span style={{ color: C.overdueText }}>{fM(c.sin)}</span> : dim}</td>}</tr>)}</tbody>
      <tfoot><tr><td style={{ ...td, textAlign: 'left', fontWeight: 800 }}>Total {lista.length} cliente{lista.length !== 1 ? 's' : ''}</td><td style={{ ...td, fontWeight: 800, color: C.greenText }}>+{fM(lista.reduce((a, c) => a + c.entra, 0))}</td><td style={{ ...td, fontWeight: 800, color: C.overdueText }}>−{fM(lista.reduce((a, c) => a + c.com, 0))}</td><td style={{ ...td, fontWeight: 800, color: C.overdueText }}>{fM(lista.reduce((a, c) => a + c.duda, 0))}</td>{isDesktop && <td style={{ ...td, fontWeight: 800, color: C.overdueText }}>{fM(lista.reduce((a, c) => a + c.sin, 0))}</td>}</tr></tfoot></table></div>
    <div style={{ fontSize: 11, color: C.textSoft, marginTop: 6 }}>Plazo estimado = menos de 3 facturas pagadas · {F.ritmoEstudio} días en el estudio</div></div>

  const tablaSem = <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 12 }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead><tr><th style={{ ...th, textAlign: 'left' }}>Semana</th><th style={th}>+ Cobranza</th>{isDesktop && <th style={th}>− Operación</th>}{isDesktop && <th style={th}>− Comisiones</th>}{!isDesktop && <th style={th}>− Egresos</th>}<th style={th}>= Saldo</th></tr></thead>
    <tbody>{F.weeks.map((w, i) => <tr key={i} {...act(() => irSemana(i), null)} onMouseEnter={() => sem && setHov(i)} onMouseLeave={() => setHov(null)} style={{ cursor: 'pointer' }}>
      <td style={{ ...td, textAlign: 'left', color: C.muted }}>{fmtFechaDMY(w.ini)}</td><td style={td}><span style={{ color: C.greenText }}>{fM(w.entra)}</span></td>
      {isDesktop && <td style={td}><span style={{ color: C.overdueText }}>{fM(-w.of)}</span></td>}{isDesktop && <td style={td}>{w.com > 1000 ? <span style={{ color: C.overdueText }}>{fM(-w.com)}</span> : dim}</td>}{!isDesktop && <td style={td}><span style={{ color: C.overdueText }}>{fM(-(w.of + w.com))}</span></td>}
      <td style={{ ...td, fontWeight: 800, color: w.run < 0 ? C.overdueText : C.text }}>{fM(w.run)}</td></tr>)}</tbody></table></div>

  // «No está incluido»: lo que el flujo deja fuera, por cliente; cada fila abre la ficha y el grupo lleva a Por facturar.
  const excl = (() => {
    const mor = F.clientes.filter(c => c.duda > 0).map(c => ({ cid: c.cid, m: c.duda + (conMor ? 0 : cobros.filter(k => k.excl && k.cid === c.cid).reduce((a, k) => a + k.m, 0)), d: `${c.nMor} factura${c.nMor !== 1 ? 's' : ''} morosa${c.nMor !== 1 ? 's' : ''}` })).sort((a, b) => b.m - a.m)
    const ven = F.clientes.filter(c => c.sin > 0).map(c => ({ cid: c.cid, m: c.sin, d: 'cuotas vencidas sin facturar' })).sort((a, b) => b.m - a.m)
    const G = [['mor', 'Clientes con facturas morosas', conMor ? 'las facturas morosas no se proyectan' : 'sus cobros no se proyectan', mor, null], ['ven', 'Cuotas vencidas sin facturar', 'al emitirlas entran a la proyección', ven, 'vencida']]
    return G.map(([k, tit, sub, rows, partida]) => <div key={k} style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.bgSoft, padding: '11px 14px' }}><b style={{ color: C.accent }}>{tit}</b><span style={{ flex: 1, fontSize: 12, color: C.textSoft }}>{rows.length} · {sub}</span><b style={{ color: C.accent }}>{fM(rows.reduce((a, r) => a + r.m, 0))}</b>{partida && onOpenPorFacturar && btn('Por facturar', () => onOpenPorFacturar(partida))}</div>
      {rows.length ? rows.map(r => <div key={r.cid} {...act(() => r.cid && onOpenClientFicha && onOpenClientFicha(r.cid))} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, padding: '9px 14px', borderTop: `1px solid ${C.bgSoft}`, cursor: 'pointer' }}><span><b style={{ color: C.accent }}>{nom(r.cid)}</b><span style={{ display: 'block', fontSize: 11.5, color: C.textSoft }}>{r.d}</span></span><b style={{ color: C.text, whiteSpace: 'nowrap' }}>{fM(r.m)}</b></div>) : <div style={{ padding: '10px 14px', fontSize: 12.5, color: C.muted }}>Sin partidas por este motivo.</div>}</div>)
  })()

  const ctrl = <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
    <div style={{ padding: '9px 14px', background: C.bgSoft, borderBottom: `1px solid ${C.border}`, ...kLbl }}>Proyectado y cobrado · por semana</div>
    {control.filas.length === 0 ? <div style={{ padding: '10px 14px', fontSize: 12.5, color: C.muted }}>Se guarda cada semana y se compara con lo cobrado al cerrarla.</div>
      : <div>{control.filas.map(f => <div key={f.ini} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto auto', columnGap: 12, alignItems: 'baseline', padding: '8px 14px', borderTop: `1px solid ${C.bgSoft}`, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: C.accent, fontWeight: 700, whiteSpace: 'nowrap' }}>{isDesktop ? 'Semana del ' : ''}{fmtFechaDMY(f.ini)}</span><span style={{ color: C.muted }}>proyectado {fM(f.proyectado)}</span><span style={{ color: C.text, fontWeight: 600 }}>cobrado {fM(f.cobrado)}</span>
          <span style={{ fontWeight: 800, minWidth: 44, textAlign: 'right', color: f.pct == null ? C.muted : f.pct >= 0 ? C.greenText : C.overdueText }}>{f.pct == null ? '—' : `${f.pct > 0 ? '+' : ''}${Math.round(f.pct * 100)} %`}</span></div>)}
        <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.muted }}>Diferencia de las últimas {control.filas.length} semanas: <b style={{ color: C.accent }}>{control.error == null ? '—' : `${control.error > 0 ? '+' : ''}${Math.round(control.error * 100)} %`}</b> · cobrado propio por fecha del depósito, sin subarriendo ni reembolsos; lo proyectado incluye subarriendo</div></div>}</div>

  const TABS = [['cli', 'Por cliente'], ['sem', 'Semana a semana'], ['excl', 'Excluidas'], ['ctrl', 'Control de la proyección']]
  const exclTot = F.exclMor.monto + F.duda.monto + F.sinEmitir.monto

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      {seg(conMor ? 'todo' : 'cons', v => setConMor(v === 'todo'), [['cons', 'Sin morosos'], ['todo', 'Con morosos']])}
      {seg(gran, setGran, [['sem', '8 semanas'], ['mes', 'Meses']])}
      {seg(vista, setVista, VISTAS)}
      <span style={{ flex: 1 }} />{btn('Excel', descargar, 'download')}</div>
    <div style={{ fontSize: 12, color: C.textSoft, marginTop: -4 }}>{conMor ? 'Incluye los demás cobros de los clientes con facturas morosas; las facturas morosas no se proyectan.' : `Sin los cobros de los ${morosoDe.size} clientes con facturas morosas.`}{gran === 'mes' ? ' Los egresos se proyectan a 8 semanas.' : ''}</div>
    <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(4,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))', gap: 8 }}>
      {kpi({ fg: C.greenText, bg: C.greenBg }, 'tEntra', 'Ingresos', fM(ing8), '8 semanas', () => { setTab('cli'); setFil('ent'); irA(tabsRef) })}
      {kpi({ fg: C.overdueText, bg: C.overdueBg }, 'tPagar', 'Egresos', egr8 ? '−' + fM(egr8) : '$0', '8 semanas', () => onOpenCostos ? onOpenCostos(F.costoReal) : (setTab('sem'), irA(tabsRef)))}
      {kpi(F.fin >= 0 ? { fg: C.greenText, bg: C.greenBg } : { fg: C.overdueText, bg: C.overdueBg }, 'exchange', 'Flujo neto', (F.fin >= 0 ? '+' : '') + fM(F.fin), '8 semanas', () => { setTab('sem'); irA(tabsRef) })}
      {kpi(minSaldo.s < 0 ? { fg: C.soonText, bg: C.soonBg } : { fg: C.accent, bg: C.azulBg }, 'wallet', 'Saldo mínimo', fM(minSaldo.s === Infinity ? 0 : minSaldo.s), minSaldo.w ? fmtFechaDMY(minSaldo.w.ini) : '', () => { if (minSaldo.w) irSemana(F.weeks.indexOf(minSaldo.w)) })}</div>
    {F.sinCuota.length > 0 && <div style={{ borderRadius: 10, padding: '9px 12px', background: C.soonBg, color: C.soonText, fontSize: 12.5, fontWeight: 700 }}>Comisión sin cuota · {F.sinCuota.length} · {[...new Set(F.sinCuota.map(x => x.prov))].slice(0, 2).join(', ')} · {fM(F.sinCuotaTot)}</div>}
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '14px 16px 4px' }}><span style={kLbl}>{vista === 'cascada' ? (sem ? 'Variación del saldo por semana' : 'Ingresos acumulados por mes') : sem ? 'Ingresos y egresos por semana' : 'Ingresos esperados por mes'}</span><span style={{ flex: 1 }} />
        {vista !== 'cascada' && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[...Object.keys(SER).map(k => [k, SER[k][0], SER[k][1]]), ...(sem ? [...Object.keys(EGR).map(k => [k, EGR[k][0], EGR[k][1]]), ['saldo', 'Saldo acumulado', C.text]] : [])].map(([k, l, c]) => chip(!!vis[k], l, () => setVis(v => ({ ...v, [k]: v[k] ? 0 : 1 })), c, !vis[k]))}</div>}</div>
      <div ref={wrapRef} style={{ position: 'relative', padding: '4px 8px 6px' }}>
        {n === 0 && <div style={{ padding: '40px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>Sin cobros esperados en el período.</div>}
        <svg viewBox={`0 0 ${W || 300} ${H}`} style={{ display: 'block', width: '100%', height: H, overflow: 'visible' }} role='img' aria-label={`Gráfico de ${VISTAS.find(v => v[0] === vista)[1].toLowerCase()}: ${sem ? 'ingresos y egresos por semana' : 'ingresos esperados por mes'}`}>{barras()}</svg>
        {tip()}</div></div>
    <div ref={detRef} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, scrollMarginTop: 70 }}>{detalle}</div>
    <div ref={tabsRef} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, scrollMarginTop: 70, minWidth: 0 }}>
      <div role='tablist' style={{ display: 'flex', gap: 4, padding: '10px 12px 0', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>{TABS.map(([k, l]) => <button key={k} role='tab' aria-selected={tab === k} onClick={() => setTab(k)} style={{ border: 0, background: 'transparent', padding: '9px 12px', fontSize: 13, fontWeight: 700, color: tab === k ? C.accent : C.muted, borderBottom: `2.5px solid ${tab === k ? C.accent : 'transparent'}`, whiteSpace: 'nowrap', cursor: 'pointer' }}>{l}{k === 'excl' && exclTot > 0 ? ` · ${fM(exclTot)}` : ''}</button>)}</div>
      <div style={{ padding: '12px 14px 14px' }}>{tab === 'cli' ? tabla : tab === 'sem' ? tablaSem : tab === 'excl' ? excl : ctrl}</div></div>
  </div>
}
