// Configuración del presupuesto por estudio (solo administradores). Seis secciones plegadas con su cifra clave; los cambios se guardan solos (solo las diferencias respecto del defecto,
// tabla `presupuesto_config`; en demo, localStorage). Se valida antes de guardar: si hay errores se muestran por campo y no se guarda. Las versiones congelan una foto de lo vigente al guardarse.
import { useEffect, useRef, useState } from 'react'
import { C } from '../lib/base.jsx'
import { CFG_PRESUPUESTO as CFG, configVigenteCompleta, guardarConfig, sociosDelEstudio } from '../lib/presupuestoCfg.js'
import { diferenciaConfig, validarConfig, CONFIG_DEFECTO } from '../../supabase/functions/_shared/presupuestoConfig.js'
import { Pliegue, Panel, LBL, Btn, parseIn } from '../lib/presupuestoUI.jsx'

const clon = (/** @type {any} */ x) => JSON.parse(JSON.stringify(x))
/** Copia de `o` con `valor` puesto en la ruta `ruta` (arreglo de claves o índices). */
const poner = (/** @type {any} */ o, /** @type {(string|number)[]} */ ruta, /** @type {any} */ valor) => { const c = clon(o); let p = c; ruta.slice(0, -1).forEach((k) => { p = p[k] }); p[ruta[ruta.length - 1]] = valor; return c }
const num = (/** @type {number} */ n, d = 1) => Number(n).toLocaleString('es-CL', { maximumFractionDigits: d })

/** Campo de texto o número: confirma al salir o con Enter; sin confirmar no cambia nada. */
export function Campo({ label, value, onCommit, num: esNum, suf, error }) {
  const [t, setT] = useState(String(value ?? ''))
  useEffect(() => { setT(String(value ?? '').replace('.', esNum ? ',' : '.')) }, [value, esNum])
  const fin = () => { if (esNum) { const x = parseIn(t); if (Number.isFinite(x)) onCommit(x); else setT(String(value ?? '').replace('.', ',')) } else if (t !== value) onCommit(t) }
  return <label style={{ display: 'block', minWidth: 0 }}>
    <span title={label} style={{ ...LBL, color: C.accent, fontSize: 11, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}><input value={t} onChange={(e) => setT(e.target.value)} onBlur={fin} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }} inputMode={esNum ? 'decimal' : 'text'} aria-invalid={!!error}
      style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', height: 44, padding: '0 10px', background: C.bgSoft, border: `1px solid ${error ? C.overdue : C.border}`, borderRadius: 8, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, color: C.text, outline: 'none', textAlign: esNum ? 'right' : 'left' }} />{suf && <span style={{ color: C.muted, fontSize: 12 }}>{suf}</span>}</span>
    {error && <span style={{ color: C.overdueText, fontSize: 12 }}>{error}</span>}
  </label>
}
const Rejilla = ({ children, cols = 2 }) => <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap: 12 }}>{children}</div>
const Cuerpo = ({ children }) => <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
const Link = ({ onClick, children, rojo }) => <span role='button' onClick={onClick} style={{ cursor: 'pointer', fontWeight: 700, fontSize: 12, color: rojo ? C.overdueText : C.accent }}>{children}</span>

export function DCfg({ X }) {
  const { D, user, usarVigente, cfgDe } = X
  const [cfg, setCfg] = useState(() => configVigenteCompleta())
  const [estado, setEstado] = useState({ est: 'ok', errores: /** @type {{ruta:string,msg:string}[]} */ ([]) })
  const primera = useRef(true), tmr = useRef(/** @type {any} */ (null))
  useEffect(() => { if (cfgDe) usarVigente() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const err = (/** @type {string} */ ruta) => (estado.errores.find((x) => x.ruta === ruta) || {}).msg
  const cambia = (/** @type {(string|number)[]} */ ruta, /** @type {any} */ v) => setCfg((c) => poner(c, ruta, v))
  useEffect(() => {
    if (primera.current) { primera.current = false; return }
    const v = validarConfig(diferenciaConfig(cfg))
    if (!v.ok) { setEstado({ est: 'error', errores: v.errores }); return }
    setEstado({ est: 'pendiente', errores: [] }); clearTimeout(tmr.current)
    tmr.current = setTimeout(async () => { const r = await guardarConfig(cfg, user?.name); setEstado(r.ok ? { est: 'ok', errores: [] } : { est: 'error', errores: r.errores }); if (r.ok) X.tickCfg() }, 900)
    return () => clearTimeout(tmr.current)
  }, [cfg])  // eslint-disable-line react-hooks/exhaustive-deps
  const t = cfg.tributario, soc = Array.isArray(cfg.socios.lista) && cfg.socios.lista.length ? cfg.socios.lista : sociosDelEstudio(), iguales = cfg.socios.reparto === 'iguales'
  const reparto = iguales ? Object.fromEntries(soc.map((s) => [s, 1 / soc.length])) : cfg.socios.reparto
  const sec = (/** @type {string} */ tit, /** @type {any} */ clave, /** @type {any} */ cuerpo) => <Pliegue key={tit} t={tit} v={clave}><Cuerpo>{cuerpo}</Cuerpo></Pliegue>
  const tramo = (/** @type {string} */ ruta, /** @type {any[]} */ lista, /** @type {(string|number)[]} */ base, /** @type {{k:string,l:string}[]} */ campos) => <div>
    {lista.map((x, i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: `repeat(${campos.length + 1},minmax(0,1fr))`, gap: 10, alignItems: 'end', padding: '6px 0', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
      {campos.map((f) => f.k === 'hasta' && i === lista.length - 1 ? <div key={f.k} style={{ fontSize: 12, color: C.muted, paddingBottom: 10 }}>desde el año siguiente</div> : <Campo key={f.k} label={f.l} num value={x[f.k] ?? ''} error={err(`${ruta}.${i}.${f.k}`)} onCommit={(v) => cambia([...base, i, f.k], v)} />)}
      <div style={{ paddingBottom: 10 }}>{lista.length > 1 && <Link rojo onClick={() => { const n = clon(lista); n.splice(i, 1); if (n.length && i === lista.length - 1) delete n[n.length - 1].hasta; cambia(base, n) }}>Quitar</Link>}</div></div>)}
    <div style={{ paddingTop: 8 }}><Link onClick={() => { const n = clon(lista), ult = n[n.length - 1], nuevo = { ...ult, hasta: (Number(n[n.length - 2]?.hasta) || 2027) + 1 }; n.splice(n.length - 1, 0, nuevo); cambia(base, n) }}>+ Agregar tramo</Link></div></div>
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760, margin: '0 auto', width: '100%' }}>
    <div style={{ fontSize: 13, color: C.muted }}>Ajustes del estudio: rigen para todos los presupuestos. Los cambios se guardan solos; solo se guarda lo que difiere de los valores de partida. Las versiones guardadas conservan la configuración con que se guardaron.</div>
    {sec('Régimen e impuestos', `${t.regimen} · ${num(t.idpc[0].tasa)} %`, <>
      <Rejilla><Campo label='Régimen' value={t.regimen} error={err('tributario.regimen')} onCommit={(v) => cambia(['tributario', 'regimen'], v)} /><Campo label='Etiqueta en pantalla' value={t.etiqueta} error={err('tributario.etiqueta')} onCommit={(v) => cambia(['tributario', 'etiqueta'], v)} /></Rejilla>
      <Rejilla cols={D ? 3 : 2}>{[['pagoMensual', 'Pago mensual'], ['formulario', 'Formulario'], ['mesAnual', 'Mes de la declaración anual'], ['impuestoIndirecto', 'Impuesto indirecto'], ['retenciones', 'Retenciones']].map(([k, l]) => <Campo key={k} label={l} value={t.textos[k]} error={err(`tributario.textos.${k}`)} onCommit={(v) => cambia(['tributario', 'textos', k], v)} />)}</Rejilla>
      <div><div style={{ ...LBL, color: C.accent, marginBottom: 4 }}>Tasa de primera categoría por año</div>{tramo('tributario.idpc', t.idpc, ['tributario', 'idpc'], [{ k: 'hasta', l: 'Hasta el año' }, { k: 'tasa', l: 'Tasa %' }])}</div>
      <Campo label='Umbral del pago mensual (ingresos del año anterior)' num suf={cfg.moneda.unidad} value={t.ppm.umbralUF} error={err('tributario.ppm.umbralUF')} onCommit={(v) => cambia(['tributario', 'ppm', 'umbralUF'], v)} />
      <div><div style={{ ...LBL, color: C.accent, marginBottom: 4 }}>Tasa del pago mensual por año</div>{tramo('tributario.ppm.tramos', t.ppm.tramos, ['tributario', 'ppm', 'tramos'], [{ k: 'hasta', l: 'Hasta el año' }, { k: 'chica', l: 'Tasa menor %' }, { k: 'grande', l: 'Tasa mayor %' }])}</div>
      <div><Link onClick={() => setCfg((c) => ({ ...c, tributario: clon(CONFIG_DEFECTO.tributario) }))}>Restaurar valores de partida</Link></div></>)}
    {sec('Componentes de la meta', `${cfg.componentes.length} componentes`, <>
      <div style={{ fontSize: 12, color: C.muted }}>Los seis componentes de la cadena; se puede cambiar el nombre y en cuáles se escribe la meta.</div>
      {cfg.componentes.map((c, i) => <div key={c.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'end' }}><Campo label={`Nombre · ${c.k}`} value={c.n} error={err(`componentes.${i}.n`)} onCommit={(v) => cambia(['componentes', i, 'n'], v)} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, paddingBottom: 10, color: C.muted }}><input type='checkbox' checked={!!c.ancla} disabled={c.k === 'costos'} onChange={(e) => cambia(['componentes', i, 'ancla'], e.target.checked)} />se escribe la meta</label></div>)}
      <label style={{ display: 'block' }}><span style={{ ...LBL, color: C.accent, fontSize: 11 }}>Meta con la que se parte</span><select value={cfg.anclaInicial} onChange={(e) => cambia(['anclaInicial'], e.target.value)} style={{ display: 'block', width: '100%', height: 44, marginTop: 3, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bgSoft, fontFamily: 'inherit', fontWeight: 700, padding: '0 8px' }}>{cfg.componentes.filter((c) => c.ancla).map((c) => <option key={c.k} value={c.k}>{c.n}</option>)}</select></label></>)}
    {sec('Escenarios de partida', `${cfg.escenarios.length} escenarios`, <>
      {cfg.escenarios.map((e, i) => <div key={e.k} style={{ borderTop: i ? `1px solid ${C.border}` : 'none', paddingTop: i ? 12 : 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Campo label={`Escenario · ${e.k}`} value={e.n} error={err(`escenarios.${i}.n`)} onCommit={(v) => cambia(['escenarios', i, 'n'], v)} />
        <Rejilla cols={D ? 4 : 2}>{[['g', 'Crecimiento %'], ['alza', 'Alza de costos %'], ['terc', 'Comisiones %'], ['dias', 'Días de cobro']].map(([k, l]) => <Campo key={k} label={l} num value={e.p[k]} error={err(`escenarios.${i}.p.${k}`)} onCommit={(v) => cambia(['escenarios', i, 'p', k], v)} />)}</Rejilla></div>)}
      <label style={{ display: 'block' }}><span style={{ ...LBL, color: C.accent, fontSize: 11 }}>Escenario que usan las metas</span><select value={cfg.escenarioMetas} onChange={(e) => cambia(['escenarioMetas'], e.target.value)} style={{ display: 'block', width: '100%', height: 44, marginTop: 3, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bgSoft, fontFamily: 'inherit', fontWeight: 700, padding: '0 8px' }}>{cfg.escenarios.map((e) => <option key={e.k} value={e.k}>{e.n}</option>)}</select></label></>)}
    {sec('Reserva y socios', `Reserva ${num(cfg.reserva.porcentaje)} %`, <>
      <Rejilla cols={D ? 4 : 2}><Campo label='Reserva en cuenta corriente' num value={cfg.reserva.minima} error={err('reserva.minima')} onCommit={(v) => cambia(['reserva', 'minima'], v)} /><Campo label='Aumento de reserva (% del resultado)' num value={cfg.reserva.porcentaje} error={err('reserva.porcentaje')} onCommit={(v) => cambia(['reserva', 'porcentaje'], v)} /><Campo label='Meses de costos a cubrir' num value={cfg.reserva.meses} error={err('reserva.meses')} onCommit={(v) => cambia(['reserva', 'meses'], v)} /><Campo label='Trimestres para llegar' num value={cfg.reserva.trimestres} error={err('reserva.trimestres')} onCommit={(v) => cambia(['reserva', 'trimestres'], v)} /></Rejilla>
      <Campo label='Socios del estudio (separados por coma; vacío = administradores de la app)' value={(cfg.socios.lista || []).join(', ')} error={err('socios.lista')} onCommit={(v) => cambia(['socios', 'lista'], v.split(',').map((x) => x.trim()).filter(Boolean).length ? v.split(',').map((x) => x.trim()).filter(Boolean) : null)} />
      <div><div style={{ ...LBL, color: C.accent, marginBottom: 6 }}>Reparto de las metas entre los socios</div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 8 }}><input type='checkbox' checked={iguales} onChange={(e) => cambia(['socios', 'reparto'], e.target.checked ? 'iguales' : Object.fromEntries(soc.map((s) => [s, Math.round(1000 / soc.length) / 1000])))} />Partes iguales</label>
        {!iguales && <Rejilla cols={D ? 3 : 2}>{soc.map((s) => <Campo key={s} label={`${s} %`} num value={Math.round((reparto[s] || 0) * 1000) / 10} onCommit={(v) => cambia(['socios', 'reparto', s], v / 100)} />)}</Rejilla>}
        {err('socios.reparto') && <div style={{ color: C.overdueText, fontSize: 12 }}>{err('socios.reparto')}</div>}</div></>)}
    {sec('Costos', `${cfg.costos.fijas.length} fijas`, <>
      <Campo label='Categorías fijas (separadas por coma)' value={cfg.costos.fijas.join(', ')} error={err('costos.fijas')} onCommit={(v) => cambia(['costos', 'fijas'], v.split(',').map((x) => x.trim()).filter(Boolean))} />
      <Campo label='Categorías por persona (separadas por coma)' value={cfg.costos.porPersona.join(', ')} error={err('costos.porPersona')} onCommit={(v) => cambia(['costos', 'porPersona'], v.split(',').map((x) => x.trim()).filter(Boolean))} />
      <Rejilla><Campo label='Grupo de sueldos' value={cfg.costos.grupoSueldos} onCommit={(v) => cambia(['costos', 'grupoSueldos'], v)} /><Campo label='Grupo de leyes sociales' value={cfg.costos.grupoLeyes} onCommit={(v) => cambia(['costos', 'grupoLeyes'], v)} /></Rejilla></>)}
    {sec('Cotización del empleador', `${num(cfg.previsional.empleador[cfg.previsional.empleador.length - 1]?.pct ?? 0)} % al final`, <>
      <div style={{ fontSize: 12, color: C.muted }}>Ley 21.735: aporte total del empleador sobre la remuneración imponible, por mes de vigencia (AAAA-MM). Con la lista vacía no se estima.</div>
      {cfg.previsional.empleador.map((x, i, l) => <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, alignItems: 'end', padding: '6px 0', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
        <Campo label='Desde (AAAA-MM)' value={x.desde} error={err(`previsional.empleador.${i}.desde`)} onCommit={(v) => cambia(['previsional', 'empleador', i, 'desde'], v)} />
        <Campo label='Aporte %' num value={x.pct} error={err(`previsional.empleador.${i}.pct`)} onCommit={(v) => cambia(['previsional', 'empleador', i, 'pct'], v)} />
        <div style={{ paddingBottom: 10 }}><Link rojo onClick={() => { const n = clon(l); n.splice(i, 1); cambia(['previsional', 'empleador'], n) }}>Quitar</Link></div></div>)}
      <div><Link onClick={() => { const n = clon(cfg.previsional.empleador), u = n[n.length - 1], [yy, mm0] = u ? u.desde.split('-').map(Number) : [new Date().getFullYear(), 1]; n.push({ desde: `${yy + 1}-${String(mm0).padStart(2, '0')}`, pct: u ? u.pct : 0 }); cambia(['previsional', 'empleador'], n) }}>+ Agregar tramo</Link></div>
      <div><Link onClick={() => setCfg((c) => ({ ...c, previsional: clon(CONFIG_DEFECTO.previsional) }))}>Restaurar valores de partida</Link></div></>)}
    {sec('Moneda', `${cfg.moneda.unidad} · ${num(cfg.moneda.reajusteAnual)} %`, <>
      <Rejilla cols={D ? 3 : 2}><Campo label='Símbolo' value={cfg.moneda.simbolo} error={err('moneda.simbolo')} onCommit={(v) => cambia(['moneda', 'simbolo'], v)} /><Campo label='Unidad reajustable' value={cfg.moneda.unidad} error={err('moneda.unidad')} onCommit={(v) => cambia(['moneda', 'unidad'], v)} /><Campo label='Reajuste anual de partida %' num value={cfg.moneda.reajusteAnual} error={err('moneda.reajusteAnual')} onCommit={(v) => cambia(['moneda', 'reajusteAnual'], v)} /></Rejilla>
      <Rejilla cols={3}>{[['clp', 'Nombre en pesos'], ['uf', 'Nombre en la unidad'], ['ambos', 'Nombre de ambas']].map(([k, l]) => <Campo key={k} label={l} value={cfg.moneda.nombres[k]} error={err(`moneda.nombres.${k}`)} onCommit={(v) => cambia(['moneda', 'nombres', k], v)} />)}</Rejilla></>)}
    <div role='status' style={{ fontSize: 12, color: estado.est === 'error' ? C.overdueText : C.muted }}>{estado.est === 'ok' ? 'guardado' : estado.est === 'pendiente' ? 'guardando…' : estado.errores.length ? `No se guardó: ${estado.errores.length} campo${estado.errores.length !== 1 ? 's' : ''} por corregir` : 'No se guardó'}</div>
  </div>
}

/** Asistente «Preparar desde cero»: se elige el punto de partida y el año; lo demás (costos, metas, escenarios) se edita en los pasos y la configuración ya construidos. */
export function DIni({ X }) {
  const { datos: d } = X
  const [modo, setModo] = useState(d.sinBase ? 'vacio' : 'ocurrido'), [anio, setAnio] = useState(d.anio), [meta, setMeta] = useState(0), [reserva, setReserva] = useState(CFG_RESERVA())
  const op = [['ocurrido', 'Lo ocurrido', `Base de los últimos 12 meses cerrados y los costos vigentes${d.sinBase ? ' (no hay facturas: la base queda en cero)' : ''}.`], ['meta', 'Una meta', 'Parte de una meta de retiros; los demás componentes se proyectan desde ella.'], ['vacio', 'Vacío', 'Sin costos ni historia: se arma todo en los pasos.']]
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760, margin: '0 auto', width: '100%' }}>
    <div style={{ fontSize: 13, color: C.muted }}>Elige cómo partir. Esto reemplaza el borrador del año elegido; las versiones guardadas no cambian.</div>
    <Panel>{op.map(([k, t, s2], i) => <label key={k} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 16px', borderTop: i ? `1px solid ${C.border}` : 'none', cursor: 'pointer', minHeight: 44 }}><input type='radio' name='ini' checked={modo === k} onChange={() => setModo(k)} style={{ marginTop: 3 }} /><span><b style={{ color: C.accent, fontSize: 14 }}>{t}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{s2}</span></span></label>)}</Panel>
    <div style={{ display: 'grid', gridTemplateColumns: X.D ? 'repeat(3,minmax(0,1fr))' : '1fr', gap: 12 }}>
      <label style={{ display: 'block' }}><span style={{ ...LBL, color: C.accent, fontSize: 11 }}>Año del presupuesto</span><select value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={{ display: 'block', width: '100%', height: 44, marginTop: 3, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bgSoft, fontFamily: 'inherit', fontWeight: 700, padding: '0 8px' }}>{[1, 2, 3].map((n) => <option key={n} value={d.anioBase + n}>{d.anioBase + n}</option>)}</select></label>
      {modo === 'meta' && <Campo label='Meta de retiros del año ($)' num value={meta} onCommit={(v) => setMeta(Math.max(0, v))} />}
      <Campo label='Reserva en cuenta corriente ($)' num value={reserva} onCommit={(v) => setReserva(Math.max(0, v))} />
    </div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Btn primary onClick={() => X.prepararDesdeCero({ modo, meta, reserva, anio })}>Crear borrador</Btn>{X.esAdmin && <Btn onClick={() => X.ir({ drill: { t: 'cfg' } })}>Configuración del presupuesto</Btn>}</div>
  </div>
}
const CFG_RESERVA = () => CFG.reserva.minima
