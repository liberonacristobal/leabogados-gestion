// Tarjeta «Consumo de IA» de Procesos automáticos: gasto estimado del mes contra el tope y qué función lo explica (render X3muC58nousvwBj8EpC2y1, aprobado 08-11-2026).
// El cálculo es de _shared/costoIA.js (el mismo del aviso del resumen del lunes); el tope es learnings config 'ia_tope_mensual_usd'.
import { useState, useEffect, useMemo } from 'react'
import { supabase, selectAll, DEMO } from '../supabase'
import { C, fmtFechaDMY } from './base.jsx'
import { MES_L } from './compartido.jsx'
import { gastoDelMes, estadoTope } from '../../supabase/functions/_shared/costoIA.js'

const NOMBRES = { 'opinion-juridica': 'Opinión jurídica', 'vigilancia-sii': 'Vigilancia del SII', 'agente-correo': 'Agente de correo', 'notaria-documentos': 'Documentos de notaría', 'claude-proxy': 'Asistente de la app', 'gastos-trabajo-ia': 'Gastos con IA' }
const nombreFuncion = f => NOMBRES[f] || (String(f).charAt(0).toUpperCase() + String(f).slice(1).replace(/-/g, ' '))
const etiquetaModelo = m => { const r = /^claude-(opus|sonnet|haiku|fable)-(\d+)-(\d+)/.exec(String(m)); return r ? `${r[1].charAt(0).toUpperCase()}${r[1].slice(1)} ${r[2]}.${r[3]}` : String(m) }
const usd = n => 'US$ ' + (Number(n) || 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const miles = n => (Number(n) || 0).toLocaleString('es-CL')
const tokensCorto = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + ' mil' : String(Math.round(n))
const hoyCL = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())

// Datos de ejemplo del modo demo (ficticios).
const demoFilas = mes => [
  { dia: mes + '-02', funcion: 'opinion-juridica', modelo: 'claude-sonnet-5-5', llamadas: 640, fallas: 2, entrada: 3200000, salida: 150000 },
  { dia: mes + '-03', funcion: 'opinion-juridica', modelo: 'claude-opus-5-5', llamadas: 14, fallas: 0, entrada: 420000, salida: 90000 },
  { dia: mes + '-03', funcion: 'vigilancia-sii', modelo: 'claude-sonnet-5-5', llamadas: 30, fallas: 0, entrada: 110000, salida: 20000 },
  { dia: mes + '-04', funcion: 'agente-correo', modelo: 'claude-opus-4-8', llamadas: 55, fallas: 0, entrada: 50000, salida: 5000 },
  { dia: mes + '-04', funcion: 'claude-proxy', modelo: 'claude-opus-4-8', llamadas: 6, fallas: 0, entrada: 14000, salida: 2000 },
  { dia: mes + '-05', funcion: 'gastos-trabajo-ia', modelo: 'claude-opus-4-8', llamadas: 7, fallas: 0, entrada: 12000, salida: 3000 },
]

export function ConsumoIA() {
  const hoy = hoyCL(), mes = hoy.slice(0, 7)
  const [filas, setFilas] = useState(null), [tope, setTope] = useState(0)
  useEffect(() => { let on = true
    if (DEMO) { setFilas(demoFilas(mes)); setTope(50); return () => { on = false } }
    Promise.all([
      selectAll(() => supabase.from('ia_uso_diario').select('dia,funcion,origen,modelo,llamadas,fallas,entrada,salida,cache_lectura,cache_escritura').gte('dia', mes + '-01').order('dia').order('funcion').order('origen').order('modelo')),
      supabase.from('learnings').select('value').eq('kind', 'config').eq('key', 'ia_tope_mensual_usd'),
    ]).then(([a, b]) => { if (!on) return; setFilas(a.data || []); setTope(Number(b.data?.[0]?.value) || 0) }, () => { if (on) setFilas([]) })
    return () => { on = false } }, [mes])
  const g = useMemo(() => gastoDelMes(filas || [], mes), [filas, mes])
  const est = estadoTope(g.usd, tope)
  if (filas == null) return null
  const [y, m] = mes.split('-').map(Number), reinicio = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  const nivelC = est?.nivel === 'sobre' ? { bg: C.overdueBg, c: C.overdueText } : est?.nivel === 'cerca' ? { bg: C.soonBg, c: C.soonText } : { bg: C.bgSoft, c: C.accent }
  const top = g.porFuncion.slice(0, 3), resto = g.porFuncion.slice(3)
  const filasFn = [...top.map(f => ({ k: f.funcion, t: nombreFuncion(f.funcion), s: `${tokensCorto(f.tokens)} tokens · ${miles(f.llamadas)} llamadas`, fallas: f.fallas, usd: f.usd })),
    ...(resto.length ? [{ k: '_otras', t: `Otras ${resto.length} funciones`, s: `${tokensCorto(resto.reduce((a, f) => a + f.tokens, 0))} tokens · ${miles(resto.reduce((a, f) => a + f.llamadas, 0))} llamadas`, fallas: 0, usd: Math.round(resto.reduce((a, f) => a + f.usd, 0) * 100) / 100 }] : [])]
  const fila = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: `1px solid ${C.track}` }
  const t1 = { fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.25 }, t2 = { fontSize: 11, color: C.textSoft, lineHeight: 1.25 }
  const cifra = { fontSize: 13, fontWeight: 800, color: C.accent, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }
  return <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', margin: '12px 0' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: C.tealBg, color: C.tealText, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>IA</span>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>Consumo de IA</div><div style={t2}>{MES_L[m - 1]} · estimado</div></div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}><div style={{ ...cifra, color: C.tealText }}>{usd(g.usd)}</div>{est&&<div style={t2}>de {usd(est.tope)}</div>}</div>
    </div>
    {est&&<div style={{ ...fila, background: nivelC.bg }}>
      <div style={{ flex: 1, minWidth: 0 }}><div style={t1}>Queda hasta el tope</div><div style={t2}>se reinicia el {fmtFechaDMY(reinicio)}</div></div>
      <div style={{ ...cifra, color: nivelC.c }}>{usd(est.queda)}</div>
    </div>}
    {filasFn.map(f => <div key={f.k} style={fila}>
      <div style={{ flex: 1, minWidth: 0 }}><div style={t1}>{f.t}</div><div style={t2}>{f.s}{f.fallas > 0 && <> · <span style={{ color: C.overdueText }}>{f.fallas} con falla</span></>}</div></div>
      <div style={cifra}>{usd(f.usd)}</div>
    </div>)}
    {!filasFn.length && <div style={{ ...fila, ...t2 }}>Sin llamadas registradas este mes.</div>}
    <div style={{ ...fila, ...t2 }}>{g.sinPrecio.length ? `Sin precio de lista: ${g.sinPrecio.map(etiquetaModelo).join(', ')}` : 'Precios de lista; la consola puede mostrar más.'}</div>
  </div>
}
