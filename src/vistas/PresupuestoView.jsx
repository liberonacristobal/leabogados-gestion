// Presupuesto anual (año siguiente) — se trabaja por etapas y se guarda solo: borrador automático + versiones con nombre (una «oficial»).
// Etapas: 1 Resultado del año en curso, 2 Base, 3 Costos, 4 Metas (se escribe la meta de un componente y los demás se proyectan), 5 Escenarios (resultado, impuesto y por socio), 6 Seguimiento.
// Reglas puras en supabase/functions/_shared/presupuesto.js; datos de partida en lib/presupuestoDatos.js (cada cifra de su fuente única).
import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, useIsDesktop, appConfirm } from '../lib/base.jsx'
import { PageHeader, usePorFacturar, useArrastrePresupuesto } from '../lib/compartido.jsx'
import { usePresupuestoDatos } from '../lib/presupuestoDatos.js'
import { escenariosDe, nombreEscenario, estadoInicial, modeloPresupuesto, resumenModelo, migrarEstado, desglosarCostos, duplicarEscenario, renombrarEscenario, eliminarEscenario, moverEscenario, NOMBRE_COT_EMPLEADOR, migrarRotuloCotEmpleador, ID_SUBARRIENDO, partidaSubarriendo, proyectarUF } from '../../supabase/functions/_shared/presupuesto.js'
import { CFG_PRESUPUESTO as CFG, aplicarConfigGuardada, leerConfigGuardada, configGuardada, configVigente } from '../lib/presupuestoCfg.js'
import { mm, pc, Btn, Fld, Titulo, EstilosPresupuesto, setMoneda, Menu, ChipBtn, Pasos, Ic, ResumenCascada } from '../lib/presupuestoUI.jsx'
import { vistaIdeal } from '../lib/presupuestoBloques.jsx'
import { Mirada, Base, Costos } from './presupuestoEtapas1.jsx'
import { Metas } from './presupuestoMetas.jsx'
import { fotoVivaSeguimiento } from './presupuestoSeguimientoTarjetas.jsx'
import { Escenarios, Seguimiento, vistaDrill, titulosDrill, descargarExcel } from './presupuestoEtapas2.jsx'

const scrollEl = () => (typeof document !== 'undefined' ? document.getElementById('main-scroll') : null)
const getY = () => { const e = scrollEl(); return e ? e.scrollTop : window.scrollY }
const setY = (y) => { const e = scrollEl(); if (e) e.scrollTop = y; else window.scrollTo(0, y) }
const hace = (t) => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'hace instantes' : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h` }
// cfgFoto = foto de la configuración con que se guardó la versión (migrarEstado no la conoce: se conserva aparte).
const filaAVersion = (r) => ({ id: r.id, nombre: r.nombre || 'Versión', nota: r.nota || '', estado: { ...migrarEstado(r.estado, undefined, 0, CFG), ...(r.estado && r.estado.cfgFoto ? { cfgFoto: r.estado.cfgFoto } : {}) }, resumen: r.resumen || null, oficial: !!r.oficial, created_at: r.created_at, creado_por: r.creado_por || '' })

export function PresupuestoView({ sales = [], billing = [], terceros = [], costosOfiRows = [], expenses = [], clients = [], anticipos = [], clientEntities = [], fantasmaIds = null, user, esAdmin = false, onBack, backLabel = 'Oficina', onOpenPorFacturar, onOpenSocios, onOpenBanco, onOpenSale }) {
  const D = useIsDesktop()
  const [anioSel, setAnioSel] = useState(null)
  const datos = usePresupuestoDatos({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos, anioSel })
  const porFacturar = usePorFacturar({ billing, sales, clients, clientEntities, anticipos, fantasmaIds }).grupos.vigente.m
  const anio = datos.anio
  const [est, setEst] = useState(null)
  // UF proyectada de cada mes del año del presupuesto (la misma del modelo: UF de cierre del año base y reajuste del estado): valoriza en UF lo que se vendió en UF.
  const ufMes = useMemo(() => (est && datos.base && datos.base.ufDic > 0 ? Array.from({ length: 12 }, (_, i) => proyectarUF(datos.base.ufDic, est.reajusteUF, i)) : null), [datos.base, est && est.reajusteUF])   // eslint-disable-line react-hooks/exhaustive-deps
  const arrastre = useArrastrePresupuesto({ billing, sales, clients, clientEntities, anticipos, terceros, costosOfiRows, expenses, fantasmaIds, anioBase: datos.anioBase, ajustes: est ? est.arrastre : null, ufMes })   // paso 2: líneas de la app + los ajustes del borrador (una sola función, _shared/arrastreAnio.js)
  const [vers, setVers] = useState([])
  const [cargado, setCargado] = useState(false)
  const [espera, setEspera] = useState(false)
  const [guardado, setGuardado] = useState({ est: 'cargando', t: null })
  const [ui, setUIS] = useState({ etapa: 0, tab: 'res', alt: 'A', vm: 'tarjetas', mas: false, sm: 'a', abierta: null, vx: null, confirma: null })
  const [drill, setDrill] = useState(null)
  const [pila, setPila] = useState([])
  // H05: si falla la LECTURA del borrador no se crea un estado inicial ni se autoguarda (insertaría un borrador paralelo): se muestra el error y se bloquea el guardado hasta reintentar.
  const raiz = useRef(null), iniPend = useRef(null)
  const [cfgDe, setCfgDe] = useState(null), [, setCfgTick] = useState(0)   // nombre de la versión cuya configuración se está viendo (null = la vigente)
  useEffect(() => { const el = raiz.current; if (el) el.querySelectorAll('[role=button]:not([tabindex])').forEach((n) => { n.setAttribute('tabindex', '0'); n.classList.add('pp-foco') }) })
  const [errorCarga, setErrorCarga] = useState(false), [reintento, setReintento] = useState(0)
  const lastJSON = useRef(''), tmr = useRef(null), borradorId = useRef(null), enVuelo = useRef(false), estRef = useRef(null)
  const setUI = (patch) => setUIS((u) => ({ ...u, ...patch }))
  estRef.current = est

  // ── Carga: borrador y versiones del año ──
  useEffect(() => {
    let vivo = true
    clearTimeout(tmr.current); setCargado(false); setErrorCarga(false); setEst(null); setEspera(false); setPila([]); setDrill(null); setUI({ etapa: 0, vx: null, confirma: null })
    const t = setTimeout(() => { if (vivo) setEspera(true) }, 1500)
    ;(async () => {
      try {
        // La configuración guardada del estudio (solo administradores) se aplica ANTES de crear o leer nada: si falla la lectura, no se crea estado alguno.
        if (esAdmin) { aplicarConfigGuardada(await leerConfigGuardada()); setCfgDe(null) }
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
        // Un borrador de formato anterior se migra y queda pendiente de guardar (lastJSON conserva el original para que el autoguardado lo escriba).
        if (borr) { const e = migrarEstado(borr.estado, anio, datos.ppmMes * 12, CFG); lastJSON.current = borr.estado?.v === 6 ? JSON.stringify(e) : JSON.stringify(borr.estado); setEst(e); setGuardado({ est: DEMO ? 'local' : 'ok', t: borr.updated_at ? Date.parse(borr.updated_at) : null }) }
        else setGuardado({ est: DEMO ? 'local' : 'ok', t: null })
        setCargado(true)
      } catch (e) { if (vivo) { setErrorCarga(true); setGuardado({ est: 'error', t: null }) } }
    })()
    return () => { vivo = false; clearTimeout(t) }
  }, [anio, reintento])

  // Sin borrador: estado inicial con los costos vigentes y los datos reales del año anterior (cuando ya cargaron, o tras una breve espera).
  useEffect(() => {
    if (!cargado || errorCarga || est || !(datos.terc != null || espera || DEMO)) return
    const p = iniPend.current
    if (p) { iniPend.current = null; setEst(construirInicial(p)); setUIS((u) => ({ ...u, etapa: p.etapa })); return }
    setEst(estadoInicial({ costos: datos.costos, terc: datos.terc, dias: datos.dias.promedio, anio, ppmMes: datos.ppmMes, cfg: CFG }))
  }, [cargado, est, datos.terc, espera, datos.costos, datos.dias.promedio, anio, datos.ppmMes])

  // Un borrador anterior tiene Remuneraciones y Leyes sociales en una sola partida: se desglosan por persona repartiendo el mismo monto (el total no cambia).
  useEffect(() => {
    if (!est || !cargado || !datos.costos.length) return
    const nuevo = desglosarCostos(est.costos, datos.costos)
    if (nuevo.map((c) => c.id).join('|') !== est.costos.map((c) => c.id).join('|')) setEst((e) => (e ? { ...e, costos: desglosarCostos(e.costos, datos.costos) } : e))
  }, [est, cargado, datos.costos]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Autoguardado del borrador (1,5 s después del último cambio) ──
  const guardarBorrador = async () => {
    const e = estRef.current; if (!e || errorCarga) return
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
    if (!cargado || !est || errorCarga) return
    if (JSON.stringify(est) === lastJSON.current) return
    setGuardado((g) => (g.est === 'guardando' ? g : { ...g, est: 'pendiente' }))
    clearTimeout(tmr.current); tmr.current = setTimeout(guardarBorrador, 1500)
    return () => clearTimeout(tmr.current)
  }, [est, cargado]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cotización adicional del empleador (Ley 21.735): partida automática dentro de «Leyes sociales» (estimación). Editable; si se quita, no vuelve (est.sinCotEmpleador).
  useEffect(() => {
    if (est && cargado && !errorCarga && est.costos.some((c) => c.id === 'cot-empleador' && c.n === 'Cotización empleador (estimación)')) { setEst((e) => (e ? { ...e, costos: migrarRotuloCotEmpleador(e.costos) } : e)); return }
    if (!est || !cargado || errorCarga || est.sinCotEmpleador || !(datos.cotEmp.total > 0) || est.costos.some((c) => c.id === 'cot-empleador')) return
    setEst((e) => (e && !e.sinCotEmpleador && !e.costos.some((c) => c.id === 'cot-empleador') ? { ...e, costos: [...e.costos, { id: 'cot-empleador', n: NOMBRE_COT_EMPLEADOR, m: Math.round(datos.cotEmp.total / 12), meses: 12, t: 'fijo', alza: 0, g: CFG.costos.grupoLeyes, auto: true, sinBase: true }] } : e))
  }, [est, cargado, errorCarga, datos.cotEmp.total])  // eslint-disable-line react-hooks/exhaustive-deps
  // Subarriendo (partida negativa al final de Partidas): se agrega al abrir un borrador que no la tiene y que el usuario no quitó; así costosPresupuesto y toda la cadena quedan netos. Editable.
  useEffect(() => {
    if (!est || !cargado || errorCarga || est.sinSubarriendo || est.costos.some((c) => c.id === ID_SUBARRIENDO)) return
    const pa = partidaSubarriendo(datos.subarriendoAnual); if (!pa) return
    setEst((e) => (e && !e.sinSubarriendo && !e.costos.some((c) => c.id === ID_SUBARRIENDO) ? { ...e, costos: [...e.costos, pa] } : e))
  }, [est, cargado, errorCarga, datos.subarriendoAnual])  // eslint-disable-line react-hooks/exhaustive-deps
  // Un paso visitado queda marcado (sin botón de «revisado»).
  useEffect(() => { if (est && cargado && !errorCarga && !drill && !est.hecho.includes(ui.etapa)) setEst((e) => (e && !e.hecho.includes(ui.etapa) ? { ...e, hecho: [...e.hecho, ui.etapa] } : e)) }, [est, cargado, errorCarga, drill, ui.etapa])
  // ── Modelo ──
  // El resultado 2027 se muestra con el escenario de referencia a la altura de la meta (Ideal): una sola fuente para toda la vista (vistaIdeal, presupuestoBloques.jsx).
  const V = useMemo(() => (est ? vistaIdeal(datos, est) : null), [datos, est])
  const M = useMemo(() => (V ? modeloPresupuesto(datos.base, V.est) : null), [datos.base, V])
  const U = M ? M.ufMed : 1
  setMoneda({ moneda: est ? est.moneda : 'clp', uf27: M ? M.ufMed : 0, uf26: datos.uf26.med, unidad: CFG.moneda.unidad })   // formateador único (presupuestoUI): todo el dinero de los pasos y detalles lo sigue
  const ESC = est ? escenariosDe(est) : []
  const nomEsc = (k) => nombreEscenario(est, k)
  const tonoDe = (k) => ((est && est.escs) || []).find((e) => e.k === k)?.t ?? 0

  // ── Cambios del estado ──
  const parche = (fn) => setEst((e) => { const c = JSON.parse(JSON.stringify(e)); fn(c); return c })
  const setPal = (k, f, v) => parche((c) => { c.p[k][f] = v })
  const setGen = (f, v) => parche((c) => { c[f] = v })
  const setEsc = (k) => parche((c) => { c.esc = k })
  // Escenarios editables (funciones puras de _shared/presupuesto.js): crear duplicando, renombrar, eliminar (con confirmación) y reordenar.
  const duplicarEsc = (k) => setEst((e) => duplicarEscenario(e, k, CFG))
  const renombrarEsc = (k, n) => setEst((e) => renombrarEscenario(e, k, n))
  const moverEsc = (k, dir) => setEst((e) => moverEscenario(e, k, dir))
  const eliminarEsc = async (k) => { if (await appConfirm(`¿Eliminar el escenario «${nombreEscenario(estRef.current, k)}»?\nLas versiones guardadas conservan el suyo.`)) setEst((e) => eliminarEscenario(e, k)) }
  const setCosto = (i, f, v) => parche((c) => { c.costos[i][f] = v })
  const patchCosto = (i, o) => parche((c) => { Object.assign(c.costos[i], o) })
  const addCosto = () => { parche((c) => { c.costos.push({ id: Date.now(), n: 'Nueva partida', m: 0, meses: 12, t: 'fijo', alza: null }) }); setUI({ abierta: (est ? est.costos.length : 0), mats: [...(ui.mats || []), 'Nueva partida'] }) }
  const delCosto = (i) => { parche((c) => { if (c.costos[i] && c.costos[i].id === 'cot-empleador') c.sinCotEmpleador = true; if (c.costos[i] && c.costos[i].id === ID_SUBARRIENDO) c.sinSubarriendo = true; c.costos.splice(i, 1) }); setUI({ abierta: null }) }
  // Ajustes del Arrastre (st.arrastre): funciones puras de _shared/arrastreAnio.js; no tocan ventas, facturas ni cuotas reales.
  const setArrastre = (fn) => setEst((e) => (e ? { ...e, arrastre: fn(e.arrastre) } : e))
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
  const irEscTab = (tab) => ir({ etapa: 4, tab })

  // ── Versiones ──
  const MAX_VERSIONES = 6
  const guardarVersion = async (nombre, nota) => {
    const estado = { ...JSON.parse(JSON.stringify(est)), cfgFoto: configGuardada() }, resumen = { ...resumenModelo(M), seg: fotoVivaSeguimiento(X) }   // la foto del Seguimiento (Ideal, arrastre por mes, metas) viaja con la versión   // la versión congela la configuración vigente (foto) y se abre con ella
    if (vers.length >= MAX_VERSIONES) {
      // Tope de 6 (la oficial cuenta): se ofrece eliminar la más antigua que no sea oficial; la oficial nunca se elimina sin que se elija.
      const vieja = [...vers].filter((v) => !v.oficial).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0]
      if (!vieja) { await appConfirm(`Ya hay ${MAX_VERSIONES} versiones y todas son oficiales: elimina una desde Versiones antes de guardar otra.`); return }
      if (!(await appConfirm(`Ya hay ${MAX_VERSIONES} versiones guardadas (el máximo).\n¿Eliminar la más antigua que no es oficial, «${vieja.nombre}» (${String(vieja.created_at || '').slice(0, 10).split('-').reverse().join('-')}), para guardar esta?`))) return
      await borrarVersion(vieja)
    }
    try {
      let fila
      if (DEMO) { fila = { id: 'v' + Date.now(), nombre, nota, estado, resumen, oficial: false, created_at: new Date().toISOString(), creado_por: user?.name || '' }; const nv = [fila, ...vers]; localStorage.setItem('ppto_demo_v_' + anio, JSON.stringify(nv.map((v) => ({ ...v, tipo: 'version' })))) }
      else { const { data, error } = await supabase.from('presupuestos').insert({ anio, tipo: 'version', nombre, nota, estado, resumen, creado_por: user?.name || null }).select('*').single(); if (error) throw error; fila = data }
      setVers((v) => [filaAVersion(fila), ...v]); parche((c) => { c.basadaEn = fila.id }); setUI({ vx: fila.id, confirma: null })
    } catch (e) { setGuardado((g) => ({ ...g, est: 'error' })) }
  }
  // Una versión se abre con SU configuración (foto); «Usar la vigente» vuelve a la del estudio. El borrador usa siempre la vigente.
  const abrirVersion = (v) => {
    const { cfgFoto, ...resto } = v.estado || {}
    if (esAdmin && cfgFoto) { aplicarConfigGuardada(cfgFoto, false); setCfgDe(v.nombre) } else if (cfgDe) { aplicarConfigGuardada(configVigente()); setCfgDe(null) }
    setCfgTick((n) => n + 1); setEst({ ...migrarEstado(resto, anio, datos.ppmMes * 12, CFG), basadaEn: v.id }); setUI({ confirma: null })
  }
  const usarVigente = () => { aplicarConfigGuardada(configVigente()); setCfgDe(null); setCfgTick((n) => n + 1) }
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

  // R7 · «Preparar desde cero»: parte de lo ocurrido (la base de los últimos 12 meses y los costos vigentes), de una meta de retiros o vacío; con la reserva inicial editable. Reemplaza el borrador (con confirmación).
  const construirInicial = ({ modo, meta, reserva, anio: a }) => {
    const base = estadoInicial({ costos: modo === 'vacio' ? [] : datos.costos, terc: modo === 'vacio' ? null : datos.terc, dias: modo === 'vacio' ? null : datos.dias.promedio, anio: a || anio, ppmMes: datos.ppmMes, cfg: CFG, reservaIni: reserva > 0 ? reserva : undefined })
    if (modo === 'meta' && meta > 0) base.metas = { ancla: 'retiros', valor: meta, ratio: null }
    return base
  }
  const prepararDesdeCero = async (o) => {
    if (!(await appConfirm('Esto reemplaza el borrador del año elegido. Guárdalo antes como versión si lo necesitas. ¿Continuar?'))) return false
    const etapa = o.modo === 'vacio' ? 2 : o.modo === 'meta' ? 3 : 0
    if (o.anio && o.anio !== anio) { if (guardado.est === 'pendiente') await guardarBorrador(); iniPend.current = { ...o, etapa }; setAnioSel(o.anio); return true }   // el borrador nuevo se arma al cargar el otro año
    setEst(construirInicial(o)); setDrill(null); setPila([]); setUIS((u) => ({ ...u, etapa })); return true
  }
  const MT = V ? V.MT : null
  const X = { irAnio: (a) => { setDrill(null); setPila([]); setAnioSel(a) }, prepararDesdeCero, user, esAdmin, usarVigente, cfgDe, tickCfg: () => setCfgTick((n) => n + 1), D, datos, est: V ? V.est : est, M, MT, parche, patchCosto, onOpenSocios, onOpenBanco, U, ui, setUI, ir, irDrill, volver, nomEsc, tonoDe, cfg: CFG, ESC, duplicarEsc, renombrarEsc, eliminarEsc, moverEsc, setPal, setGen, setEsc, setCosto, addCosto, delCosto, resetCostos, vers, guardarVersion, abrirVersion, borrarVersion, marcarOficial,
    irEscTab, irEsc: irEscTab, irCostos: () => ir({ etapa: 2 }), irBase: () => ir({ etapa: 1 }), irMirada: () => ir({ etapa: 0 }), irMetas: () => ir({ etapa: 3 }), porFacturar, arrastre, setArrastre, cliNom: (id) => (clients.find((c) => String(c.id) === String(id)) || {}).name || 'Sin cliente', irPorFacturar: onOpenPorFacturar, onOpenSale }

  const ETAPAS = [`Resultado ${datos.anioBase}`, `Arrastre ${datos.anioBase}`, 'Costos', `Metas ${anio}`, 'Escenarios', 'Seguimiento']
  const origen = drill && drill.t === 'cfg' ? `Presupuesto ${anio}` : pila.length ? (pila[pila.length - 1].drill ? titulosDrill(X, pila[pila.length - 1].drill) : ETAPAS[pila[pila.length - 1].etapa]) : backLabel
  const estadoTxt = guardado.est === 'cargando' ? 'cargando…' : guardado.est === 'pendiente' ? 'cambios sin guardar' : guardado.est === 'guardando' ? 'guardando…' : guardado.est === 'error' ? 'no se pudo guardar' : (guardado.est === 'local' ? 'guardado solo en este equipo' : 'guardado') + (guardado.t ? ' · ' + hace(guardado.t) : '')
  const wrap = D ? { maxWidth: 1180, margin: '0 auto', padding: '8px 20px 20px' } : { padding: '8px 16px 40px' }

  if (errorCarga) return <div style={wrap}><PageHeader origen={backLabel} onBack={onBack} titulo={`Presupuesto ${anio}`} style={{ margin: D ? '-12px -20px 12px' : '-8px -16px 12px' }} /><div role='alert' style={{ margin: 16, background: C.overdueBg, border: `1px solid ${C.overdueBd}`, color: C.overdueText, borderRadius: 12, padding: '14px 16px', fontSize: 13 }}>No se pudo leer el borrador del presupuesto {anio}. No se guardó ni se creó nada.<div style={{ marginTop: 10 }}><Btn onClick={() => setReintento((n) => n + 1)}>Reintentar</Btn></div></div></div>
  if (!est || !M) return <div style={wrap} aria-busy='true'><PageHeader origen={backLabel} onBack={onBack} titulo={`Presupuesto ${anio}`} style={{ margin: D ? '-12px -20px 12px' : '-8px -16px 12px' }} /><div role='status' aria-label='Cargando el presupuesto' style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><div style={{ height: 52, borderRadius: 12, background: C.bgSoft }} /><div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? 3 : 2},minmax(0,1fr))`, gap: D ? 10 : 8 }}>{Array.from({ length: 6 }, (_, i) => <div key={i} style={{ height: D ? 174 : 112, borderRadius: 12, background: C.bgSoft, border: `1px solid ${C.border}` }} />)}</div><div style={{ fontSize: 12, color: C.muted }}>Cargando el presupuesto…</div></div></div>

  const e = M.esc[V.k], h = est.hecho.includes(ui.etapa)
  const cuerpo = drill ? vistaDrill(X, drill)
    : ui.etapa === 0 ? <Mirada X={X} /> : ui.etapa === 1 ? <Base X={X} /> : ui.etapa === 2 ? <Costos X={X} /> : ui.etapa === 3 ? <Metas X={X} /> : ui.etapa === 4 ? <Escenarios X={X} /> : <Seguimiento X={X} />
  const irEtapa = (i) => { setDrill(null); setUI({ etapa: i }); setY(0) }
  const estadoCorto = { cargando: 'cargando…', pendiente: 'sin guardar', guardando: 'guardando…', error: 'no se guardó', local: 'en este equipo', ok: 'guardado' }[guardado.est] || 'guardado'
  const MONEDAS = [['clp', CFG.moneda.nombres.clp], ['uf', CFG.moneda.nombres.uf], ['ambos', CFG.moneda.nombres.ambos]]
  const chipMoneda = <span style={{ border: `1px solid ${C.border}`, background: C.card, color: C.accent, fontWeight: 700, fontSize: 12, height: D ? 28 : 32, padding: '0 10px', borderRadius: 20, display: 'inline-flex', alignItems: 'center' }}><Menu aria='Moneda' derecha boton={est.moneda === 'uf' ? CFG.moneda.unidad : est.moneda === 'ambos' ? `${CFG.moneda.simbolo} · ${CFG.moneda.unidad}` : CFG.moneda.simbolo} opciones={MONEDAS} valor={est.moneda} onChange={(v) => setGen('moneda', v)} /></span>
  // H10: en las páginas de detalle solo queda la moneda (Versiones y Excel son del presupuesto, no del detalle). H01: en móvil, una sola fila de cabecera: moneda y «⋯» (Versiones · estado, Excel).
  const chipMas = <span style={{ border: `1px solid ${guardado.est === 'error' ? C.overdueBd : C.border}`, background: guardado.est === 'error' ? C.overdueBg : C.card, color: guardado.est === 'error' ? C.overdueText : C.accent, fontWeight: 800, fontSize: 16, height: 28, minWidth: 36, borderRadius: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Menu aria={`Más opciones · ${estadoTxt}`} derecha boton='⋯' opciones={[['ver', `Versiones · ${estadoCorto}`], ['xls', 'Descargar Excel']]} valor={null} onChange={(v) => { if (v === 'ver') ir({ drill: { t: 'ver' } }); else descargarExcel(X) }} /></span>
  const esCfg = !!drill && drill.t === 'cfg'   // N07: la moneda no actúa en Configuración
  const controles = <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{!esCfg && chipMoneda}{!drill && chipMas}</span>
  const controlesM = <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{!esCfg && chipMoneda}</span>   // móvil (alternativa D): año y moneda; Versiones y Excel van como texto bajo la cabecera
  const titulo = drill ? titulosDrill(X, drill) : <Menu aria='Año del presupuesto' boton={anio === datos.anioBase ? `Seguimiento ${datos.anioBase}` : `Presupuesto ${anio}`} opciones={[...[1, 2, 3].map((n) => [datos.anioBase + n, `Presupuesto ${datos.anioBase + n}`]), [datos.anioBase, `Seguimiento ${datos.anioBase}`], ['ini', 'Preparar desde cero…'], ...(esAdmin ? [['cfg', 'Configuración del presupuesto']] : [])]} valor={anio} onChange={async (a) => { if (a === 'cfg') { ir({ drill: { t: 'cfg' } }); return } if (a === 'ini') { ir({ drill: { t: 'ini' } }); return } if (a === anio) return; if (guardado.est === 'pendiente') await guardarBorrador(); setAnioSel(a) }} estilo={{ fontSize: 16, fontWeight: 800, color: C.accent, whiteSpace: 'nowrap' }} />

  // H18: «Revisado» y la nota viven junto al título del paso (la nota, como ícono con campo en línea y un punto si hay nota); abajo solo Anterior y Siguiente. Siguiente NO marca el paso como revisado.
  // La nota va como ícono junto a los pasos (con un punto si hay nota). «Revisado» ya no existe: un paso queda marcado (✓ y línea verde) cuando se VISITA; `est.hecho` guarda los pasos visitados.
  const hayNota = !!String(est.notas[ui.etapa] || '').trim()
  const accionesPaso = <button className='pp-tac' aria-label={hayNota ? 'Nota del paso (con nota)' : 'Nota del paso'} aria-expanded={!!ui.notaAbierta} onClick={() => setUI({ notaAbierta: !ui.notaAbierta })} style={{ position: 'relative', border: `1px solid ${C.border}`, background: C.card, color: C.accent, width: D ? 30 : 36, height: D ? 30 : 36, borderRadius: '50%', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0 }}><Ic n='doc' s={D ? 15 : 16} />{hayNota && <i aria-hidden='true' style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: C.accent, opacity: 0.55 }} />}</button>
  // H04: los role='button' sueltos de los pasos (acordeones, enlaces) reciben tabIndex y foco visible; Enter y Espacio los abren (los que ya traen tecla propia marcan defaultPrevented).
  const tecla = (ev) => { const t = ev.target; if (!ev.defaultPrevented && (ev.key === 'Enter' || ev.key === ' ') && t && t.getAttribute && t.getAttribute('role') === 'button' && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) { ev.preventDefault(); t.click() } }
  return <div ref={raiz} onKeyDown={tecla} style={{ ...wrap, display: 'flex', flexDirection: 'column', gap: D ? 10 : 14, boxSizing: 'border-box' }}>
    <EstilosPresupuesto />
    <PageHeader origen={D || drill ? origen : ''} onBack={volver} titulo={titulo} right={D ? controles : controlesM} style={{ margin: D ? '-12px -20px 0' : '-8px -16px 0' }} />
    {!D && !drill && <div style={{ fontSize: 12.5, color: guardado.est === 'error' ? C.overdueText : C.muted, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0 6px', marginTop: -6 }}>
      <span title={estadoTxt}>{{ cargando: 'Cargando…', pendiente: 'Sin guardar', guardando: 'Guardando…', error: 'No se guardó', local: 'Guardado en este equipo', ok: 'Guardado' }[guardado.est] || 'Guardado'}</span>·
      <span role='button' className='pp-tac' onClick={() => ir({ drill: { t: 'ver' } })} style={{ fontWeight: 700, color: C.accent, cursor: 'pointer', padding: '8px 2px', margin: '-8px 0' }}>Versiones ›</span>·
      <span role='button' className='pp-tac' onClick={() => descargarExcel(X)} style={{ fontWeight: 700, color: C.accent, cursor: 'pointer', padding: '8px 2px', margin: '-8px 0' }}>Excel</span></div>}
    {!drill && <Pasos nombres={ETAPAS} activa={ui.etapa} hechos={est.hecho} onIr={irEtapa} anioBase={datos.anioBase} anio={anio} acciones={accionesPaso} debajo={ui.notaAbierta ? <Fld text ph='Nota del paso' value={est.notas[ui.etapa] || ''} onCommit={(v) => parche((c) => { c.notas[ui.etapa] = v })} /> : null} />}
    {cfgDe && <div style={{ background: C.avisoBg, border: `1px solid ${C.avisoLine}`, color: C.avisoText, borderRadius: 12, padding: '10px 14px', fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><span>Se muestra con la configuración de la versión «{cfgDe}».</span><span role='button' onClick={usarVigente} style={{ cursor: 'pointer', fontWeight: 700, color: C.accent }}>Usar la vigente ›</span></div>}
    {!drill && ui.etapa === 4 && <ResumenCascada margen={mm(e.base)} resultado={mm(e.post)} retiros={mm(e.retiros)} esc='Ideal' onMargen={() => ir({ etapa: 4, tab: 'imp' })} onResultado={() => ir({ etapa: 4, tab: 'imp' })} onRetiros={() => ir({ drill: { t: 'socios' } })} />}
    {cuerpo}
    {!drill && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <Btn disabled={ui.etapa === 0} onClick={() => irEtapa(ui.etapa - 1)}>← Anterior</Btn>
      <Btn primary disabled={ui.etapa === 5} onClick={() => irEtapa(ui.etapa + 1)}>Siguiente →</Btn>
    </div>}
  </div>
}
void Titulo
