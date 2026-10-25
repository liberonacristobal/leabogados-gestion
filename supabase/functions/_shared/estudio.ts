// estudio.ts — dominio de correo del estudio para las funciones del servidor (quién puede llamar a una función con su sesión).
// Fuente única: secreto ESTUDIO_DOMINIO; sin él, el del estudio actual. Para otro estudio basta configurar el secreto.
export const DOMINIO_ESTUDIO = (Deno.env.get("ESTUDIO_DOMINIO") || "leabogados.cl").replace(/^@/, "").toLowerCase();
export const esDelDominio = (email: unknown) => String(email || "").trim().toLowerCase().endsWith("@" + DOMINIO_ESTUDIO);
