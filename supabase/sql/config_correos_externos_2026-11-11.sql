-- Correos de personas externas fuera del código (2026-11-11). Reemplaza los <...> por las direcciones reales y córrelo en Supabase.
-- Dónde se leen: contadora_correo → Conciliación (leerValoresClaudia) y las funciones valores-contadora y liquidaciones-contadora;
-- notaria_email (learnings kind 'notaria_email', key 'dest', ya guardada por el equipo al enviar a la notaría; el default del código quedó vacío)
-- → Gastos, Carga masiva y agente-correo (que ya no trae el dominio de la notaría escrito: lo deriva de estas direcciones).

-- 1) Correo de la contadora (el remitente de los correos «VALORES» y «LIQUIDACIONES»).
delete from public.learnings where kind = 'config' and key = 'contadora_correo';
insert into public.learnings (kind, key, value, meta)
values ('config', 'contadora_correo', '<correo-de-la-contadora>', '{}');

-- 2) Correos de la notaría: solo si aún no hay una fila guardada (revisar primero: select * from public.learnings where kind = 'notaria_email').
insert into public.learnings (kind, key, value, meta)
select 'notaria_email', 'dest', '<correo1-de-la-notaria>, <correo2-de-la-notaria>', '{}'
where not exists (select 1 from public.learnings where kind = 'notaria_email');
