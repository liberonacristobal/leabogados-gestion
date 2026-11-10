// Cargador de la configuración del Presupuesto por estudio (vendible por diseño). Mezcla, de menor a mayor prioridad: los valores por defecto del código
// (supabase/functions/_shared/presupuestoConfig.js), `BRAND.presupuesto` (la identidad del estudio, base.jsx) y la configuración GUARDADA por el estudio (tabla `presupuesto_config`,
// solo las diferencias respecto del defecto; solo administradores, con RLS en el servidor). CFG_PRESUPUESTO es UN objeto vivo: `aplicarConfigGuardada` lo reemplaza en su lugar, así
// todas las vistas que lo importan ven la configuración vigente sin cambiar sus importaciones.
import { BRAND } from './base.jsx'
import { configPresupuesto, mezclarConfig, diferenciaConfig, validarConfig } from '../../supabase/functions/_shared/presupuestoConfig.js'
import { supabase, DEMO } from '../supabase'

const marca = () => /** @type {any} */ (BRAND).presupuesto || {}
export const CFG_PRESUPUESTO = configPresupuesto(marca())
/** @type {any} */ let GUARDADA = {}, VIGENTE = {}   // GUARDADA = lo que rige ahora (puede ser la foto de una versión); VIGENTE = lo guardado del estudio
const ESTUDIO = () => /** @type {any} */ (BRAND).estudioId || 'lea'
const LS = () => 'ppto_cfg_demo_' + ESTUDIO()

/** Diferencias guardadas hoy (lo que el estudio cambió respecto del defecto). */
export const configGuardada = () => JSON.parse(JSON.stringify(GUARDADA))

/** Configuración guardada VIGENTE del estudio (solo diferencias), aunque se esté viendo la foto de una versión. */
export const configVigente = () => JSON.parse(JSON.stringify(VIGENTE))
/** La vigente, completa (defecto + marca + guardada): la base que edita la página de configuración. */
export const configVigenteCompleta = () => configPresupuesto(mezclarConfig(marca(), VIGENTE))

/** Pone en vigor una configuración guardada (solo diferencias); `null` = la del estudio sin cambios. Reemplaza el objeto vivo en su lugar. `esVigente` = false para la foto de una versión (no cambia lo guardado del estudio). @param {any} diff @param {boolean} [esVigente] */
export function aplicarConfigGuardada(diff, esVigente = true) {
  GUARDADA = diff && typeof diff === 'object' ? JSON.parse(JSON.stringify(diff)) : {}
  if (esVigente) VIGENTE = JSON.parse(JSON.stringify(GUARDADA))
  const nueva = /** @type {Record<string,any>} */ (configPresupuesto(mezclarConfig(marca(), GUARDADA)))
  const vivo = /** @type {Record<string,any>} */ (CFG_PRESUPUESTO)
  for (const k of Object.keys(vivo)) delete vivo[k]
  Object.assign(vivo, nueva)
}

/** Lee la configuración guardada del estudio (administradores). En demo, de localStorage. Devuelve las diferencias o lanza si falla la lectura. */
export async function leerConfigGuardada() {
  if (DEMO) { try { const t = localStorage.getItem(LS()); return t ? JSON.parse(t) : {} } catch { return {} } }
  const { data, error } = await supabase.from('presupuesto_config').select('config').eq('estudio_id', ESTUDIO()).maybeSingle()
  if (error) throw error
  return (data && data.config) || {}
}

/** Guarda solo las diferencias de `cfgCompleta` respecto del defecto. Valida antes; devuelve {ok, errores}. @param {any} cfgCompleta @param {string} [autor] */
export async function guardarConfig(cfgCompleta, autor) {
  const diff = diferenciaConfig(cfgCompleta)
  const v = validarConfig(diff)
  if (!v.ok) return { ok: false, errores: v.errores }
  if (DEMO) { try { localStorage.setItem(LS(), JSON.stringify(diff)) } catch { /* sin almacenamiento */ } }
  else { const { error } = await supabase.from('presupuesto_config').upsert({ estudio_id: ESTUDIO(), config: diff, updated_by: autor || null, updated_at: new Date().toISOString() }); if (error) return { ok: false, errores: [{ ruta: '', msg: 'No se pudo guardar: ' + (error.message || 'error') }] } }
  aplicarConfigGuardada(diff)
  return { ok: true, errores: [] }
}
