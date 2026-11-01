// Lista de clientes para los prompts de IA: un número corto por cliente en vez de su UUID (36 caracteres, muy caro en tokens).
// La IA responde con el número y `idDe` lo devuelve al id real; un número fuera de la lista da null (no se puede inventar un cliente).
export function listaClientesIA(clients) {
  const activos = (clients || []).filter((c) => c && c.status !== 'Terminado' && c.name);
  const ids = activos.map((c) => c.id);
  const texto = activos.map((c, i) => `${i + 1}|${String(c.name).replace(/\s+/g, ' ').trim()}`).join('\n');
  const idDe = (n) => {
    const k = Number(n);
    return Number.isInteger(k) && k >= 1 && k <= ids.length ? ids[k - 1] : null;
  };
  return { texto, idDe };
}
