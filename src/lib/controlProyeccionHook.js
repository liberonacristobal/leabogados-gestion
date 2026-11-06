// Control de la proyección del flujo de caja (reglas en _shared/controlProyeccion.js): guarda cada semana la proyección y la compara, ya cerrada la
// semana, con lo cobrado por fecha del depósito (el mismo «Cobrado» de Inicio y del Panel). Se guarda en learnings: sin tabla nueva.
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, DEMO } from '../supabase'
import { registrarError, setLearningKV } from './compartido.jsx'
import { useResultadoAnio } from './resultadoAnio.js'
import { KIND_PROYECCION, controlProyeccion, instantanea, lunesDe } from '../../supabase/functions/_shared/controlProyeccion.js'

const hoyCL = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })

// Guarda la proyección de la semana la primera vez que se ve, cuando ya se estabilizó (los datos y las decisiones cargan en etapas): espera 5 s sin cambios.
export function useGuardarProyeccion(F) {
  const ref = useRef(F); ref.current = F
  const [hecho, setHecho] = useState(false)
  useEffect(() => {
    if (DEMO || hecho || !F || !F.weeks || !F.weeks.length || !(F.cobros && F.cobros.length)) return
    const t = setTimeout(async () => {
      try {
        const ini = lunesDe(hoyCL())
        const { data } = await supabase.from('learnings').select('key').eq('kind', KIND_PROYECCION).eq('key', ini).limit(1)
        if (data && data.length) { setHecho(true); return }
        await setLearningKV(KIND_PROYECCION, ini, JSON.stringify(instantanea(hoyCL(), ref.current.weeks[0].entra))); setHecho(true)
      } catch (e) { registrarError({ origen: 'accion', vista: 'flujo_proyeccion', err: e }) }
    }, 5000)
    return () => clearTimeout(t)
  }, [F, hecho])
}

export function useControlProyeccion({ F, sales, billing, terceros, costosOfiRows, expenses, clients, anticipos }) {
  const hoy = hoyCL()
  const R = useResultadoAnio({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos, selYear: Number(hoy.slice(0, 4)) })
  const cobros = useMemo(() => { const ing = R.ingresosPorAnioVenta || {}; return [...Object.values(ing.listByYear || {}).flat(), ...(ing.sinList || [])].filter(it => it && it.paid_at).map(it => ({ fecha: String(it.paid_at).slice(0, 10), monto: Number(it._cobrado) || 0 })) }, [R])
  const [snaps, setSnaps] = useState([])
  // En la demo se siembran dos semanas de ejemplo, cerca de lo cobrado en ellas, para mostrar el control.
  const demo = useMemo(() => { if (!DEMO) return null; const out = []
    for (let n = 1; n <= 12 && out.length < 2; n++) { const d = new Date(lunesDe(hoy) + 'T12:00:00'); d.setDate(d.getDate() - 7 * n); const ini = d.toISOString().slice(0, 10), fin = new Date(d.getTime() + 6 * 864e5).toISOString().slice(0, 10)
      const c = cobros.filter(x => x.fecha >= ini && x.fecha <= fin).reduce((a, x) => a + x.monto, 0); if (c > 0) out.push({ key: ini, value: instantanea(ini, c * (out.length ? 0.92 : 1.1)) }) }
    return out }, [cobros, hoy])
  useEffect(() => {
    if (DEMO) return
    let v = true
    supabase.from('learnings').select('key,value').eq('kind', KIND_PROYECCION).order('key', { ascending: false }).limit(12).then(({ data }) => { if (v) setSnaps(data || []) }, () => {})
    return () => { v = false }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => controlProyeccion({ snaps: DEMO ? (demo || []) : snaps, cobros, hoy }), [snaps, demo, cobros, hoy])
}
