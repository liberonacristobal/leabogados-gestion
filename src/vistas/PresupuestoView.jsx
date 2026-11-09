// Presupuesto anual (año siguiente) — se trabaja por etapas y se guarda solo: borrador automático + versiones con nombre (una «oficial»).
// Etapas: 1 Mirada al año en curso (metas), 2 Base, 3 Costos, 4 Escenarios (resultado, impuesto y por socio), 5 Seguimiento.
// Reglas puras en supabase/functions/_shared/presupuesto.js; datos de partida en lib/presupuestoDatos.js (cada cifra de su fuente única).
import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, useIsDesktop } from '../lib/base.jsx'
import { PageHeader } from '../lib/compartido.jsx'
import { usePresupuestoDatos } from '../lib/presupuestoDatos.js'
import { ESCENARIOS, estadoInicial, modeloPresupuesto, resumenModelo, migrarEstado } from '../../supabase/functions/_shared/presupuesto.js'
import { mm, ufs, pc, Kpi, Seg, Btn, Fld, Grid, Titulo } from '../lib/presupuestoUI.jsx'
import { Mirada, Base, Costos } from './presupuestoEtapas1.jsx'
import { Escenarios, Seguimiento, vistaDrill, titulosDrill } from './presupuestoEtapas2.jsx'

const scrollEl = () => (typeof document !== 'undefined' ? document.getElementById('main-scroll') : null)
const getY = () => { const e = scrollEl(); return e ? e.scrollTop : window.scrollY }
const setY = (y) => { const e = scrollEl(); if (e) e.scrollTop = y; else window.scrollTo(0, y) }
const hace = (t) => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'hace instantes' : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h` }
const filaAVersion = (r) => ({ id: r.id, nombre: r.nombre || 'Versión', nota: r.nota || '', estado: migrarEstado(r.estado), resumen: r.resumen || null, oficial: !!r.oficial, created_at: r.created_at, creado_por: r.creado_por || '' })

export function PresupuestoView({ sales = [], billing = [], terceros = [], costosOfiRows = [], expenses = [], clients = [], anticipos = [], user, onBack, backLabel = 'Oficina', onOpenPorFacturar }) {
  const D = useIsDesktop()
  const datos = usePresupuestoDatos({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos })
  const anio = datos.anio
  const [est, setEst] = useState(null)
  const [vers, setVers] = useState([])
  const [cargado, setCargado] = useState(false)
  const [espera, setEspera] = useState(false)
  const [guardado, setGuardado] = useState({ est: 'cargando', t: null })
  const [ui, setUIS] = useState({ etapa: 0, tab: 'res', alt: 'A', vm: 'tarjetas', mas: false, abierta: null, vx: null, confirma: null })
  const [drill, setDrill] = useState(null)
  const [pila, setPila] = useState([])
  const lastJSON = useRef(''), tmr = useRef(null), borradorId = useRef(null), enVuelo = useRef(false), estRef = useRef(null)
  const setUI = (patch) => setUIS((u) => ({ ...u, ...patch }))
  estRef.current = est

  // ── Carga: borrador y versiones del año ──
  useEffect(() => {
    let vivo = true
    setCargado(false); setEst(null); setEspera(false)
    const t = setTimeout(() => { if (vivo) setEspera(true) }, 1500)
    ;(async () => {
      try {
        let borr = null, filas = []
        if (DEMO) {
          const b = localStorage.getItem('ppto_demo_' + anio), v = localStorage.getItem('ppto_demo_v_' + anio)
          borr = b ? { estado: JSON.parse(b) } : null; filas = v ? JSON.parse(v) : []
        } else {
          const { data, error } = await supabase.from('presupuestos').select('*').eq('anio', anio).order('created_at', { ascending: false })
          if (error) throw error
          borr = (data || []).find((r) => r.tipo === 'borrador') || null; filas = (data || []).filter((r) => r.tipo === 'version')
          borradorId.current = borr ? borr.id : null
        }
        if (!vivo) return
        setVers(filas.map(filaAVersion))
        if (borr) { const e = migrarEstado(borr.estado); lastJSON.current = JSON.stringify(e); setEst(e); setGuardado({ est: DEMO ? 'local' : 'ok', t: borr.updated_at ? Date.parse(borr.updated_at) : null }) }
        else setGuardado({ est: DEMO ? 'local' : 'ok', t: null })
        setCargado(true)
      } catch (e) { if (vivo) { setGuardado({ est: 'error', t: null }); setCargado(true) } }
    })()
    return () => { vivo = false; clearTimeout(t) }
  }, [anio])

  // Sin borrador: estado inicial con los costos vigentes y los datos reales del año anterior (cuando ya cargaron, o tras una breve espera).
  useEffect(() => {
    if (!cargado || est || !(datos.terc != null || espera || DEMO)) return
    setEst(estadoInicial({ costos: datos.costos, terc: datos.terc, dias: datos.dias.promedio, ppmMes: datos.ppmMes }))
  }, [cargado, est, datos.terc, espera, datos.costos, datos.dias.promedio, datos.ppmMes])

  // ── Autoguardado del borrador (1,5 s después del último cambio) ──
  const guardarBorrador = async () => {
    const e = estRef.current; if (!e) return
    const j = JSON.stringify(e); if (j === lastJSON.current) return
    if (enVuelo.current) { tmr.current = setTimeout(guardarBorrador, 800); return }
    enVuelo.current = true; setGuardado((g) => ({ ...g, est: 'guardando' }))
    try {
      if (DEMO) localStorage.setItem('ppto_demo_' + anio, j)
      else if (borradorId.current) { const { error } = await supabase.from('presupuestos').update({ estado: e, updated_at: new Date().toISOString() }).eq('id', borradorId.current); if (error) throw error }
      else { const { data, error } = await supabase.from('presupuestos').insert({ anio, tipo: 'borrador', estado: e, creado_por: user?.name || null }).select('id').single(); if (error) throw error; borradorId.current = data.id }
      lastJSON.current = j; setGuardado({ est: DEMO ? 'local' : 'ok', t: Date.now() })
    } catch (err) { setGuardado((g) => ({ ...g, est: 'error' })) } finally { enVuelo.current = false }
  }
  useEffect(() => {
    if (!cargado || !est) return
    if (JSON.stringify(est) === lastJSON.current) return
    setGuardado((g) => (g.est === 'guardando' ? g : { ...g, est: 'pendiente' }))
    clearTimeout(tmr.current); tmr.current = setTimeout(guardarBorrador, 1500)
    return () => clearTimeout(tmr.current)
  }, [est, cargado]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Modelo ──
  const M = useMemo(() => (est ? modeloPresupuesto(datos.base, est) : null), [datos.base, est])
  const U = M ? M.ufMed : 1
  const moneda = est ? est.moneda : 'clp'
  const fm = (v) => (moneda === 'uf' ? ufs(v / U) : moneda === 'ambos' ? <span>{mm(v)}<div style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>{ufs(v / U)}</div></span> : mm(v))
  const fmS = (v) => (moneda === 'uf' ? ufs(v / U) : mm(v))
  const nomEsc = (k) => ESCENARIOS.find((x) => x[0] === k)[1]

  // ── Cambios del estado ──
  const parche = (fn) => setEst((e) => { const c = JSON.parse(JSON.stringify(e)); fn(c); return c })
  const setPal = (k, f, v) => parche((c) => { c.p[k][f] = v })
  const setGen = (f, v) => parche((c) => { c[f] = v })
  const setEsc = (k) => parche((c) => { c.esc = k })
  const setCosto = (i, f, v) => parche((c) => { c.costos[i][f] = v })
  const addCosto = () => { parche((c) => { c.costos.push({ id: Date.now(), n: 'Nueva partida', m: 0, meses: 12, t: 'fijo', alza: null }) }); setUI({ abierta: (est ? est.costos.length : 0) }) }
  const delCosto = (i) => { parche((c) => { c.costos.splice(i, 1) }); setUI({ abierta: null }) }
  const resetCostos = () => { parche((c) => { c.costos = datos.costos.map((x) => ({ ...x })) }); setUI({ abierta: null }) }

  // ── Navegación: ir y volver al lugar exacto ──
  const ir = (dest) => {
    setPila((p) => [...p, { etapa: ui.etapa, tab: ui.tab, drill, y: getY() }])
    if (dest.drill) setDrill(dest.drill); else { setDrill(null); setUIS((u) => ({ ...u, etapa: dest.etapa ?? u.etapa, tab: dest.tab ?? u.tab })) }
    setY(0)
  }
  const volver = () => {
    const p = pila[pila.length - 1]
    if (!p) { onBack && onBack(); return }
    setPila((q) => q.slice(0, -1)); setDrill(p.drill); setUIS((u) => ({ ...u, etapa: p.etapa, tab: p.tab }))
    setTimeout(() => setY(p.y), 0)
  }
  const irDrill = (d) => { setDrill(d); setY(0) }
  const irEscTab = (tab) => ir({ etapa: 3, tab })

  // ── Versiones ──
  const guardarVersion = async (nombre, nota) => {
    const estado = JSON.parse(JSON.stringify(est)), resumen = resumenModelo(M)
    try {
      let fila
      if (DEMO) { fila = { id: 'v' + Date.now(), nombre, nota, estado, resumen, oficial: false, created_at: new Date().toISOString(), creado_por: user?.name || '' }; const nv = [fila, ...vers]; localStorage.setItem('ppto_demo_v_' + anio, JSON.stringify(nv.map((v) => ({ ...v, tipo: 'version' })))) }
      else { const { data, error } = await supabase.from('presupuestos').insert({ anio, tipo: 'version', nombre, nota, estado, resumen, creado_por: user?.name || null }).select('*').single(); if (error) throw error; fila = data }
      setVers((v) => [filaAVersion(fila), ...v]); parche((c) => { c.basadaEn = fila.id }); setUI({ vx: fila.id, confirma: null })
    } catch (e) { setGuardado((g) => ({ ...g, est: 'error' })) }
  }
  const abrirVersion = (v) => { setEst({ ...migrarEstado(v.estado), basadaEn: v.id }); setUI({ confirma: null }) }
  const borrarVersion = async (v) => {
    try {
      if (DEMO) localStorage.setItem('ppto_demo_v_' + anio, JSON.stringify(vers.filter((x) => x.id !== v.id)))
      else { const { error } = await supabase.from('presupuestos').delete().eq('id', v.id); if (error) throw error }
      setVers((l) => l.filter((x) => x.id !== v.id)); if (est.basadaEn === v.id) parche((c) => { c.basadaEn = null }); setUI({ vx: null, confirma: null })
    } catch (e) { setGuardado((g) => ({ ...g, est: 'error' })) }
  }
  const marcarOficial = async (v) => {
    try {
      if (!DEMO) {
        if (v.oficial) { const { error } = await supabase.from('presupuestos').update({ oficial: false }).eq('id', v.id); if (error) throw error }
        else { await supabase.from('presupuestos').update({ oficial: false }).eq('anio', anio).eq('oficial', true); const { error } = await supabase.from('presupuestos').update({ oficial: true }).eq('id', v.id); if (error) throw error }
      }
      setVers((l) => l.map((x) => ({ ...x, oficial: x.id === v.id ? !v.oficial : false })))
    } catch (e) { setGuardado((g) => ({ ...g, est: 'error' })) }
  }

  const X = { D, datos, est, M, U, ui, setUI, ir, irDrill, volver, fm, fmS, nomEsc, ESC: ESCENARIOS, setPal, setGen, setEsc, setCosto, addCosto, delCosto, resetCostos, vers, guardarVersion, abrirVersion, borrarVersion, marcarOficial,
    irEscTab, irEsc: irEscTab, irCostos: () => ir({ etapa: 2 }), irBase: () => ir({ etapa: 1 }), irMirada: () => ir({ etapa: 0 }), irPorFacturar: onOpenPorFacturar }

  const ETAPAS = [`Resultado ${datos.anioBase}`, `Base ${anio}`, 'Costos', 'Escenarios', 'Seguimiento']
  const origen = pila.length ? (pila[pila.length - 1].drill ? titulosDrill(X, pila[pila.length - 1].drill) : ETAPAS[pila[pila.length - 1].etapa]) : backLabel
  const estadoTxt = guardado.est === 'cargando' ? 'cargando…' : guardado.est === 'pendiente' ? 'cambios sin guardar' : guardado.est === 'guardando' ? 'guardando…' : guardado.est === 'error' ? 'no se pudo guardar' : (guardado.est === 'local' ? 'guardado solo en este equipo' : 'guardado') + (guardado.t ? ' · ' + hace(guardado.t) : '')
  const wrap = D ? { maxWidth: 1180, margin: '0 auto', padding: '12px 20px 40px' } : { padding: '8px 16px 40px' }

  if (!est || !M) return <div style={wrap}><PageHeader origen={backLabel} onBack={onBack} titulo={`Presupuesto ${anio}`} style={{ margin: D ? '-12px -20px 12px' : '-8px -16px 12px' }} /><div style={{ padding: 24, fontSize: 13, color: C.muted }}>Cargando el presupuesto…</div></div>

  const e = M.esc[est.esc], h = est.hecho.includes(ui.etapa)
  const cuerpo = drill ? vistaDrill(X, drill)
    : ui.etapa === 0 ? <Mirada X={X} /> : ui.etapa === 1 ? <Base X={X} /> : ui.etapa === 2 ? <Costos X={X} /> : ui.etapa === 3 ? <Escenarios X={X} /> : <Seguimiento X={X} />
  const irEtapa = (i) => { setDrill(null); setUI({ etapa: i }); setY(0) }
  const chipEstado = <button onClick={() => ir({ drill: { t: 'ver' } })} style={{ border: `1px solid ${guardado.est === 'error' ? C.overdueBd : C.border}`, background: guardado.est === 'error' ? C.overdueBg : C.card, color: guardado.est === 'error' ? C.overdueText : C.accent, fontFamily: 'inherit', fontWeight: 700, fontSize: 12.5, padding: '7px 14px', borderRadius: 20, cursor: 'pointer' }}>Versiones · {estadoTxt}</button>

  return <div style={{ ...wrap, display: 'flex', flexDirection: 'column', gap: 14, boxSizing: 'border-box' }}>
    <PageHeader origen={origen} onBack={volver} titulo={drill ? titulosDrill(X, drill) : `Presupuesto ${anio}`} right={D ? chipEstado : null} style={{ margin: D ? '-12px -20px 0' : '-8px -16px 0' }} />
    {!D && <div>{chipEstado}</div>}
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      {!drill && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{ETAPAS.map((t, i) => <button key={t} onClick={() => irEtapa(i)} style={{ border: `1px solid ${ui.etapa === i ? C.azulBg : C.border}`, background: ui.etapa === i ? C.azulBg : C.card, color: ui.etapa === i ? C.accent : C.muted, fontFamily: 'inherit', fontSize: 12.5, fontWeight: ui.etapa === i ? 800 : 600, padding: '7px 12px', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap' }}>{est.hecho.includes(i) ? '✓ ' : ''}{i + 1} · {t}</button>)}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
        <Seg options={ESCENARIOS} value={est.esc} onChange={setEsc} />
        <Seg options={[['clp', 'Pesos'], ['uf', 'UF'], ['ambos', 'Ambos']]} value={est.moneda} onChange={(v) => setGen('moneda', v)} />
      </div>
    </div>
    {!drill && ui.etapa > 0 && <Grid cols={4} colsM={2}>
      <Kpi tono='g' ic='res' label='Resultado' value={fm(e.post)} sub='después de impuesto' onClick={() => ir({ etapa: 3, tab: 'res' })} />
      <Kpi tono='a' ic='ing' label='Ingresos' value={fm(e.fact)} sub={`facturado ${anio}`} onClick={() => ir({ etapa: 1 })} />
      <Kpi tono='y' ic='egr' label='Egresos' value={fm(-e.egr)} sub='costos + comisiones + impuesto' onClick={() => ir({ etapa: 2 })} />
      <Kpi tono='w' ic='gauge' label='Margen' value={e.caja > 0 ? pc((e.post / e.caja) * 100) : '—'} sub='sobre lo cobrado' onClick={() => ir({ etapa: 3, tab: 'imp' })} />
    </Grid>}
    {cuerpo}
    {!drill && <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <Btn disabled={ui.etapa === 0} onClick={() => irEtapa(ui.etapa - 1)}>← Anterior</Btn>
      <Btn onClick={() => parche((c) => { const i = c.hecho.indexOf(ui.etapa); if (i >= 0) c.hecho.splice(i, 1); else c.hecho.push(ui.etapa) })}>{h ? '✓ Revisada · deshacer' : 'Marcar como revisada'}</Btn>
      <div style={{ flex: 1, minWidth: 200 }}><Fld text ph='Nota de la etapa (queda guardada)' value={est.notas[ui.etapa] || ''} onCommit={(v) => parche((c) => { c.notas[ui.etapa] = v })} /></div>
      <Btn primary disabled={ui.etapa === 4} onClick={() => irEtapa(ui.etapa + 1)}>Siguiente →</Btn>
    </div>}
  </div>
}
void Titulo
