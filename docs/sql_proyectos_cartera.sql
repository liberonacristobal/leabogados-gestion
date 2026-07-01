-- Panel de Cartera — proyectos activos con estado, etapa, tema abierto y última actividad. Correr una vez.
-- Enlaza a una venta (sale_id) cuando nace de Ventas; deriva cliente/responsable de ahí. Manual si sale_id es null.
-- prioridad_score y el label de etapa NO se guardan (se calculan en vivo en el front). Solo etapa_idx.
create table proyectos_cartera (
  id                uuid primary key default gen_random_uuid(),
  sale_id           text,                        -- venta enlazada (null = proyecto manual)
  cliente_id        text,                        -- clients.id (mismo criterio que plazos.client_id)
  nombre_proyecto   text,
  estado            text default 'verde',        -- rojo | ambar | verde (editable; carteraEstadoAuto sugiere)
  etapa_idx         int  default 0,              -- 0..5 index en ETAPAS_CARTERA
  plazo             date,
  plazo_label       text,                        -- descripción del próximo hito
  responsable       text,                        -- CL | EE | MC | MP | RD
  nota              text,                        -- "en qué está / tema abierto" (protagonista de la fila)
  alcance           text,                        -- resumen del alcance leído de la propuesta con IA (Fase 2A)
  ultima_actividad  date,                        -- última acción; ordena "sin mover" + "hace X días"
  drive_folder_id   text,                        -- Fase 2 (dejar listo, no se usa aún)
  origen            text default 'manual',       -- manual | venta
  activo            boolean default true,         -- false = archivado (sale del panel sin borrar)
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
grant all on table proyectos_cartera to authenticated, service_role;
alter table proyectos_cartera enable row level security;
create policy team_all on proyectos_cartera for all to authenticated
  using ((auth.jwt() ->> 'email') like '%@leabogados.cl')
  with check ((auth.jwt() ->> 'email') like '%@leabogados.cl');
notify pgrst, 'reload schema';

-- Si YA corriste el create arriba (tabla existente), corre SOLO esta línea para agregar el alcance (Fase 2A):
-- ALTER TABLE proyectos_cartera ADD COLUMN IF NOT EXISTS alcance text; NOTIFY pgrst, 'reload schema';
