// usoIA.js — qué se registra de cada llamada a Claude (tabla ia_uso): solo cifras y procedencia, nunca el contenido.
// Funciones puras con prueba en tests/uso-ia.test.mjs; el envío a la tabla lo hace usoIA.ts.
const entero = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0 }

/** Tokens de la respuesta de la API (`usage`). «pensamiento» ya viene contado dentro de «salida». */
export function usoDe(data) {
  const u = data?.usage ?? {}
  return {
    entrada: entero(u.input_tokens), salida: entero(u.output_tokens),
    cache_lectura: entero(u.cache_read_input_tokens), cache_escritura: entero(u.cache_creation_input_tokens),
    pensamiento: entero(u.output_tokens_details?.thinking_tokens),
  }
}

/** Mensaje corto de la falla (p. ej. el tope de gasto alcanzado), o null si la llamada salió bien. */
export function errorDe(data, status) {
  const m = data?.error?.message
  if (m) return String(m).slice(0, 200)
  return status && (status < 200 || status > 299) ? `HTTP ${status}` : null
}

/** La vista o función que pide la llamada, sin caracteres raros ni largo desmedido. */
export function origenLimpio(s) {
  const t = String(s ?? '').replace(/[^\p{L}\p{N} .:_/-]/gu, '').trim().slice(0, 60)
  return t || null
}

/** La fila de ia_uso para una llamada. */
export function filaUso({ funcion, modelo, data, status, origen, usuario, maxTokens, estudioId }) {
  const error = errorDe(data, status)
  return {
    ...(estudioId ? { estudio_id: estudioId } : {}),
    funcion: String(funcion), modelo: String(modelo || data?.model || 'desconocido'), ...usoDe(data),
    origen: origenLimpio(origen), usuario: usuario ? String(usuario).toLowerCase().slice(0, 120) : null,
    max_tokens: maxTokens ? entero(maxTokens) : null, ok: !error, error,
  }
}
