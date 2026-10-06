-- PMO · Fase 1 (bloque tablero) — etapa de cada entregable, para el tablero con arrastre.
-- Columna nullable: los entregables sin etapa caen en "Por asignar". No destructivo.
ALTER TABLE proyecto_entregables ADD COLUMN IF NOT EXISTS etapa_idx int;
NOTIFY pgrst, 'reload schema';
