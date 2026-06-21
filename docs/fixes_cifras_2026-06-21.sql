-- ============================================================================
-- Fixes de cifras — preparado 2026-06-21 (correr en Supabase SQL Editor)
-- Cada bloque trae primero un SELECT de verificación. REVISA antes del UPDATE.
-- Nada acá borra en duro: los duplicados se retiran con soft-delete (deleted_at).
-- ============================================================================


-- 1) FACTURAS "SIN AÑO" → persistir sale_year desde issued_at -----------------
-- (La app YA deriva el año desde issued_at en código; este UPDATE lo persiste
--  en la DB para que también lo usen otras consultas. Opcional pero recomendado.)

-- 1a. Ver cuáles caen en "Sin año" (Pagadas, sin año de venta ni sale_year):
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


-- 2) paid_at con typo (futuro) en F°212 y F°221 → 2025-12-20 ------------------
-- 2a. Verificar (ajusta el patrón si el invoice_no trae prefijo tipo 'F°212'):
SELECT id, invoice_no, issued_at, paid_at, amount, status
FROM billing
WHERE invoice_no IN ('212','221','F°212','F°221');

-- 2b. Corregir SOLO si el SELECT confirma que son esas dos facturas:
UPDATE billing
SET paid_at = '2025-12-20'
WHERE invoice_no IN ('212','221','F°212','F°221')
  AND paid_at > '2025-12-31';   -- candado: solo las que tienen fecha futura/errada


-- 3) uf_value negativo en venta "Análisis tributario" ------------------------
-- (La app ya ignora uf_value<=0 en los cálculos; igual conviene limpiar el dato.)
-- 3a. Encontrar ventas con uf_value negativo o cero:
SELECT id, year, area, client_id, moneda, amount_uf, amount_clp, uf_value
FROM sales
WHERE uf_value < 0 OR uf_value = 0;

-- 3b. Opción A — dejar uf_value en NULL para que use la UF del día:
UPDATE sales SET uf_value = NULL WHERE uf_value <= 0;
-- 3b. Opción B — si conoces el valor correcto, ponlo a mano por id:
-- UPDATE sales SET uf_value = 37500 WHERE id = '<id-de-Análisis-tributario>';


-- 4) DUPLICADOS de facturas (≈21, ~$20,6M) ----------------------------------
-- No puedo ver los datos; acá va la DETECCIÓN. Revisa la lista y soft-deletea
-- las copias (NO la primera de cada grupo).
-- 4a. Grupos de facturas idénticas (mismo cliente, monto, emisión y folio):
SELECT client_id, invoice_no, issued_at, amount, COUNT(*) AS copias,
       array_agg(id ORDER BY created_at) AS ids
FROM billing
WHERE deleted_at IS NULL AND status <> 'Anulada'
GROUP BY client_id, invoice_no, issued_at, amount
HAVING COUNT(*) > 1
ORDER BY copias DESC, amount DESC;

-- 4b. Soft-delete de las copias (deja la más antigua de cada grupo):
-- Revisa 4a y corre esto SOLO si los grupos son realmente duplicados:
WITH dups AS (
  SELECT id, ROW_NUMBER() OVER (
           PARTITION BY client_id, invoice_no, issued_at, amount
           ORDER BY created_at
         ) AS rn
  FROM billing
  WHERE deleted_at IS NULL AND status <> 'Anulada'
)
UPDATE billing SET deleted_at = now()
WHERE id IN (SELECT id FROM dups WHERE rn > 1);


-- 5) PROGRAMADAS FANTASMA (≈8, ~$9,46M) -------------------------------------
-- 5a. Programadas duplicadas (misma venta, vencimiento y monto):
SELECT sale_id, due, amount, COUNT(*) AS copias,
       array_agg(id ORDER BY created_at) AS ids
FROM billing
WHERE status = 'Programada' AND deleted_at IS NULL
GROUP BY sale_id, due, amount
HAVING COUNT(*) > 1
ORDER BY copias DESC;

-- 5b. Programadas sin venta asociada (posibles fantasma) — revisar manualmente:
SELECT id, client_id, due, amount, concept
FROM billing
WHERE status = 'Programada' AND deleted_at IS NULL AND sale_id IS NULL
ORDER BY due;

-- 5c. Soft-delete de las copias de programadas (deja la más antigua):
WITH dprog AS (
  SELECT id, ROW_NUMBER() OVER (
           PARTITION BY sale_id, due, amount ORDER BY created_at
         ) AS rn
  FROM billing
  WHERE status = 'Programada' AND deleted_at IS NULL
)
UPDATE billing SET deleted_at = now()
WHERE id IN (SELECT id FROM dprog WHERE rn > 1);

NOTIFY pgrst, 'reload schema';
