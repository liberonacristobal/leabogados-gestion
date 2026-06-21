-- ============================================================================
-- Fixes de cifras — preparado 2026-06-21 (correr en Supabase SQL Editor)
-- Cada bloque trae SELECT de verificación primero. REVISA antes de cualquier UPDATE.
-- Nada borra en duro. Los duplicados NO se tocan en bloque (ver nota en §4).
-- Contexto: auditoría 2026-06-17 (ver memoria descuadres-pendientes).
-- ============================================================================


-- 1) FACTURAS "SIN AÑO" → persistir sale_year desde issued_at -----------------
-- La app YA deriva el año desde issued_at en código (anioVentaDe). Este UPDATE
-- solo lo persiste en la DB para otras consultas. Seguro y reversible.

-- 1a. Ver las que quedan sin año (Pagadas, sin venta con año ni sale_year):
SELECT b.id, b.invoice_no, b.issued_at, b.paid_at, b.amount, b.client_id
FROM billing b
WHERE b.sale_year IS NULL
  AND b.issued_at IS NOT NULL
  AND b.status = 'Pagado'
  AND b.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = b.sale_id AND s.year IS NOT NULL)
ORDER BY b.issued_at;

-- 1b. Rellenar el año desde issued_at:
UPDATE billing b
SET sale_year = EXTRACT(YEAR FROM b.issued_at)::int
WHERE b.sale_year IS NULL
  AND b.issued_at IS NOT NULL
  AND b.status = 'Pagado'
  AND b.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = b.sale_id AND s.year IS NOT NULL);


-- 2) paid_at con typo (año futuro) en F°212 y F°221 → 2025-12-20 --------------
-- Confirmado en auditoría: Consultora Better / Cristian Bustos, $107.310 c/u,
-- paid_at = 2026-12-20 (typo), debe ser 2025-12-20. No toca monto ni estado.

-- 2a. Verificar (ajusta el patrón si el invoice_no trae prefijo):
SELECT id, invoice_no, issued_at, paid_at, amount, status
FROM billing
WHERE invoice_no IN ('212','221','F°212','F°221');

-- 2b. Corregir SOLO si el SELECT confirma que son esas dos:
UPDATE billing
SET paid_at = '2025-12-20'
WHERE invoice_no IN ('212','221','F°212','F°221')
  AND paid_at > '2025-12-31';   -- candado: solo las de fecha futura


-- 3) uf_value negativo — YA RESUELTO (no debería haber filas) -----------------
-- El 2026-06-16 corriste `update sales set uf_value=abs(uf_value) where uf_value<0`.
-- La app además ahora ignora uf_value<=0 en ventaUF/ventaCLP (defensa extra).
-- Solo verificación (se espera 0 filas):
SELECT id, year, area, client_id, uf_value
FROM sales
WHERE uf_value IS NOT NULL AND uf_value <= 0;


-- 4) DUPLICADOS de facturas (≈21, ~$20,6M) — DETECCIÓN, NO BORRAR EN BLOQUE ---
-- OJO: la auditoría 2026-06-17 dejó claro que estos NO se pueden borrar en bloque.
-- Hay splits INTENCIONALES (Ariel F°318 → "negociación" + "Juicio cobro multa")
-- y pares Pagado+Pagado legítimos (Schroder 342/343, Tarragona 338/339).
-- Además el duplicado real es por string de folio ("318" vs "Factura 318"), no por
-- folio idéntico. → Revisar caso a caso. Esto es solo para LISTAR candidatos.

-- 4a. Folios que, normalizados (solo dígitos), aparecen >1 vez en el mismo cliente:
SELECT client_id,
       regexp_replace(coalesce(invoice_no,''), '\D', '', 'g') AS folio_num,
       COUNT(*) AS copias,
       array_agg(id ORDER BY created_at)        AS ids,
       array_agg(invoice_no ORDER BY created_at) AS folios,
       array_agg(status ORDER BY created_at)     AS estados,
       array_agg(amount ORDER BY created_at)     AS montos
FROM billing
WHERE deleted_at IS NULL AND status <> 'Anulada'
  AND regexp_replace(coalesce(invoice_no,''), '\D', '', 'g') <> ''
GROUP BY client_id, regexp_replace(coalesce(invoice_no,''), '\D', '', 'g')
HAVING COUNT(*) > 1
ORDER BY copias DESC;
-- Para cada grupo decide a mano: ¿duplicado real? → soft-delete la copia con
--   UPDATE billing SET deleted_at = now() WHERE id = '<id-de-la-copia>';
-- ¿split intencional o Pagado+Pagado legítimo? → DÉJALO.


-- 5) PROGRAMADAS FANTASMA (≈8, ~$9,46M) — detección -------------------------
-- Programadas en ventas NO recurrentes que ya tienen un Pagado del mismo monto
-- (el cobro ya ocurrió) → inflan el "por cobrar". Revisar y anular las confirmadas.

-- 5a. Programadas cuyo mismo sale_id tiene un Pagado por igual monto:
SELECT p.id, p.client_id, p.sale_id, p.due, p.amount, p.concept
FROM billing p
WHERE p.status = 'Programada' AND p.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM billing q
    WHERE q.sale_id = p.sale_id AND q.status = 'Pagado'
      AND q.deleted_at IS NULL AND coalesce(q.billing_type,'') <> 'reembolso'
      AND abs(q.amount - p.amount) < 1000
  )
ORDER BY p.due;

-- 5b. Anular las confirmadas (revisa 5a primero; anula por id):
-- UPDATE billing SET status = 'Anulada' WHERE id IN ('<id1>','<id2>', ...);

NOTIFY pgrst, 'reload schema';
