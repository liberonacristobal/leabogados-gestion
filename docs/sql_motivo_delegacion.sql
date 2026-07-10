-- Motivo obligatorio al delegar una tarea. Correr en el SQL Editor de Supabase.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS delegated_note text;
NOTIFY pgrst, 'reload schema';
