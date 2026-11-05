// Índice del Diario Oficial: todas las publicaciones de «Empresas y Cooperativas» que carga el agente diario-oficial
// (tabla diario_oficial_empresas, dato público). La búsqueda y los filtros corren en el servidor (la tabla pasa de 20.000 filas)
// y se pagina de a 50. El chip «Cliente» sale solo del RUT publicado contra las fichas y razones sociales de la oficina.
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, DEMO } from '../supabase'
import { calzarPublicaciones } from '../../supabase/functions/_shared/diarioOficialAviso.js'
import { C, SEC_LBL, SIcon, _normTxt, diaGrande, isoLocal } from '../lib/base.jsx'

const PAGINA = 50
const fmtN = n => Number(n || 0).toLocaleString('es-CL')
const CATS = [['', 'Todas'], ['CONSTITUCIÓN', 'Constitución'], ['MODIFICACIÓN', 'Modificación'], ['DISOLUCIÓN', 'Disolución'], ['MIGRACIÓN', 'Migración']]
const CAT_CHIP = { 'CONSTITUCIÓN': ['Constitución', 'Const.', C.greenBg, C.greenText], 'MODIFICACIÓN': ['Modificación', 'Modif.', C.azulBg, C.azulInfo], 'DISOLUCIÓN': ['Disolución', 'Disol.', C.overdueBg, C.overdueText], 'MIGRACIÓN': ['Migración', 'Migr.', C.track, C.muted] }

// Mismo formato que la tabla: cuerpo-dígito verificador, sin puntos («77898170-K»).
export const rutDO = r => { const k = String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); return k.length >= 7 ? `${k.slice(0, -1)}-${k.slice(-1)}` : '' }
// El Diario escribe «RAZÓN SOCIAL 77.898.170-K*»: se muestra solo la razón social, en minúscula con capital.
export const nombreDO = n => {
  const s = String(n || '').replace(/\s+\d{1,3}(\.\d{3}){2}-[\dkK]\*?$/, '').replace(/\*+$/, '').replace(/\s+/g, ' ').trim()
  if (s !== s.toUpperCase()) return s
  return s.toLowerCase().split(' ').map(w => /^(s\.?a\.?|spa|e\.?i\.?r\.?l\.?|s\.?r\.?l\.?|ltda\.?|ag|sp)$/.test(w) ? ({ spa: 'SpA', 'ltda': 'Ltda.', 'ltda.': 'Ltda.' }[w] || w.toUpperCase()) : (['de', 'del', 'la', 'las', 'los', 'y', 'e', 'el'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
}
const urlPdf = u => String(u || '').replace(/^http:/, 'https:')

const _DEMO_FILAS = [
  { id: 'do1', fecha: '2026-11-04', nombre: 'COMERCIAL ANDES SpA 76.111.222-3*', rut: '76111222-3', categoria: 'MODIFICACIÓN', subtipo: 'Sociedades por Acciones', cve: '2896001', url: '' },
  { id: 'do2', fecha: '2026-11-04', nombre: 'ASESORÍAS DEMO LIMITADA 77.100.200-K*', rut: '77100200-K', categoria: 'CONSTITUCIÓN', subtipo: 'Sociedades de Responsabilidad Limitada', cve: '2896002', url: '' },
  { id: 'do3', fecha: '2026-11-03', nombre: 'INVERSIONES EJEMPLO S.A. 76.300.400-5*', rut: '76300400-5', categoria: 'MODIFICACIÓN', subtipo: 'Sociedades Anónimas', cve: '2895003', url: '' },
  { id: 'do4', fecha: '2026-11-02', nombre: 'SERVICIOS PEHUÉN LIMITADA', rut: null, categoria: 'DISOLUCIÓN', subtipo: 'Sociedades de Responsabilidad Limitada', cve: '2894004', url: '' },
]

export function DiarioOficialIndice({ isDesktop, clients = [], clientEntities = [], onOpenClientFicha }) {
  const D = isDesktop
  const [q, setQ] = useState(''), [qq, setQq] = useState(''), [cat, setCat] = useState(''), [periodo, setPeriodo] = useState('7'), [soloCli, setSoloCli] = useState(false)
  const [filas, setFilas] = useState(null), [total, setTotal] = useState(0), [mas, setMas] = useState(false), [err, setErr] = useState('')
  const [kpi, setKpi] = useState(null)   // {ult, nUlt, n7, n30}
  const pedido = useRef(0)

  const porRut = useMemo(() => {
    const m = {}; [...clients.map(c => [c.rut, c.id]), ...clientEntities.map(e => [e.rut, e.client_id])].forEach(([r, id]) => { const k = rutDO(r); if (k && id) m[k] = String(id) })
    return m
  }, [clients, clientEntities])
  // Misma regla del correo diario: por RUT; si no, por el mismo nombre (con nota para verificar).
  const calces = useMemo(() => { const m = new Map(); (filas ? calzarPublicaciones(filas, clients, clientEntities) : []).forEach(c => { if (!m.has(c.pub.id)) m.set(c.pub.id, c) }); return m }, [filas, clients, clientEntities])
  const nombreCli = id => clients.find(c => String(c.id) === String(id))?.name || ''

  useEffect(() => { const t = setTimeout(() => setQq(q.trim()), 300); return () => clearTimeout(t) }, [q])

  const desdeDe = p => p === '7' || p === '30' ? isoLocal(Date.now() - Number(p) * 864e5) : ''

  // Fotos: última edición cargada y publicaciones de los últimos 7 y 30 días.
  useEffect(() => { let vivo = true
    if (DEMO) { setKpi({ ult: '2026-11-04', nUlt: 2, n7: 4, n30: 4 }); return }
    ;(async () => {
      try {
        const { data: u } = await supabase.from('diario_oficial_empresas').select('fecha').order('fecha', { ascending: false }).limit(1)
        const ult = u?.[0]?.fecha || ''
        const cuenta = f => supabase.from('diario_oficial_empresas').select('id', { count: 'exact', head: true }).gte('fecha', f)
        const [a, b, c] = await Promise.all([ult ? supabase.from('diario_oficial_empresas').select('id', { count: 'exact', head: true }).eq('fecha', ult) : { count: 0 }, cuenta(desdeDe('7')), cuenta(desdeDe('30'))])
        if (vivo) setKpi({ ult, nUlt: a.count || 0, n7: b.count || 0, n30: c.count || 0 })
      } catch { if (vivo) setKpi({ ult: '', nUlt: 0, n7: 0, n30: 0 }) }
    })()
    return () => { vivo = false } }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const consulta = (desde, hasta) => {
    let s = supabase.from('diario_oficial_empresas').select('id,fecha,nombre,nombre_norm,rut,categoria,subtipo,cve,url', { count: desde === 0 ? 'exact' : undefined })
    if (cat) s = s.eq('categoria', cat)
    if (periodo === 'ed' && kpi?.ult) s = s.eq('fecha', kpi.ult); else if (desdeDe(periodo)) s = s.gte('fecha', desdeDe(periodo))
    if (soloCli) { const ruts = Object.keys(porRut); s = s.in('rut', ruts.length ? ruts : ['-']) }
    if (qq) {
      if (/^[\d.\-kK\s]+$/.test(qq) && qq.replace(/\D/g, '').length >= 3) { const r = qq.replace(/[.\s]/g, '').toUpperCase(), d = qq.replace(/\D/g, ''); s = s.or(`rut.like.${r}*,cve.like.${d}*`) }
      else { const n = _normTxt(qq).replace(/[%,()*"]/g, ' ').trim().split(/\s+/).join('%'); if (n) s = s.ilike('nombre_norm', `%${n}%`) }
    }
    return s.order('fecha', { ascending: false }).order('id', { ascending: false }).range(desde, hasta)
  }

  useEffect(() => { const id = ++pedido.current; setErr(''); setFilas(null); setMas(false)
    if (DEMO) {
      let r = _DEMO_FILAS.filter(f => (!cat || f.categoria === cat) && (!soloCli || porRut[f.rut]) && (!qq || _normTxt(f.nombre + ' ' + (f.rut || '') + ' ' + f.cve).includes(_normTxt(qq))))
      setFilas(r); setTotal(r.length); return }
    consulta(0, PAGINA - 1).then(({ data, count, error }) => { if (id !== pedido.current) return
      if (error) { setErr(error.message || 'No se pudo leer el índice'); setFilas([]); return }
      setFilas(data || []); setTotal(count || 0) })
  }, [qq, cat, periodo, soloCli, kpi?.ult, porRut])   // eslint-disable-line react-hooks/exhaustive-deps

  const verMas = async () => { if (!filas || mas) return; setMas(true); const id = pedido.current
    const { data, error } = await consulta(filas.length, filas.length + PAGINA - 1)
    if (id !== pedido.current) return
    if (error) setErr(error.message); else setFilas(p => [...(p || []), ...(data || [])]); setMas(false) }

  const tile = (k, l, v) => { const on = periodo === k
    return <div key={k} onClick={() => setPeriodo(on ? '' : k)} style={{ background: C.surface, border: `1px solid ${on ? C.accent : C.border}`, borderRadius: 12, padding: D ? '10px 14px' : '8px 10px', minWidth: 0, cursor: 'pointer' }}>
      <div style={{ ...SEC_LBL, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</div>
      <div style={{ fontSize: D ? 20 : 17, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{kpi ? fmtN(v) : '—'}</div>
    </div> }
  const chip = (on, l, fn, k) => <button key={k || l} onClick={fn} style={{ fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 999, border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : C.surface, color: on ? '#fff' : C.muted, cursor: 'pointer', whiteSpace: 'nowrap' }}>{l}</button>

  const fila = (f, i) => { const cz = calces.get(f.id), cid = cz?.clientId, ct = CAT_CHIP[f.categoria]
    const abrir = () => { if (f.url) window.open(urlPdf(f.url), '_blank', 'noopener') }
    return <div key={f.id} onClick={abrir} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: D ? '9px 14px' : '9px 12px', borderTop: i ? `1px solid ${C.track}` : 'none', cursor: f.url ? 'pointer' : 'default' }}>
      {diaGrande(f.fecha)}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreDO(f.nombre)}</div>
        <div style={{ fontSize: 12, color: C.textSoft, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{[f.rut ? f.rut.replace(/\B(?=(\d{3})+(?!\d)(?=-))/g, '.') : 'Sin RUT', D ? f.subtipo : null, D && f.cve ? `CVE ${f.cve}` : null].filter(Boolean).join(' · ')}</div>
      </div>
      {cid && <span onClick={ev => { ev.stopPropagation(); onOpenClientFicha && onOpenClientFicha(cid) }} title={[nombreCli(cid), cz?.nota].filter(Boolean).join(' · ')} style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: C.soonBg, color: C.soonText, whiteSpace: 'nowrap', cursor: onOpenClientFicha ? 'pointer' : 'default', flexShrink: 0 }}>Cliente</span>}
      {ct && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: ct[2], color: ct[3], whiteSpace: 'nowrap', flexShrink: 0 }}>{D ? ct[0] : ct[1]}</span>}
      {D && f.url && <span style={{ fontSize: 13, fontWeight: 600, color: C.azulInfo, whiteSpace: 'nowrap', flexShrink: 0 }}>Ver PDF</span>}
    </div> }

  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: D ? 8 : 6 }}>
      {tile('ed', D ? `Edición ${kpi?.ult ? kpi.ult.split('-').reverse().join('-') : ''}` : 'Edición', kpi?.nUlt)}
      {tile('7', D ? 'Últimos 7 días' : '7 días', kpi?.n7)}
      {tile('30', D ? 'Últimos 30 días' : '30 días', kpi?.n30)}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', minWidth: 0 }}>
      <SIcon n='search' s={14} c={C.done} />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={D ? 'Buscar por razón social, RUT o CVE' : 'Buscar razón social, RUT o CVE'} style={{ border: 'none', background: 'none', outline: 'none', fontSize: 13, color: C.text, width: '100%', minWidth: 0 }} />
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {CATS.map(([k, l]) => chip(cat === k, l, () => setCat(k), k))}
      {chip(soloCli, 'Solo mis clientes', () => setSoloCli(v => !v), 'cli')}
    </div>
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      {filas === null && <div style={{ padding: '16px 14px', fontSize: 13, color: C.muted }}>Cargando…</div>}
      {err && <div style={{ padding: '12px 14px', fontSize: 13, color: C.overdueText }}>No se pudo leer el índice: {err}</div>}
      {filas && !filas.length && !err && <div style={{ padding: '16px 14px', fontSize: 13, color: C.muted, textAlign: 'center' }}>Ninguna publicación con esos filtros.</div>}
      {(filas || []).map(fila)}
      {filas && filas.length < total && <button onClick={verMas} disabled={mas} style={{ width: '100%', fontSize: 13, fontWeight: 600, color: C.azulInfo, background: 'none', border: 'none', borderTop: `1px solid ${C.track}`, cursor: 'pointer', padding: '11px 14px' }}>{mas ? 'Cargando…' : `Ver ${Math.min(PAGINA, total - filas.length)} más`}</button>}
    </div>
    {filas && <div style={{ fontSize: 12, color: C.muted, margin: '0 2px' }}>{fmtN(total)} publicación{total !== 1 ? 'es' : ''}{filas.length < total ? ` · se muestran ${fmtN(filas.length)}` : ''}</div>}
  </div>)
}
