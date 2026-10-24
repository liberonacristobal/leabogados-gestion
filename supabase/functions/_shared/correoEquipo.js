// Saludo de los correos internos al equipo (avisos, recordatorios, resúmenes): «Hola X» y abajo lo que se informa.
// Los correos a clientes y terceros abren con «Espero que estés/estén muy bien.» (no usan esto).
// miembros = filas {email, nombre}; un mismo nombre con dos direcciones (alias) se saluda una vez.
export function holaEquipo(emails, miembros) {
  const pila = []
  for (const e of emails || []) {
    const m = (miembros || []).find((x) => String(x.email || '').toLowerCase() === String(e || '').toLowerCase())
    const n = String(m?.nombre || String(e || '').split('@')[0]).trim().split(/\s+/)[0]
    if (n && !pila.includes(n)) pila.push(n)
  }
  const nombres = pila.length > 1 ? `${pila.slice(0, -1).join(', ')} y ${pila[pila.length - 1]}` : (pila[0] || '')
  return `Hola${nombres ? ' ' + nombres : ''}`
}
