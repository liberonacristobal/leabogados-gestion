// Mi Gmail: cada persona conecta su Gmail para que la app lea sus correos ENVIADOS (solo lectura) y complete lo que ya hizo por correo
// (hoy: quién envió una factura, a quién y en qué fecha). Esta página solo muestra el estado de la conexión y la hora de la última lectura:
// nunca lo que se leyó. El estado se calcula con la hora de la última lectura buena (_shared/gmailLectura.js), así que también avisa
// aunque el servidor no responda. Los socios ven además el estado de cada persona del equipo.
import { useState, useEffect } from 'react'
import { C, SEC_LBL, appConfirm, fmtFechaDMY, isoLocal } from '../lib/base.jsx'
import { estadoConexion } from '../../supabase/functions/_shared/gmailLectura.js'
import { gmailLlamar } from '../supabase'

const PILL = {
  sin: { t: 'Sin conectar', bg: C.azulBg, fg: C.muted },
  ok: { t: 'Al día', bg: C.greenBg, fg: C.greenText },
  atrasada: { t: 'Atrasado', bg: C.ambarBg, fg: C.soonText },
  fallo: { t: 'Falló', bg: C.overdueBg, fg: C.overdueText },
  reconectar: { t: 'Reconectar', bg: C.overdueBg, fg: C.overdueText },
}
export const pillGmail = k => PILL[k] || PILL.sin

// «hoy 13:00» o «03-11-2026 07:10» (hora de Chile del navegador).
export const horaUltima = iso => {
  if (!iso) return ''
  const d = new Date(iso); if (isNaN(+d)) return ''
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return isoLocal(+d) === isoLocal(Date.now()) ? `hoy ${hh}` : `${fmtFechaDMY(isoLocal(+d))} ${hh}`
}

const Pill = ({ k }) => { const p = pillGmail(k); return <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '3px 10px', background: p.bg, color: p.fg, whiteSpace: 'nowrap' }}>{p.t}</span> }
const Dot = ({ k }) => <span style={{ width: 8, height: 8, borderRadius: '50%', background: k === 'ok' ? C.greenText : k === 'atrasada' ? C.soonText : k === 'sin' ? C.textSoft : C.overdueText, flexShrink: 0 }} />
const bSm = { height: 28, minWidth: 84, padding: '0 12px', fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', border: '1px solid', fontFamily: 'inherit' }
const bP = { ...bSm, color: C.surface, background: C.accent, borderColor: C.accent }
const bS = { ...bSm, color: C.accent, background: C.surface, borderColor: C.border }
const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }

export function MiGmailView({ est, onConectar, onLeer, onDesconectar, esAdmin, mensaje, isDesktop }) {
  const k = estadoConexion(est).k
  const [leyendo, setLeyendo] = useState(false)
  const [equipo, setEquipo] = useState(null)
  useEffect(() => { if (!esAdmin) return; let vivo = true; gmailLlamar('estados').then(r => { if (vivo && r?.ok) setEquipo(r.filas) }); return () => { vivo = false } }, [esAdmin, est?.ultimo_ok, est?.estado])
  const leer = async () => { setLeyendo(true); try { await onLeer() } finally { setLeyendo(false) } }
  const desconectar = async () => { if (await appConfirm('¿Desconectar tu Gmail? La app dejará de leer tus correos enviados y borrará tu permiso.')) onDesconectar() }
  const lista = (t, xs) => <><span style={SEC_LBL}>{t}</span><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.text, display: 'flex', flexDirection: 'column', gap: 4 }}>{xs.map(x => <li key={x}>{x}</li>)}</ul></>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Pill k={k} />
          {est?.ultimo_ok && k !== 'sin' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${C.border}`, borderRadius: 20, padding: '4px 11px', fontSize: 11, fontWeight: 600, color: C.muted, background: C.surface }}><Dot k={k} />Última lectura {horaUltima(est.ultimo_ok)}</span>}
        </div>
        {mensaje && <div style={{ background: C.overdueBg, color: C.overdueText, borderRadius: 10, padding: '9px 12px', fontSize: 12.5, fontWeight: 600 }}>{mensaje}</div>}
        {(k === 'reconectar' || k === 'fallo') && !mensaje && <div style={{ background: C.overdueBg, color: C.overdueText, borderRadius: 10, padding: '9px 12px', fontSize: 12.5, fontWeight: 600 }}>{k === 'reconectar' ? 'Google rechazó el permiso.' : 'La lectura de tu correo no funciona desde hace más de un día.'} Mientras siga así, lo que envíes por correo no se completa solo.{k === 'fallo' && est?.error ? ` (${String(est.error).slice(0, 140)})` : ''}</div>}
        {k === 'sin' && <>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>Conecta tu Gmail para que la app complete sola lo que ya haces por correo: quién envió cada factura, a quién y en qué fecha.</div>
          {lista('Qué lee', ['Solo tus correos enviados, y solo los que van a un contacto conocido de un cliente.', 'Destinatarios, asunto, fecha, nombres de adjuntos y el comienzo del texto.'])}
          {lista('Qué guarda', ['Fechas, destinatarios y quién envió, en la factura.', 'Nunca el texto de los correos.'])}
          <div style={{ fontSize: 12, color: C.muted }}>Google te pide permiso de solo lectura: la app no puede enviar, borrar ni mover tus correos con él.</div>
          <button onClick={onConectar} style={{ ...bP, alignSelf: 'flex-start' }}>Conectar mi Gmail</button>
        </>}
        {k !== 'sin' && <>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>La app revisa tus enviados una vez al día y tres veces al día del 1 al 8 de cada mes. Puedes revisar ahora o desconectar cuando quieras; al desconectar la app borra tu permiso.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(k === 'reconectar' || k === 'fallo') ? <button onClick={onConectar} style={bP}>Reconectar</button> : <button onClick={leer} disabled={leyendo} style={{ ...bP, opacity: leyendo ? .6 : 1 }}>{leyendo ? 'Leyendo…' : 'Leer ahora'}</button>}
            <button onClick={desconectar} style={bS}>Desconectar</button>
          </div>
        </>}
      </div>
      {esAdmin && <div style={card}>
        <span style={SEC_LBL}>Equipo</span>
        {!equipo ? <div style={{ fontSize: 12, color: C.muted }}>Cargando…</div> : <div style={{ display: 'flex', flexDirection: 'column' }}>
          {equipo.map((f, i) => { const kk = estadoConexion(f.estado ? { estado: f.estado, ultimo_ok: f.ultimo_ok } : null).k
            return <div key={f.email} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i ? `0.5px solid ${C.bgSoft}` : 'none', flexWrap: isDesktop ? 'nowrap' : 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{f.nombre}</div><div style={{ fontSize: 11, color: C.muted, overflowWrap: 'anywhere' }}>{f.email}</div></div>
              <span style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>{kk === 'sin' ? '' : horaUltima(f.ultimo_ok)}</span><Pill k={kk} /></div> })}
        </div>}
        <div style={{ fontSize: 11, color: C.muted }}>«Sin conectar» es decisión de la persona y no genera avisos; «Atrasado», «Falló» y «Reconectar» sí.</div>
      </div>}
    </div>
  )
}
