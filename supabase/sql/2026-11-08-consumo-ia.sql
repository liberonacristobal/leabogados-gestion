-- Consumo de IA contra el tope del mes: la vista diaria trae también la escritura de caché (costo exacto) y el tope queda como valor configurable.
create or replace view public.ia_uso_diario with (security_invoker = true) as
 select ((created_at at time zone 'America/Santiago'))::date as dia, estudio_id, funcion, origen, modelo,
   count(*) as llamadas, count(*) filter (where (not ok)) as fallas,
   sum(entrada) as entrada, sum(salida) as salida, sum(cache_lectura) as cache_lectura, sum(pensamiento) as pensamiento,
   sum(cache_escritura) as cache_escritura
 from public.ia_uso
 group by (((created_at at time zone 'America/Santiago'))::date), estudio_id, funcion, origen, modelo;
insert into learnings (kind, key, value) select 'config', 'ia_tope_mensual_usd', '50' where not exists (select 1 from learnings where kind='config' and key='ia_tope_mensual_usd');
notify pgrst, 'reload schema';
