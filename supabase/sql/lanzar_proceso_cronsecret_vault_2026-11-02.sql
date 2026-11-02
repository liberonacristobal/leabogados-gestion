-- 2026-11-02 · lanzar_proceso acepta «@vault:nombre» también en body.cronSecret (sii-sync), además de body.secret.
-- Motivo: 4 crons del SII (verificar-estados-dte, xml-emitidos-sii, compras-sii-diario, cuadre-ventas-sii-mensual) llevaban el secreto
-- de cron escrito en el comando. Se migran uno por uno a '@vault:cron_secret' (cron.alter_job) sin imprimir el valor.
CREATE OR REPLACE FUNCTION public.lanzar_proceso(job text, url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare rid bigint; ref text; v text; k text;
begin
  foreach k in array array['secret','cronSecret'] loop
    ref := body->>k;
    if ref like '@vault:%' then
      select decrypted_secret into v from vault.decrypted_secrets where name = substr(ref, 8);
      if v is null then raise exception 'lanzar_proceso: no existe el secreto % en Vault', substr(ref, 8); end if;
      body := jsonb_set(body, array[k], to_jsonb(v));
    end if;
  end loop;
  rid := net.http_post(url := url, body := body, params := params, headers := headers, timeout_milliseconds := timeout_milliseconds);
  begin
    insert into public.procesos_corridas(jobname, request_id) values (job, rid);
  exception when others then null;
  end;
  return rid;
end $function$;

-- Migración de cada cron (ejecutar de a uno; reemplaza el valor literal por la referencia a Vault):
-- select cron.alter_job((select jobid from cron.job where jobname='xml-emitidos-sii'),
--   command := replace(command, (select decrypted_secret from vault.decrypted_secrets where name='cron_secret'), '@vault:cron_secret'));
