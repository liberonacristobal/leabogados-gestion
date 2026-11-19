// Revisión de una liquidación de la notaría (la carga hecha desde su Excel): todas las OT de la carga con su estado, para revisarla completa,
// corregir cliente y trabajo (una o varias a la vez) y consultar las que no son nuestras. Siempre se puede volver a abrir desde su solicitud.
// Fuente: las OT que creó la carga (expenses.bulk_import_id), su resumen (no nuestras, de registro o con error, repetidas) y notaria_no_nuestras.
// Las repetidas ya pagadas solo se cuentan (resumen.omitidas): el detalle no se guarda con la carga.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, SEC_LBL, Gl, appAlert, fmt, fmtFechaDMY, isoLocal } from '../lib/base.jsx'
import { Buscador, PaginaSobre, logActividad, registrarError, setLearningKV } from '../lib/compartido.jsx'
import { clienteSugeridoPorGlosa, otNoValida } from '../../supabase/functions/_shared/notariaReglas.js'
import { pagoDeGasto } from '../../supabase/functions/_shared/gastosClienteExcel.js'

const ACC = ['notaria.carga_editada']
const otTxt = o => { const s = String(o || '').trim(); return !s ? 's/OT' : /^OT/i.test(s) ? s.toUpperCase() : 'OT-' + s }
const NN_TXT = { pendiente: 'Por consultar', consultada: 'Consultada', resuelta: 'Respondida' }

// Tonos de las tarjetas y chips (tokens de la app).
const TONO = {
  rev: { bg: C.soonBg, col: C.soonText, t: 'Por revisar' },
  carg: { bg: C.greenBg, col: C.greenText, t: 'Cargadas' },
  nn: { bg: C.overdueBg, col: C.overdueText, t: 'No son nuestras' },
  sin: { bg: C.bgSoft, col: C.grisText, t: 'Sin cargo' },
}
const chipDe = f => f.chip === 'rojo' ? { bg: C.overdueBg, col: C.overdueText } : f.chip === 'ambar' ? { bg: C.soonBg, col: C.soonText } : f.chip === 'azul' ? { bg: C.azulBg, col: C.azulInfo } : f.chip === 'verde' ? { bg: C.greenBg, col: C.greenText } : { bg: C.bgSoft, col: C.grisText }

export function RevisarLiquidacion({ carga, isDesktop, expenses = [], clients = [], sales = [], setExpenses, onAssignClientToExpense, onVerNoNuestras, onOpenClientFicha, onBack }) {
  const D = isDesktop
  const [grp, setGrp] = useState('cli'), [fam, setFam] = useState(null), [q, setQ] = useState('')
  const [orden, setOrden] = useState('az')   // 'az' alfabético (grupos y filas) | 'fecha' más reciente primero
  const [sel, setSel] = useState(() => new Set()), [edit, setEdit] = useState(null), [busy, setBusy] = useState(false)
  const [nn, setNn] = useState({})            // estado de las «no son nuestras» (notaria_no_nuestras) por OT
  const [bitacora, setBitacora] = useState(null), [verLog, setVerLog] = useState(false)
  const resumen = carga.resumen || {}
  const cid = String(carga.id)

  // Estado de las no nuestras, revisión guardada y bitácora de esta carga.
  const cargarLog = () => { if (DEMO) { setBitacora([]); return } supabase.from('activity_log').select('action,detail,user_email,created_at').in('action', ACC).order('created_at', { ascending: false }).limit(300)
    .then(({ data }) => setBitacora((data || []).map(r => { let d = r.detail; try { d = typeof d === 'string' ? JSON.parse(d) : d } catch (_) { d = {} } return { ...r, d: d || {} } }).filter(r => String(r.d.carga || r.d.detalle?.carga) === cid)), () => setBitacora([])) }
  useEffect(() => {
    if (DEMO) { setBitacora([]); return }
    let vivo = true
    const ots = (resumen.noNuestras || []).map(x => x.ot).filter(Boolean)
    if (ots.length) supabase.from('notaria_no_nuestras').select('ot,estado').in('ot', ots).then(({ data }) => { if (vivo) setNn(Object.fromEntries((data || []).map(r => [String(r.ot), r.estado]))) }, () => {})
    cargarLog()
    return () => { vivo = false }
  }, [cid])   // eslint-disable-line react-hooks/exhaustive-deps

  const cliDe = id => clients.find(c => String(c.id) === String(id)) || null
  const respDe = id => cliDe(id)?.abogado_responsable || ''
  const trabajosDe = c => [...new Set([...(sales || []).filter(v => String(v.client_id) === String(c) && !v.deleted_at && v.status === 'Activo').map(v => String(v.title || '').trim()), ...(expenses || []).filter(g => String(g.client_id) === String(c) && g.type === 'fondo' && !g.deleted_at && String(g.project || '').trim()).map(g => String(g.project).trim())].filter(Boolean))]

  // Todas las OT de la carga, con su estado, familia (tono) y datos.
  const filas = useMemo(() => {
    const out = []
    ;(expenses || []).filter(g => String(g.bulk_import_id) === cid && !g.deleted_at && !otNoValida(g)).forEach(g => {
      const c = cliDe(g.client_id), ofi = !!c && (c.is_internal || /liberona\s+escala/i.test(c.name || ''))
      const sinCli = !g.client_id && !g.personal_de, sinTr = !!g.client_id && !ofi && !String(g.project || '').trim()
      const p = pagoDeGasto(g)
      out.push({ key: 'g' + g.id, tipo: 'g', g, ot: otTxt(g.ot_number), f: g.date, mat: g.materia || g.concept || '—', req: g.requirente || '', cli: g.client_id || null, cliTxt: g.personal_de ? 'Personal · ' + g.personal_de : ofi ? 'Oficina' : (c?.name || ''), tr: g.project || '', m: Number(g.amount) || 0,
        pago: p.pagado ? `Pagada ${fmtFechaDMY(isoLocal(p.fecha))}` : 'Por pagar', pagoTono: p.pagado ? 'verde' : 'ambar', fam: sinCli || sinTr ? 'rev' : 'carg',
        est: sinCli ? 'Sin cliente' : sinTr ? 'Sin trabajo' : g.personal_de ? 'Personal' : ofi ? 'Oficina' : 'Cargada', chip: sinCli ? 'rojo' : sinTr ? 'ambar' : (g.personal_de || ofi) ? 'azul' : 'gris', editable: true })
    })
    ;(resumen.noNuestras || []).filter(x => (Number(x.monto) || 0) > 1).forEach((x, i) => {
      const e = nn[String(x.ot)] || 'pendiente'
      out.push({ key: 'n' + i, tipo: 'n', x, ot: otTxt(x.ot), f: x.fecha, mat: x.materia || x.concepto || x.motivo || '—', nombre: x.nombre, req: x.requirente || '', cli: null, cliTxt: '', tr: '', m: Number(x.monto) || 0,
        pago: 'La notaría la cobra y no es nuestra', pagoTono: 'gris', fam: e === 'resuelta' ? 'sin' : 'nn', est: NN_TXT[e] || 'Por consultar', chip: e === 'pendiente' ? 'rojo' : e === 'consultada' ? 'ambar' : 'gris', editable: true, nnEstado: e })
    })
    ;(resumen.erroresDet || []).forEach((x, i) => {
      const reg = /registro/i.test(x.motivo || ''), anu = /efecto|anulad/i.test(x.motivo || '')
      out.push({ key: 'e' + i, tipo: 'e', x, ot: otTxt(x.ot), f: '', mat: x.motivo || 'Con error', nombre: x.nombre, req: '', cli: null, cliTxt: '', tr: '', m: reg ? 1 : 0, pago: reg ? 'No se cobra' : '', pagoTono: 'gris', fam: 'sin', est: reg ? 'De registro' : anu ? 'Anulada' : 'Con error', chip: reg || anu ? 'gris' : 'rojo', editable: false })
    })
    return out
  }, [expenses, clients, resumen, nn, cid])   // eslint-disable-line react-hooks/exhaustive-deps

  const cuenta = f => filas.filter(r => r.fam === f), suma = xs => xs.reduce((a, r) => a + r.m, 0)
  const cobrado = filas.filter(r => r.tipo !== 'e')
  const pendientes = cuenta('rev').length + filas.filter(r => r.tipo === 'n' && r.nnEstado === 'pendiente').length
  const repetidas = Number(resumen.omitidas) || 0

  const visibles = useMemo(() => { const t = q.trim().toLowerCase()
    return filas.filter(r => (!fam || r.fam === fam) && (!t || `${r.ot} ${r.mat} ${r.cliTxt} ${r.tr} ${r.nombre || ''} ${r.req} ${r.m}`.toLowerCase().includes(t))) }, [filas, fam, q])
  const claveGrupo = r => grp === 'cli' ? (r.tipo === 'n' ? 'No son nuestras' : r.tipo === 'e' ? 'Sin cargo' : (r.cliTxt || 'Sin cliente')) : grp === 'resp' ? (r.cli ? (respDe(r.cli) || 'Sin responsable') : 'Sin responsable') : grp === 'est' ? r.est : 'Todas'
  // Orden: alfabético (grupos por nombre con los especiales al final, filas por cliente y trámite) o por fecha (la más reciente primero).
  const _es = (a, b) => String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' })
  const _ESP = ['Sin cliente', 'Sin responsable', 'No son nuestras', 'Sin cargo']
  const grupos = useMemo(() => { const m = new Map(); const base = [...visibles].sort((a, b) => orden === 'fecha' ? String(b.f || '').localeCompare(String(a.f || '')) : (_es(a.cliTxt, b.cliTxt) || _es(a.mat, b.mat)))
    base.forEach(r => { const k = claveGrupo(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r) })
    const arr = [...m.entries()]; if (orden === 'az') arr.sort((a, b) => (_ESP.includes(a[0]) - _ESP.includes(b[0])) || _es(a[0], b[0])); return arr }, [visibles, grp, orden])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Guardar una edición: cliente y trabajo de las OT elegidas (o la consulta a la notaría de una no nuestra).
  const guardar = async (cambios) => {
    if (busy) return; setBusy(true)
    try {
      const gs = edit.filas.filter(r => r.tipo === 'g').map(r => r.g)
      for (const g of gs) {
        let patch = {}
        const cambiaCli = cambios.cli && String(cambios.cli) !== String(g.client_id || '')
        if (cambiaCli) {
          if (onAssignClientToExpense) await onAssignClientToExpense(g, cambios.cli)
          else if (!DEMO) { const { error } = await supabase.from('expenses').update({ client_id: cambios.cli }).eq('id', g.id); if (error) throw error }
          patch = { client_id: cambios.cli, project: null, sale_id: null }
        }
        const cli = cambios.cli || g.client_id
        if (cambios.tr !== undefined) { const v = (sales || []).find(x => String(x.client_id) === String(cli) && String(x.title || '').trim() === cambios.tr); patch = { ...patch, project: cambios.tr || null, sale_id: v ? v.id : null } }
        if (Object.keys(patch).length) {
          if (!DEMO) { const { error } = await supabase.from('expenses').update(patch).eq('id', g.id); if (error) throw error }
          if (setExpenses) setExpenses(p => p.map(x => String(x.id) === String(g.id) ? { ...x, ...patch } : x))
        }
      }
      const n = edit.filas.find(r => r.tipo === 'n')
      if (n && cambios.nn && cambios.nn !== n.nnEstado) {
        const ahora = new Date().toISOString(), yo = 'admin'
        const patch = cambios.nn === 'consultada' ? { estado: 'consultada', consultada_at: ahora, consultada_por: yo } : cambios.nn === 'resuelta' ? { estado: 'resuelta', resuelta_at: ahora, resuelta_por: yo } : { estado: 'pendiente' }
        if (!DEMO) { const { error } = await supabase.from('notaria_no_nuestras').update(patch).eq('ot', n.x.ot); if (error) throw error }
        setNn(p => ({ ...p, [String(n.x.ot)]: cambios.nn }))
      }
      logActividad('notaria.carga_editada', { tabla: 'bulk_imports', id: carga.id, detalle: { carga: cid, title: edit.filas.length === 1 ? `${edit.filas[0].ot} editada en la revisión` : `${edit.filas.length} OT editadas en la revisión` } })
      setTimeout(cargarLog, 600)
      setSel(new Set()); setEdit(null)
    } catch (e) { registrarError({ origen: 'accion', vista: 'revisar_liquidacion', err: e }); appAlert('No se pudo guardar: ' + (e.message || e)) }
    setBusy(false)
  }

  // ── Piezas visuales (tamaños y tonos de la app).
  const chipEl = r => { const t = chipDe(r); return <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 9px', whiteSpace: 'nowrap', background: t.bg, color: t.col }}>{r.est}</span> }
  const pagoEl = r => r.pago ? <span style={{ color: r.pagoTono === 'verde' ? C.greenText : r.pagoTono === 'ambar' ? C.soonText : C.muted }}>{r.pago}</span> : null
  const tile = (k, lab, big, sub, tono, onClick, on) => (
    <div key={k} role={onClick ? 'button' : undefined} onClick={onClick} style={{ background: tono.bg, borderRadius: 12, padding: D ? '12px 14px' : '9px 10px', minWidth: 0, cursor: onClick ? 'pointer' : 'default', boxShadow: on ? `inset 0 0 0 1.5px ${tono.col}` : 'none' }}>
      <div style={{ fontSize: D ? 10 : 9.5, fontWeight: 700, letterSpacing: .06, textTransform: 'uppercase', color: tono.col, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lab}</div>
      <div style={{ textAlign: 'right', fontSize: D ? 24 : 20, fontWeight: 700, lineHeight: 1.15, marginTop: 4, color: tono.col, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{big}</div>
      <div style={{ textAlign: 'right', fontSize: 11, color: tono.col, marginTop: 2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{sub}</div>
    </div>)
  const cbox = (r) => { const on = sel.has(r.key); return r.tipo === 'g'
    ? <span onClick={e => { e.stopPropagation(); setSel(p => { const n = new Set(p); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n }) }} style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${on ? C.accent : C.done}`, background: on ? C.accent : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>{on && <span style={{ color: '#fff', fontSize: 10 }}><Gl n='tick' /></span>}</span>
    : <span style={{ width: 16, flexShrink: 0 }} /> }
  const abrir = r => { if (r.editable) setEdit({ filas: [r] }) }
  const fila = r => D
    ? <tr key={r.key} onClick={() => abrir(r)} style={{ cursor: r.editable ? 'pointer' : 'default' }}>
        <td style={{ width: 34, padding: '9px 10px', verticalAlign: 'top', borderTop: `1px solid ${C.track}` }}>{cbox(r)}</td>
        <td style={{ width: 104, padding: '9px 10px', verticalAlign: 'top', whiteSpace: 'nowrap', borderTop: `1px solid ${C.track}` }}><div style={{ fontWeight: 700, color: C.azulInfo, fontSize: 12 }}>{r.ot}</div><div style={{ fontSize: 11, color: C.muted }}>{r.f ? fmtFechaDMY(r.f) : ''}</div></td>
        <td style={{ padding: '9px 10px', verticalAlign: 'top', fontSize: 12, color: C.text, borderTop: `1px solid ${C.track}` }}>{r.mat}<div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{[r.nombre, r.req ? 'requiere ' + r.req : ''].filter(Boolean).join(' · ')}</div></td>
        <td style={{ width: 250, padding: '9px 10px', verticalAlign: 'top', fontSize: 12, color: C.text, borderTop: `1px solid ${C.track}` }}>{[r.cliTxt, r.cli && r.tr ? r.tr : (r.cli ? 'Sin trabajo' : '')].filter(Boolean).join(' · ') || '—'}<div style={{ fontSize: 11, marginTop: 2 }}>{pagoEl(r)}</div></td>
        <td style={{ width: 130, padding: '9px 10px', verticalAlign: 'top', borderTop: `1px solid ${C.track}` }}>{chipEl(r)}</td>
        <td style={{ width: 104, padding: '9px 10px', verticalAlign: 'top', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: C.accent, fontSize: 13, fontVariantNumeric: 'tabular-nums', borderTop: `1px solid ${C.track}` }}>{r.tipo === 'e' && !r.m ? '—' : fmt(r.m)}</td></tr>
    : <div key={r.key} onClick={() => abrir(r)} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 12px', borderTop: `1px solid ${C.track}`, cursor: r.editable ? 'pointer' : 'default' }}>
        {cbox(r)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12 }}><b style={{ color: C.azulInfo }}>{r.ot}</b> <span style={{ fontSize: 11, color: C.muted }}>{r.f ? fmtFechaDMY(r.f) : ''}</span></div>
          <div style={{ fontSize: 12, color: C.text, marginTop: 2 }}>{r.mat}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{[r.nombre, r.req ? 'requiere ' + r.req : ''].filter(Boolean).join(' · ')}</div>
          {(r.cliTxt || r.cli) && <div style={{ fontSize: 11.5, color: C.text, marginTop: 2 }}>{[r.cliTxt, r.cli ? (r.tr || 'Sin trabajo') : ''].filter(Boolean).join(' · ')}</div>}
          <div style={{ fontSize: 11.5, marginTop: 2 }}>{pagoEl(r)}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}><span style={{ fontSize: 13, fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{r.tipo === 'e' && !r.m ? '—' : fmt(r.m)}</span>{chipEl(r)}</div>
      </div>
  const cabGrupo = (k, xs) => <div key={'h' + k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: D ? '9px 20px' : '9px 12px', background: C.bgSoft, borderTop: `.5px solid ${C.border}`, borderBottom: `.5px solid ${C.border}`, fontSize: 12 }}>
    <b style={{ color: C.accent, fontSize: 13 }}>{k}</b><span style={{ color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{xs.length} OT, {fmt(suma(xs))}</span></div>
  const link = (t, fn, off) => <span onClick={off ? undefined : fn} style={{ fontSize: 12, fontWeight: 700, color: off ? C.done : C.azulInfo, cursor: off ? 'default' : 'pointer' }}>{t}</span>

  // ── Página de edición.
  if (edit) return <EditarOT edit={edit} clients={clients} trabajosDe={trabajosDe} cliDe={cliDe} busy={busy} onSave={guardar} onBack={() => setEdit(null)} filasCarga={filas} expenses={expenses} D={D} />

  const seleccionadas = filas.filter(r => sel.has(r.key))
  return (
    <PaginaSobre origen='Solicitudes de cuenta' titulo={`Liquidación del ${fmtFechaDMY(isoLocal(carga.created_at))}`} onBack={onBack} maxW={1114}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, padding: D ? '9px 16px 0' : '9px 12px 0' }}>
          {link('Historial', () => setVerLog(v => !v))}
        </div>
        {verLog && <div style={{ padding: '8px 16px', borderBottom: `1px solid ${C.border}` }}>
          {(bitacora || []).length ? bitacora.slice(0, 8).map((l, i) => <div key={i} style={{ fontSize: 12, color: C.text, padding: '5px 0', borderTop: i ? `1px solid ${C.track}` : 'none' }}>{l.d.title || l.d.detalle?.title || l.action}<div style={{ fontSize: 11, color: C.muted }}>{fmtFechaDMY(isoLocal(l.created_at))} · {String(l.user_email || '').split('@')[0]}</div></div>) : <div style={{ fontSize: 12, color: C.muted }}>Sin movimientos todavía.</div>}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: D ? 'repeat(6,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))', gap: D ? 10 : 6, padding: D ? '14px 16px' : '10px' }}>
          {tile('tot', 'Total cobrado', fmt(suma(cobrado)), `${cobrado.length} OT`, { bg: C.azulBg, col: C.accent })}
          {['rev', 'carg', 'nn', 'sin'].map(f => tile(f, TONO[f].t, cuenta(f).length, fmt(suma(cuenta(f))), TONO[f], () => setFam(fam === f ? null : f), fam === f))}
          {tile('rep', 'Repetidas pagadas', repetidas, 'ya en la app', { bg: C.azulBg, col: C.azulInfo })}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: D ? '0 16px 10px' : '0 10px 10px' }}>
          <div style={{ flex: 1, minWidth: 150 }}><Buscador value={q} onChange={setQ} placeholder='Buscar OT o cliente…' /></div>
          <div style={{ display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', background: C.surface }}>
            {[['az', 'A–Z'], ['fecha', 'Fecha']].map(([k, l]) => <span key={k} onClick={() => setOrden(k)} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: orden === k ? C.accent : 'transparent', color: orden === k ? '#fff' : C.muted, borderLeft: k !== 'az' ? `1px solid ${C.border}` : 'none' }}>{l}</span>)}
          </div>
          <div style={{ display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', background: C.surface }}>
            {[['cli', 'Cliente'], ['resp', 'Resp.'], ['est', 'Estado'], ['pl', 'Plana']].map(([k, l]) => <span key={k} onClick={() => setGrp(k)} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: grp === k ? C.accent : 'transparent', color: grp === k ? '#fff' : C.muted, borderLeft: k !== 'cli' ? `1px solid ${C.border}` : 'none' }}>{l}</span>)}
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          {!visibles.length && <div style={{ padding: '16px 20px', fontSize: 13, color: C.muted }}>{filas.length ? 'Ninguna OT con este filtro.' : 'Esta carga no tiene OT para revisar.'}</div>}
          {grupos.map(([k, xs]) => <Fragment key={k}>{grp !== 'pl' && cabGrupo(k, xs)}{D ? <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}><tbody>{xs.map(fila)}</tbody></table> : xs.map(fila)}</Fragment>)}
        </div>
      </div>
      {seleccionadas.length > 0 && <div style={{ position: 'sticky', bottom: 12, background: C.accent, color: '#fff', borderRadius: 12, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, fontSize: 13 }}>
        <b>{seleccionadas.length} seleccionada{seleccionadas.length !== 1 ? 's' : ''}</b>
        <button onClick={() => setEdit({ filas: seleccionadas })} style={{ background: '#fff', color: C.accent, border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Editar</button>
        <span onClick={() => setSel(new Set())} style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Limpiar</span></div>}
    </PaginaSobre>)
}

// Página de edición: cliente y trabajo de una o varias OT, o la consulta a la notaría de una que no es nuestra.
function EditarOT({ edit, clients, trabajosDe, cliDe, busy, onSave, onBack, filasCarga, expenses, D }) {
  const uno = edit.filas.length === 1 ? edit.filas[0] : null
  const gs = edit.filas.filter(r => r.tipo === 'g')
  const sug = uno && uno.tipo === 'g' && !uno.cli ? clienteSugeridoPorGlosa(uno.g, expenses) : null
  const [cli, setCli] = useState(() => uno?.cli ? String(uno.cli) : (sug ? String(sug.clienteId) : null))
  const [tr, setTr] = useState(() => uno?.tr || '')
  const [nn, setNn] = useState(uno?.tipo === 'n' ? uno.nnEstado : null)
  const [bq, setBq] = useState('')
  const cambiaCli = !!cli && !gs.every(r => String(r.cli || '') === String(cli))
  const ts = cli ? trabajosDe(cli) : []
  const lista = clients.filter(c => !c.is_internal && (!bq.trim() || (c.name || '').toLowerCase().includes(bq.trim().toLowerCase()))).slice(0, 40)
  const puede = !busy && (uno?.tipo === 'n' ? !!nn && nn !== uno.nnEstado : (cambiaCli || (cli && tr !== (uno?.tr || ''))))
  const radio = (on, t, fn, sub) => <div key={t} onClick={fn} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: `1px solid ${C.track}`, cursor: 'pointer', background: on ? C.azulBg : 'transparent' }}>
    <span style={{ width: 16, height: 16, borderRadius: '50%', border: on ? `5px solid ${C.accent}` : `1.5px solid ${C.done}`, flexShrink: 0, boxSizing: 'border-box' }} />
    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: on ? 700 : 500, color: on ? C.accent : C.text }}>{t}</span>{sub && <span style={{ fontSize: 11, color: C.greenText }}>{sub}</span>}</div>
  return (
    <PaginaSobre origen='Liquidación' titulo={uno ? `Editar ${uno.ot}` : `Editar ${edit.filas.length} OT`} onBack={onBack} maxW={640}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '11px 12px', marginBottom: 12 }}>
        {uno ? <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><b style={{ color: C.accent, fontSize: 14 }}>{uno.ot}</b><b style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{fmt(uno.m)}</b></div>
          <div style={{ fontSize: 13, color: C.text, marginTop: 3 }}>{uno.mat}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{[uno.f ? fmtFechaDMY(uno.f) : '', uno.nombre, uno.req ? 'requiere ' + uno.req : ''].filter(Boolean).join(' · ')}</div>
          <div style={{ fontSize: 12, marginTop: 3, display: 'flex', gap: 8, alignItems: 'center' }}>{uno.pago && <span style={{ color: uno.pagoTono === 'verde' ? C.greenText : uno.pagoTono === 'ambar' ? C.soonText : C.muted }}>{uno.pago}</span>}<span style={{ fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 9px', background: chipDe(uno).bg, color: chipDe(uno).col }}>{uno.est}</span></div>
        </> : <><b style={{ color: C.accent }}>{edit.filas.length} OT</b> <span style={{ fontSize: 12, color: C.muted }}>· {fmt(edit.filas.reduce((a, r) => a + r.m, 0))}</span></>}
      </div>
      {uno?.tipo === 'n'
        ? <><div style={{ ...SEC_LBL, margin: '0 2px 6px' }}>Consulta a la notaría</div>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>{[['pendiente', 'Por consultar'], ['consultada', 'Consultada'], ['resuelta', 'Respondida']].map(([k, t], i) => <div key={k} style={i ? {} : { marginTop: -1 }}>{radio(nn === k, t, () => setNn(k))}</div>)}</div></>
        : <>
            <div style={{ ...SEC_LBL, margin: '0 2px 6px' }}>Cliente</div>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ padding: 10 }}><Buscador value={bq} onChange={setBq} placeholder='Buscar cliente…' /></div>
              {lista.map(c => radio(String(c.id) === String(cli), c.name, () => { setCli(String(c.id)); if (String(c.id) !== String(cli)) setTr('') }, sug && String(sug.clienteId) === String(c.id) ? 'sugerido por la glosa' : null))}
            </div>
            {cli && ts.length > 0 && <><div style={{ ...SEC_LBL, margin: '0 2px 6px' }}>Trabajo</div>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>{ts.map(t => radio(tr === t, t, () => setTr(t)))}</div></>}
          </>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onBack} style={{ flex: 1, height: 44, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.accent, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
        <button disabled={!puede} onClick={() => onSave(uno?.tipo === 'n' ? { nn } : { cli, tr: tr || (cambiaCli ? '' : undefined) })} style={{ flex: 2, height: 44, borderRadius: 10, border: 'none', background: puede ? C.normal : C.done, color: '#fff', fontSize: 14, fontWeight: 700, cursor: puede ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </PaginaSobre>)
}
