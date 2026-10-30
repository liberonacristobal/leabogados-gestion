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

// Monto escrito a la chilena en un pedido interno: «2M», «1,5M», «1.5 millones», «$2.000.000», «2.000.000». Un número suelto sin M ni
// separador de miles («2») no es un monto: no se adivina.
export function montoCorto(txt) {
  const t = String(txt || '').trim();
  let m = t.match(/^\$?\s*(\d+(?:[.,]\d+)?)\s*(?:mm|m|mill(?:ones|on|ón)?)\b/i);
  if (m) { const n = Math.round(parseFloat(m[1].replace(',', '.')) * 1e6); return n >= 5000 && n <= 500000000 ? n : null; }
  m = t.match(/^\$?\s*(\d{1,3}(?:\.\d{3})+|\d{4,})\b/);
  if (m) { const n = parseInt(m[1].replace(/\./g, ''), 10); return n >= 5000 && n <= 500000000 ? n : null; }
  return null;
}

// Pedido interno de fondos: líneas «- Cliente: concepto: monto» (viñeta opcional) de un correo entre el equipo. Una fila por línea;
// la línea que no calza se ignora. El cliente va como texto: quien lo registra confirma a cuál corresponde.
export function pedidosInternos(texto) {
  const out = [];
  String(texto || '').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^\s*(?:[-•*–]|\d+[.)])\s*(.+)$/);
    if (!m) return;
    const partes = m[1].split(':').map((x) => x.trim());
    if (partes.length < 3) return;
    const monto = montoCorto(partes[partes.length - 1]);
    const cliente = partes[0], concepto = partes.slice(1, -1).join(': ');
    if (monto && cliente && concepto) out.push({ cliente, concepto, monto });
  });
  return out;
}

// Respuesta del cliente que avisa que ya pagó: «ya transferido», «depositado», «transferí», «pagado» o un comprobante adjunto. Una negación
// cercana («aún no hemos transferido») no cuenta. Es solo una sugerencia: una persona la confirma.
export function confirmaPago(texto, nombresAdjuntos = []) {
  const t = _nrm(texto);
  if (/\b(no|aun no|todavia no|sin)\b[^.]{0,30}(transfer|deposit|pag)/.test(t)) return false;
  if (/transferid|transferi\b|transferimos|transfirio|depositad|deposite\b|depositamos|pagad|pago realizado|ya pague|ya pagamos|comprobante de (pago|transferencia|deposito)|adjunto comprobante/.test(t)) return true;
  return (nombresAdjuntos || []).some((n) => /comprobante/.test(_nrm(n)));
}

// Adjunto que es el formulario de fondos por rendir (Word o PDF): «Solicitud Fondos por Rendir <cliente>.docx».
export function esFormularioFondos(nombre) {
  const n = _nrm(nombre);
  return /\.(docx?|pdf)$/.test(n) && /fondos? por rendir|solicitud.*fondos/.test(n);
}

// Pedido interno que dio origen a una solicitud: mismo cliente y monto, anterior o del mismo día; si hay varios, el más reciente.
export function pedidoDeSolicitud(pedidos, sol) {
  return (pedidos || [])
    .filter((p) => String(p.client_id) === String(sol.client_id) && Number(p.monto) === Number(sol.monto) && String(p.fecha || '') <= String(sol.fecha || ''))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0] || null;
}

// Cliente de un pedido interno: el nombre escrito («Geslog») dentro del nombre de un cliente vigente, o al revés; solo si es uno.
export function clienteDePedido(txt, clients) {
  const p = _nrm(txt);
  if (p.length < 4) return null;
  const hits = (clients || []).filter((c) => c.status !== 'Terminado' && !c.is_internal && (() => { const n = _nrm(c.name); return n.length >= 4 && (n.includes(p) || (n.length >= 6 && p.includes(n))); })());
  return hits.length === 1 ? String(hits[0].id) : null;
}

// Cliente de un correo: el único al que pertenecen los destinatarios (mapa correo → ids de cliente, de contactos y de correos de
// facturación aprendidos); sin destinatario conocido, el único cliente cuyo nombre aparece en el texto. Ambiguo o sin pista → null.
export function clienteDeCorreo(emails, texto, clients, mapa) {
  const ids = new Set();
  (emails || []).forEach((e) => (mapa.get(e) || []).forEach((id) => ids.add(String(id))));
  if (ids.size === 1) return [...ids][0];
  if (ids.size > 1) return null;
  // El nombre se busca como palabras completas (≥5 letras): «Ohana» en «Sociedad Hotelera y Turística Ohana Limitada» calza; «Lopez» dentro de «Lopezia», no.
  const solo = (x) => ' ' + _nrm(x).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const t = solo(texto);
  const hits = (clients || []).filter((c) => c.status !== 'Terminado' && !c.is_internal && solo(c.name).trim().length >= 5 && t.includes(solo(c.name)));
  return hits.length === 1 ? String(hits[0].id) : null;
}
