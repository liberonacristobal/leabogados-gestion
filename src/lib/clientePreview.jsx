import { useState, useEffect, useMemo, useRef } from 'react'
import { C, fmt } from './base.jsx'
import { porCobrarBills, esVencidaB, saldoCliente } from './compartido.jsx'

// Nombre de cliente en cualquier pantalla (escritorio): al dejar el cursor medio segundo aparece una tarjeta con su saldo, y con clic derecho un menú corto.
// Reconoce el nombre por su texto exacto (si dos clientes se llaman igual, o el nombre va dentro de una frase, no hace nada: mejor no mostrar que mostrar el cliente equivocado).
// Solo lectura. Las cifras salen de las mismas funciones de la ficha y de la lista de Clientes.
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

export function ClientePreview({ clients = [], billing = [], expenses = [], tasks = [], clientEntities = [], onOpenFicha }) {
  const [vista, setVista] = useState(null)   // { tipo:'tarjeta'|'menu', c, x, y }
  const porNombre = useMemo(() => { const m = new Map(); clients.forEach(c => { const k = norm(c.name); if (k) m.set(k, m.has(k) ? null : c) }); return m }, [clients])
  const ref = useRef({ el: null, timer: null })
  const datos = useRef({}); datos.current = { porNombre, onOpenFicha }

  useEffect(() => {
    if (!window.matchMedia || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return
    const buscar = nodo => {
      let e = nodo
      for (let i = 0; i < 4 && e && e !== document.body; i++, e = e.parentElement) {
        if (e.closest && e.closest('input,textarea,select,[contenteditable],[data-sin-preview]')) return null
        const t = e.textContent || ''
        if (t.length > 100) continue
        const c = datos.current.porNombre.get(norm(t))
        if (c) return { el: e, c }
      }
      return null
    }
    const quitar = () => { clearTimeout(ref.current.timer); ref.current.el = null; setVista(null) }
    const sobre = ev => {
      const h = buscar(ev.target)
      if (!h) { if (ref.current.el) quitar(); return }
      if (h.el === ref.current.el) return
      clearTimeout(ref.current.timer); ref.current.el = h.el
      ref.current.timer = setTimeout(() => { const r = h.el.getBoundingClientRect(); setVista({ tipo: 'tarjeta', c: h.c, x: r.left, y: r.bottom + 6 }) }, 500)
    }
    const menu = ev => {
      const h = buscar(ev.target)
      if (!h) return
      ev.preventDefault(); clearTimeout(ref.current.timer); ref.current.el = null
      setVista({ tipo: 'menu', c: h.c, x: ev.clientX, y: ev.clientY })
    }
    const cerrarMenu = ev => { if (!(ev.target.closest && ev.target.closest('[data-cliente-menu]'))) { clearTimeout(ref.current.timer); ref.current.el = null; setVista(null) } }
    const teclas = ev => { if (ev.key === 'Escape') quitar() }
    document.addEventListener('mouseover', sobre)
    document.addEventListener('contextmenu', menu)
    document.addEventListener('mousedown', cerrarMenu)
    document.addEventListener('keydown', teclas)
    window.addEventListener('scroll', quitar, true)
    return () => { document.removeEventListener('mouseover', sobre); document.removeEventListener('contextmenu', menu); document.removeEventListener('mousedown', cerrarMenu); document.removeEventListener('keydown', teclas); window.removeEventListener('scroll', quitar, true); clearTimeout(ref.current.timer) }
  }, [])

  if (!vista) return null
  const c = vista.c, id = String(c.id)
  const ancho = vista.tipo === 'tarjeta' ? 270 : 210
  const x = Math.max(8, Math.min(vista.x, window.innerWidth - ancho - 8)), y = Math.max(8, Math.min(vista.y, window.innerHeight - 250))
  const caja = { position: 'fixed', left: x, top: y, width: ancho, zIndex: 400, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 10px 30px rgba(0,60,80,.18)', fontFamily: 'inherit' }

  if (vista.tipo === 'menu') {
    const copiar = t => { try { navigator.clipboard.writeText(t) } catch (_) {} setVista(null) }
    const item = (t, f, sub) => <div key={t} onClick={f} data-cliente-menu style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 12px', fontSize: 13, color: C.text, cursor: 'pointer' }} onMouseEnter={e => { e.currentTarget.style.background = C.bgSoft }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>{t}{sub && <span style={{ color: C.done }}>{sub}</span>}</div>
    return (
      <div data-cliente-menu data-sin-preview style={{ ...caja, padding: '4px 0' }}>
        <div data-cliente-menu style={{ padding: '7px 12px', fontSize: 12, fontWeight: 700, color: C.accent, background: C.bgSoft, borderRadius: '11px 11px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
        {item('Abrir ficha', () => { setVista(null); datos.current.onOpenFicha && datos.current.onOpenFicha(c.id) })}
        {item('Ver sus facturas y saldo', () => { setVista(null); datos.current.onOpenFicha && datos.current.onOpenFicha(c.id) })}
        <div style={{ borderTop: `1px solid ${C.bgSoft}`, margin: '3px 0' }} />
        {item('Copiar nombre', () => copiar(c.name))}
        {c.rut && item('Copiar RUT', () => copiar(c.rut))}
      </div>)
  }

  const bills = billing.filter(b => String(b.client_id) === id)
  const porCobrar = porCobrarBills(bills), vencido = porCobrarBills(bills.filter(esVencidaB))
  const fondos = saldoCliente(expenses, c.id)
  const nTareas = tasks.filter(t => String(t.client_id) === id && t.status !== 'Terminado').length
  const nRS = clientEntities.filter(e => String(e.client_id) === id).length
  const fila = (k, v, col) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0', borderTop: `1px solid ${C.bgSoft}`, fontSize: 12.5 }}><span style={{ color: C.muted }}>{k}</span><b style={{ color: col || C.text, fontVariantNumeric: 'tabular-nums' }}>{v}</b></div>
  return (
    <div data-sin-preview style={{ ...caja, padding: '10px 12px', pointerEvents: 'none' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.accent, lineHeight: 1.25 }}>{c.name}</div>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 6 }}>{[c.abogado_responsable, nRS > 1 ? `${nRS} razones sociales` : null].filter(Boolean).join(' · ') || 'Sin responsable'}</div>
      {fila('Por cobrar', fmt(porCobrar))}
      {vencido > 0 && fila('de eso, vencido', fmt(vencido), C.overdueText)}
      {fila('Fondos', fmt(fondos), fondos < 0 ? C.overdueText : undefined)}
      {fila('Tareas abiertas', nTareas)}
      <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, color: C.azulInfo }}>Clic para abrir la ficha ›</div>
    </div>)
}
