-- Reporte de cierre de tareas (limited debe reportar la gestión al terminar).
-- completed_at ya existe. Correr en el SQL Editor de Supabase ANTES de que Martín/Martina cierren tareas.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_note   text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_status text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_by      text;
NOTIFY pgrst, 'reload schema';
