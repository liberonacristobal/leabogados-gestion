-- Cableado multi-tenant (Fase datos): estudio_id en TODAS las tablas de negocio.
-- Aplicado en prod 2026-08-29 (migration estudio_id_cableado_tablas_faltantes).
-- NO toca RLS: sigue vigente la politica team_all (email @leabogados.cl). Es el paso
-- previo, seguro y no-destructivo, hacia RLS por estudio (Fase 3). El default
-- COALESCE(mi_estudio(),'lea') deja las filas existentes en el tenant #1 (LEA).
--
-- Estado a 2026-08-29: todas las tablas del schema public tienen estudio_id, salvo
-- 'estudios' (es la tabla de tenants: su PK 'id' ES el estudio, no lleva estudio_id).
-- Estas 4 eran las ultimas que faltaban.

ALTER TABLE public.clientes_drive_sync ADD COLUMN IF NOT EXISTS estudio_id text NOT NULL DEFAULT COALESCE(mi_estudio(), 'lea');
ALTER TABLE public.sii_avaluos       ADD COLUMN IF NOT EXISTS estudio_id text NOT NULL DEFAULT COALESCE(mi_estudio(), 'lea');
ALTER TABLE public.sii_novedades     ADD COLUMN IF NOT EXISTS estudio_id text NOT NULL DEFAULT COALESCE(mi_estudio(), 'lea');
ALTER TABLE public.vigilancia_rondas ADD COLUMN IF NOT EXISTS estudio_id text NOT NULL DEFAULT COALESCE(mi_estudio(), 'lea');

CREATE INDEX IF NOT EXISTS idx_clientes_drive_sync_estudio ON public.clientes_drive_sync(estudio_id);
CREATE INDEX IF NOT EXISTS idx_sii_avaluos_estudio        ON public.sii_avaluos(estudio_id);
CREATE INDEX IF NOT EXISTS idx_sii_novedades_estudio      ON public.sii_novedades(estudio_id);
CREATE INDEX IF NOT EXISTS idx_vigilancia_rondas_estudio  ON public.vigilancia_rondas(estudio_id);

NOTIFY pgrst, 'reload schema';

-- Verificacion (debe devolver 0 filas):
-- select t.table_name from information_schema.tables t
-- where t.table_schema='public' and t.table_type='BASE TABLE' and t.table_name<>'estudios'
-- and not exists (select 1 from information_schema.columns c
--   where c.table_schema='public' and c.table_name=t.table_name and c.column_name='estudio_id');
