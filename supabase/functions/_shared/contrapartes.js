// Regla ÚNICA (app y servidor): el nombre que trae el banco para quien transfiere puede ser el de un SERVICIO de pagos del banco
// («NOMINA MISMO DIA PROVEEDORES», «PROVEEDORES MISMO DIA», «PAGO MASIVO»), no el del pagador. Ese nombre no identifica a
// nadie: no se aprende como alias ni sirve para sugerir un cliente; el pagador sale del RUT.
const _GEN = new Set(['nomina', 'nominas', 'mismo', 'dia', 'proveedores', 'proveedor', 'pago', 'pagos', 'masivo', 'masivos', 'masiva', 'lote',
  'transferencia', 'transferencias', 'remuneraciones', 'remuneracion', 'abono', 'abonos', 'cargo', 'empresa', 'empresas', 'banco', 'servicio',
  'servicios', 'electronico', 'electronica', 'en', 'linea', 'de', 'a', 'y', 'del', 'web', 'office', 'banking', 'tef', 'tef.', 'otros', 'bancos'])
const _norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
// true si el nombre está vacío o es solo palabras de servicios de pago del banco.
export function nombreGenerico(nombre) {
  const t = _norm(nombre).split(' ').filter(Boolean)
  return !t.length || t.every(w => _GEN.has(w) || /^\d+$/.test(w))
}
