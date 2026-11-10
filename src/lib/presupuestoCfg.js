// Cargador de la configuración del Presupuesto por estudio (vendible por diseño). Hoy lee `BRAND.presupuesto` (la identidad del estudio, base.jsx) si existe y, si no, los valores
// por defecto del tenant actual (supabase/functions/_shared/presupuestoConfig.js). Cuando haya una tabla de configuración por estudio, solo cambia de dónde sale este objeto.
import { BRAND } from './base.jsx'
import { configPresupuesto } from '../../supabase/functions/_shared/presupuestoConfig.js'

export const CFG_PRESUPUESTO = configPresupuesto(/** @type {any} */ (BRAND).presupuesto)
