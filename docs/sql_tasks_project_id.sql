-- Enlace firme tarea ↔ proyecto de Cartera. Correr una vez.
-- tasks.project_id apunta a proyectos_cartera.id (uuid). Las tareas antiguas quedan con null
-- (la app igual las asocia por cliente+nombre como respaldo); las nuevas creadas desde un
-- proyecto guardan el project_id firme.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id uuid;
CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON tasks (project_id);
NOTIFY pgrst, 'reload schema';
