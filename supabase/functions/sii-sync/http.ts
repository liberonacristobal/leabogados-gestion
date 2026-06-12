// http.ts — utilidades de red para hablar con el SII: timeout duro por request
// y reintentos con backoff exponencial (los servidores del SII se caen seguido).

export async function fetchSII(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

// 3 intentos: 1s, 4s, 16s entre medio. Si todos fallan, error claro y arriba
// deciden que mostrar ("SII no disponible, intenta mas tarde").
export async function conReintentos<T>(paso: string, fn: () => Promise<T>, intentos = 3): Promise<T> {
  const esperas = [1000, 4000, 16000]
  let ultimo: unknown
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn()
    } catch (e) {
      ultimo = e
      console.log(`[sii-sync] ${paso}: intento ${i + 1}/${intentos} fallo: ${e instanceof Error ? e.message : e}`)
      if (i < intentos - 1) await new Promise(r => setTimeout(r, esperas[i]))
    }
  }
  throw new Error(`${paso}: SII no disponible tras ${intentos} intentos (${ultimo instanceof Error ? ultimo.message : ultimo})`)
}

export const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const xmlUnescape = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
