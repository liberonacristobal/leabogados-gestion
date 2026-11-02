// Facturas del tercero: carga los documentos del SII de los proveedores y arma, con las reglas de _shared, lo que hay por revisar.
// Una sola fuente para la ficha del proveedor (Comisiones › Proveedores) y la fila «Facturas del tercero por revisar» de Facturación.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, selectAll, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { resumenTercero } from '../../supabase/functions/_shared/terceroFacturasReglas.js'
import { montoFactura, setLearningKV } from './compartido.jsx'

export const KIND_CUADRE_NO = 'tercero_cuadre_no'   // learnings: key = «documento|cuota», value = descartada
const _rut = r => String(r || '').toUpperCase().replace(/[^0-9K]/g, '')
const COLS = 'id,folio,tipo_dte,fecha_emision,emisor_rut,emisor_name,monto,proveedor_id,movimiento_id'

export function useTerceroFacturas({ terceros = [], billing = [], proveedores = null }) {
  const [provs, setProvs] = useState(proveedores || [])
  const [docs, setDocs] = useState([])
  const [descartes, setDescartes] = useState(() => new Set())
  const [cargando, setCargando] = useState(true)
  const hoy = useMemo(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }), [])

  useEffect(() => { if (proveedores) setProvs(proveedores) }, [proveedores])
  useEffect(() => {
    if (DEMO) { if (!proveedores) setProvs(demoData.proveedores || []); setDocs(demoData.sii_compras_docs || []); setCargando(false); return }
    if (proveedores && !proveedores.length) { setCargando(false); return }   // sin proveedores (o vista de solo lectura del miembro): nada que cargar
    let vivo = true
    ;(async () => {
      try {
        const [rp, rd, rl] = await Promise.all([
          proveedores ? Promise.resolve({ data: proveedores }) : supabase.from('proveedores').select('id,rut,nombre,razon_social'),
          selectAll(() => supabase.from('sii_compras_docs').select(COLS).in('tipo_dte', [33, 34]).not('proveedor_id', 'is', null).order('id')),
          supabase.from('learnings').select('key,value').eq('kind', KIND_CUADRE_NO)])
        if (!vivo) return
        if (!proveedores) setProvs(rp.data || [])
        let d = rd.data || []
        // Documentos de OTRO emisor con un folio que alguna cuota ya tiene escrito: para detectar «emisor distinto».
        const folios = [...new Set((terceros || []).flatMap(t => String(t.factura_numero || '').split(/[^0-9]+/).filter(Boolean)))]
        if (folios.length) {
          const ya = new Set(d.map(x => x.id))
          const { data: extra } = await selectAll(() => supabase.from('sii_compras_docs').select(COLS).in('tipo_dte', [33, 34]).in('folio', folios).order('id'))
          d = d.concat((extra || []).filter(x => !ya.has(x.id)))
        }
        if (!vivo) return
        setDocs(d); setDescartes(new Set((rl.data || []).filter(r => r.value === 'descartada').map(r => r.key)))
      } catch (_) { /* sin documentos: la sección queda vacía, no rompe */ }
      if (vivo) setCargando(false)
    })()
    return () => { vivo = false }
  }, [proveedores, terceros.length])   // eslint-disable-line react-hooks/exhaustive-deps

  // Solo proveedores con facturas del tercero en el SII (los de boleta de honorarios no entran).
  const porProveedor = useMemo(() => {
    const out = {}
    const rutsConDoc = new Set(docs.filter(d => d.proveedor_id != null).map(d => _rut(d.emisor_rut)))
    for (const p of provs) {
      if (!_rut(p.rut) || !rutsConDoc.has(_rut(p.rut))) continue
      out[String(p.id)] = resumenTercero({ docs, pagos: terceros, billing, proveedor: p, hoy, descartes, montoBill: montoFactura })
    }
    return out
  }, [provs, docs, terceros, billing, hoy, descartes])

  const total = useMemo(() => Object.values(porProveedor).reduce((a, r) => a + r.nRevisar, 0), [porProveedor])

  // «No es esa»: queda aprendido y no se vuelve a proponer ese documento para esa cuota.
  const descartar = useCallback(async (docId, pagoId) => {
    const k = `${docId}|${pagoId}`
    setDescartes(p => new Set([...p, k]))
    if (!DEMO) { try { await setLearningKV(KIND_CUADRE_NO, k, 'descartada') } catch (_) { /* se reintenta al volver a proponer */ } }
  }, [])

  return { porProveedor, total, docs, descartar, cargando, hoy }
}
