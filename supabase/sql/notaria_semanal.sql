-- notaria-semanal — digest semanal por abogado responsable de las OT de notaría por cobrar.
-- Manda a cada responsable (abogado_responsable) sus OT de notaría YA PAGADAS a la notaría
-- (notaria_liquidado_at) y SIN rendir al cliente, con +30 días. Las OT sin responsable van a
-- los dos socios como aviso de asignación. Espeja gastosPorRendir (App.jsx:12514).
--
-- Requiere: extensiones pg_cron + pg_net (ya activas para cartera-semanal / clientes-drive-sync).
-- El secreto es el MISMO compartido del resto de los cron (env CRON_SECRET de la edge function).
--
-- SEGURIDAD: aunque este cron quede agendado, la función NO envía nada hasta que el interruptor
-- learnings config 'notaria_semanal' esté en 'on' (o una lista de nombres/correos). Arranca 'off'.

-- 1) Agendar: lunes 13:00 UTC (una hora después de cartera-semanal, para no solaparse).
select cron.schedule(
  'notaria-semanal-lunes',
  '0 13 * * 1',
  $$
  select net.http_post(
    url := 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/notaria-semanal',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"secret":"lea-cron-c9a87cf18e0c04580097b2947545163c4825a918"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- 2) Encender el envío (elige UNO):
--    todo el equipo:
--      insert into learnings (kind,key,value) values ('config','notaria_semanal','on');
--    solo algunas personas (por nombre o correo, separadas por coma):
--      insert into learnings (kind,key,value) values ('config','notaria_semanal','Cristóbal,Erasmo');
--    apagar de nuevo:
--      update learnings set value='off' where kind='config' and key='notaria_semanal';

-- Para desagendar el cron:
--   select cron.unschedule('notaria-semanal-lunes');
