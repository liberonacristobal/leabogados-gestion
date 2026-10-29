// Reglas del aviso de gastos sin fondos (edge aviso-fondos). Funciones puras, con prueba en tests/.
export const UMBRAL_DEUDA = -1000   // mismo umbral que Rendir a clientes: un residuo de menos de $1.000 no se avisa
export const APP_DESDE_FONDOS = '2026-06-06'

// ¿Corresponde avisar? Saldo bajo el umbral y con al menos un gasto sin fondos dentro de la vida de la app (lo anterior es
// histórico importado: se ve en Rendir a clientes, no en un seguimiento cada 15 días).
export function avisoFondosAplica(saldo, gastosSinFondo = [], appDesde = APP_DESDE_FONDOS) {
  if (!(saldo <= UMBRAL_DEUDA)) return false
  return gastosSinFondo.some((g) => String(g?.date || '') >= appDesde)
}

// Número del aviso y último aviso: solo los avisos enviados de verdad (avisos_fondos) desde el último fondo.
export function contadorAvisos(historial = [], ultimoFondo = '', hoy = '9999-12-31') {
  const h = historial.filter((r) => String(r.fecha) > String(ultimoFondo || '') && String(r.fecha) < hoy).map((r) => String(r.fecha)).sort()
  return { n: h.length + 1, ultimo: h.length ? h[h.length - 1] : '' }
}

// ── Solicitud de fondos escrita en un correo enviado (la app la reconoce en los enviados de cada socio) ──
const _nrm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

// Monto en pesos escrito en un texto ($1.200.000, $ 300.000, 1.200.000 pesos): uno solo → ese; varios distintos → null (no se adivina).
export function montoDeTexto(txt) {
  const vistos = new Set();
  for (const m of String(txt || '').matchAll(/\$\s*(\d{1,3}(?:\.\d{3})+|\d{4,})|(\d{1,3}(?:\.\d{3})+)\s*(?:pesos|clp)\b/gi)) {
    const n = parseInt(String(m[1] || m[2]).replace(/\./g, ''), 10);
    if (n >= 5000 && n <= 500000000) vistos.add(n);
  }
  return vistos.size === 1 ? [...vistos][0] : null;
}

// Monto que se pide en el cuerpo de la solicitud. Un correo real trae varias cifras (gastos ya incurridos, subtotal, total): vale la
// que sigue a «transferir/depositar … $X» y, si no, «por un total/monto de $X»; cada frase decide solo si nombra una cifra única.
const _CIFRA = '\\$\\s*(\\d{1,3}(?:\\.\\d{3})+|\\d{4,})';
export function montoSolicitado(txt) {
  const t = String(txt || '');
  const cifras = (frag, v) => { for (const m of frag.matchAll(new RegExp(_CIFRA, 'g'))) { const n = parseInt(m[1].replace(/\./g, ''), 10); if (n >= 5000 && n <= 500000000) v.add(n); } };
  const unico = (re) => {
    const v = new Set();
    for (const m of t.matchAll(re)) cifras(m[1], v);
    return v.size === 1 ? [...v][0] : null;
  };
  return unico(/(?:transfer|deposit)\w*([^\n]{0,120})/gi)
    ?? unico(/por\s+(?:un\s+)?(?:total|monto|suma)\s+de\s+([^\n]{0,30})/gi)
    ?? montoDeTexto(t);
}

// Cliente de un correo: el único al que pertenecen los destinatarios (mapa correo → ids de cliente, de contactos y de correos de
// facturación aprendidos); sin destinatario conocido, el único cliente cuyo nombre aparece en el texto. Ambiguo o sin pista → null.
export function clienteDeCorreo(emails, texto, clients, mapa) {
  const ids = new Set();
  (emails || []).forEach((e) => (mapa.get(e) || []).forEach((id) => ids.add(String(id))));
  if (ids.size === 1) return [...ids][0];
  if (ids.size > 1) return null;
  const t = _nrm(texto);
  const hits = (clients || []).filter((c) => c.status !== 'Terminado' && !c.is_internal && _nrm(c.name).length >= 6 && t.includes(_nrm(c.name)));
  return hits.length === 1 ? String(hits[0].id) : null;
}
