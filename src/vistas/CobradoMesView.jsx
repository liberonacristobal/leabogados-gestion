// Cobrado en un mes: los depósitos conciliados a facturas y anticipos, por cliente y por fecha del depósito. No calcula nada propio: lee las mismas partidas
// del hook del resultado del año (lib/resultadoAnio.js, el mismo del Inicio y del Panel de socios), de modo que el total es el «Cobrado» del mes del Panel.
import { useMemo, useState } from 'react'
import { C, Gl, SIcon, fmt, fmtFechaDMY, folioN, useIsDesktop } from '../lib/base.jsx'
import { PageHeader, currentYear, fmtShort } from '../lib/compartido.jsx'
import { useResultadoAnio } from '../lib/resultadoAnio.js'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const ymMas = (ym, d) => { const dt = new Date(Number(ym.slice(0,4)), Number(ym.slice(5,7)) - 1 + d, 1); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}` }
const ymHoy = () => new Date().toISOString().slice(0,7)

export function CobradoMesView({ ymInicial, sales=[], billing=[], clients=[], terceros=[], costosOfiRows=[], expenses=[], anticipos=[], origen='Inicio', onBack, onOpenClientFicha, onOpenMovimiento }) {
  const isDesktop = useIsDesktop()
  const [ym, setYm] = useState(ymInicial || ymMas(ymHoy(), -1))
  const [abiertos, setAbiertos] = useState(() => new Set())
  const R = useResultadoAnio({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos, selYear: Number(ym.slice(0,4)) })
  const ing = R.ingresosPorAnioVenta
  const cn = id => (clients||[]).find(c => String(c.id) === String(id))?.name || 'Sin cliente'
  // Partidas del mes: todas las de cobrado propio del año (por año de venta y sin año) cuyo depósito cae en el mes.
  const items = useMemo(() => [...Object.values(ing.listByYear||{}).flat(), ...(ing.sinList||[])].filter(it => String(it.paid_at||'').startsWith(ym)), [ing, ym])
  const grupos = useMemo(() => { const g = new Map(); items.forEach(it => { const k = String(it.client_id||'sin'); if (!g.has(k)) g.set(k, { cid: it.client_id, items: [], total: 0 }); const x = g.get(k); x.items.push(it); x.total += Number(it._cobrado)||0 })
    return [...g.values()].map(x => ({ ...x, items: x.items.sort((a,b) => String(b.paid_at||'').localeCompare(String(a.paid_at||''))) })).sort((a,b) => b.total - a.total) }, [items])
  const total = grupos.reduce((a,g) => a + g.total, 0)
  const mesLbl = `${MESES[Number(ym.slice(5,7))-1]} ${ym.slice(0,4)}`
  const esActual = ym === ymHoy(), esPrimero = ym <= `${currentYear - 1}-01`
  const mover = d => { const n = ymMas(ym, d); if (n <= ymHoy() && n >= `${currentYear - 1}-01`) { setYm(n); setAbiertos(new Set()) } }
  const tog = k => setAbiertos(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const idMov = it => String(it.id||'').split('-')[1]   // 'cf-<movimiento>-<factura>' | 'ca-<movimiento>-<anticipo>'
  const btnMes = (d, off, ic) => <span key={d} onClick={off ? undefined : () => mover(d)} title={d < 0 ? 'Mes anterior' : 'Mes siguiente'} style={{ width:32, height:32, display:'inline-flex', alignItems:'center', justifyContent:'center', border:`1px solid ${C.border}`, borderRadius:8, background:C.surface, color:C.accent, opacity:off?.35:1, cursor:off?'default':'pointer' }}><Gl n={ic}/></span>
  return (
    <div>
      <PageHeader origen={origen} onBack={onBack} titulo={`Cobrado en ${MESES[Number(ym.slice(5,7))-1].toLowerCase()}`} ctx='por fecha del depósito' right={<div style={{ display:'flex', alignItems:'center', gap:4 }}>{!esActual && <span onClick={() => { setYm(ymMas(ymHoy(), -1)); setAbiertos(new Set()) }} style={{ fontSize:11, fontWeight:700, color:C.azulInfo, cursor:'pointer', marginRight:4, whiteSpace:'nowrap' }}>{isDesktop ? 'Mes pasado' : 'Pasado'}</span>}{btnMes(-1, esPrimero, 'chevL')}{btnMes(1, esActual, 'chevron')}</div>}/>
      <div style={{ maxWidth: isDesktop ? 900 : 760, margin:'0 auto', padding:'14px 16px 80px', display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:10 }}>
          <div style={{ background:C.greenBg, border:`1px solid ${C.greenDeep}`, borderRadius:12, padding:isDesktop?'14px':'12px 10px', display:'flex', gap:12, alignItems:'center', minWidth:0 }}>
            <span style={{ width:isDesktop?34:30, height:isDesktop?34:30, borderRadius:8, background:'#fff', color:C.greenText, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><SIcon n='wallet' s={17} c={C.greenText}/></span>
            <div style={{ minWidth:0 }}><div style={{ fontSize:isDesktop?11:10, fontWeight:700, letterSpacing:.5, textTransform:'uppercase', color:C.accent }}>Cobrado · {mesLbl}</div><div style={{ fontSize:isDesktop?26:20, fontWeight:800, letterSpacing:'-.6px', lineHeight:1.05, color:C.accent, marginTop:3, fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>{fmt(total)}</div></div>
          </div>
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:isDesktop?'14px':'12px 10px', display:'flex', gap:12, alignItems:'center', minWidth:0 }}>
            <span style={{ width:isDesktop?34:30, height:isDesktop?34:30, borderRadius:8, background:C.bgSoft, color:C.accent, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><SIcon n='users' s={17} c={C.accent}/></span>
            <div style={{ minWidth:0 }}><div style={{ fontSize:isDesktop?11:10, fontWeight:700, letterSpacing:.5, textTransform:'uppercase', color:C.accent }}>Clientes</div><div style={{ fontSize:isDesktop?26:20, fontWeight:800, letterSpacing:'-.6px', lineHeight:1.05, color:C.accent, marginTop:3 }}>{grupos.length}</div><div style={{ fontSize:11, color:C.muted }}>{items.length} depósito{items.length!==1?'s':''}</div></div>
          </div>
        </div>
        {grupos.length === 0
          ? <div style={{ textAlign:'center', color:C.muted, fontSize:13, padding:'34px 0', background:C.surface, border:`1px solid ${C.border}`, borderRadius:12 }}>Sin depósitos conciliados en {mesLbl.toLowerCase()}.</div>
          : <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'11px 14px 7px', fontSize:10, fontWeight:700, letterSpacing:.5, textTransform:'uppercase', color:C.accent }}>Depósitos conciliados · {mesLbl}</div>
              {grupos.map((g, i) => { const k = String(g.cid||'sin'), open = abiertos.has(k); return (<div key={k}>
                <div onClick={() => tog(k)} style={{ display:'grid', gridTemplateColumns:'16px minmax(0,1fr) auto 10px', columnGap:8, alignItems:'center', padding:'10px 14px', borderTop:`1px solid ${C.border}`, cursor:'pointer' }}>
                  <span style={{ textAlign:'center', fontWeight:700, color:C.muted }}>{i ? '+' : ''}</span>
                  <span style={{ minWidth:0 }}><span onClick={g.cid && onOpenClientFicha ? e => { e.stopPropagation(); onOpenClientFicha(g.cid) } : undefined} style={{ fontSize:14, fontWeight:700, color:C.accent, cursor:g.cid&&onOpenClientFicha?'pointer':'default', overflowWrap:'anywhere' }}>{cn(g.cid)}</span><span style={{ fontSize:11, color:C.muted, marginLeft:8 }}>{g.items.length} depósito{g.items.length!==1?'s':''}</span></span>
                  <span style={{ fontSize:14, fontWeight:800, color:C.accent, fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>{fmt(g.total)}</span>
                  <span style={{ color:C.done, display:'flex' }}><SIcon n={open?'chevU':'chevD'} s={11} c={C.done}/></span>
                </div>
                {open && g.items.map(it => <div key={it.id} onClick={onOpenMovimiento ? () => onOpenMovimiento(idMov(it)) : undefined} style={{ display:'grid', gridTemplateColumns:'86px minmax(0,1fr) auto 10px', columnGap:8, alignItems:'center', padding:'7px 14px 7px 28px', background:C.bgSoft, borderTop:`1px solid ${C.border}`, fontSize:12, cursor:onOpenMovimiento?'pointer':'default' }}>
                  <span style={{ fontWeight:700, color:C.accent, whiteSpace:'nowrap', fontSize:11.5 }}>{fmtFechaDMY(it.paid_at)}</span>
                  <span style={{ minWidth:0, color:C.text, overflowWrap:'anywhere' }}>{it._esAnticipo ? 'Anticipo' : `Factura N° ${folioN(it.folio||it.invoice_no)||'—'}`}{it.concept&&!it._esAnticipo?<span style={{ color:C.muted }}> · {it.concept}</span>:null}</span>
                  <span style={{ fontWeight:700, color:C.text, fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>{fmt(Number(it._cobrado)||0)}</span>
                  <span style={{ color:C.done, display:'flex' }}>{onOpenMovimiento&&<SIcon n='chevron' s={10} c={C.done}/>}</span>
                </div>)}
              </div>) })}
              <div style={{ display:'grid', gridTemplateColumns:'16px minmax(0,1fr) auto 10px', columnGap:8, alignItems:'center', padding:'10px 14px', borderTop:`1.5px solid ${C.accent}`, background:C.bgSoft }}>
                <span style={{ textAlign:'center', fontWeight:700, color:C.accent }}>=</span><span style={{ fontSize:13, fontWeight:800, color:C.accent }}>Cobrado en {MESES[Number(ym.slice(5,7))-1].toLowerCase()}</span><span style={{ fontSize:14, fontWeight:800, color:C.accent, fontVariantNumeric:'tabular-nums' }}>{fmt(total)}</span><span/>
              </div>
            </div>}
        <div style={{ fontSize:12, color:C.textSoft }}>Cobrado propio por fecha del depósito, el mismo del Panel de socios ({fmtShort(total)}). Cada depósito abre su movimiento en el banco.</div>
      </div>
    </div>)
}
