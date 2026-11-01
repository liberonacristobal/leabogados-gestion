-- Un solo motor de normativa (1-11-2026).
-- 1) ronda_vigilancia (martes) deja de repetir las 5 consultas de oficios, circulares y resoluciones que ya hace ronda_normativa dos veces al día;
--    conserva lo propio: sentencias, normas, convenios, refresco del repertorio y salud del corpus.
-- 2) Las dos rondas toman el mismo candado: si una está corriendo, la otra no parte y deja una fila «omitida» en vigilancia_rondas.
create or replace function public.ronda_normativa() returns vigilancia_rondas
 language plpgsql security definer set search_path to 'public','extensions','vault','pg_catalog'
as $function$
declare
  tok text; fn text := 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/';
  anon text := public.anon_corpus();
  anio text := to_char(now() at time zone 'America/Santiago', 'YYYY');
  paso text; det jsonb := '[]'::jsonb; r extensions.http_response;
  antes integer; ahora integer; fila public.vigilancia_rondas; err text := null;
begin
  if not pg_try_advisory_xact_lock(hashtext('ronda_normativa_vigilancia')) then
    insert into public.vigilancia_rondas (documentos, nuevos, detalle, fallo)
    values (null, null, jsonb_build_object('ronda', 'normativa', 'omitida', 'otra ronda en curso'), null) returning * into fila;
    return fila;
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '180');
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT', '15');

  select decrypted_secret into tok from vault.decrypted_secrets where name = 'mcp_token';
  if tok is null or length(tok) < 24 then
    insert into public.vigilancia_rondas (documentos, nuevos, detalle, fallo)
    values (null, null, jsonb_build_object('ronda', 'normativa'),
            'Falta el secreto mcp_token en Vault.') returning * into fila;
    return fila;
  end if;

  perform public.vencer_propuestas_sitio();

  select documentos into antes from public.vigilancia_rondas
  where documentos is not null order by corrida desc limit 1;

  foreach paso in array array[
    format('{"key":"RENTA","anio":"%s"}', anio),
    format('{"key":"IVA","anio":"%s"}', anio),
    format('{"key":"OTROS","anio":"%s"}', anio),
    format('{"normativa":"circular","anio":"%s"}', anio),
    format('{"normativa":"resolucion","anio":"%s"}', anio),
    format('{"contenido":true,"desde":"%s","cuantos":12}',
           to_char((now() at time zone 'America/Santiago')::date - 45, 'YYYY-MM-DD'))
  ] loop
    begin
      select * into r from extensions.http((
        'POST', fn || 'cargar-oficios',
        array[extensions.http_header('Authorization', 'Bearer ' || tok)],
        'application/json', paso)::extensions.http_request);
      det := det || jsonb_build_object('peticion', paso::jsonb, 'estado', r.status,
                                       'respuesta', left(r.content, 300));
    exception when others then
      err := coalesce(err, sqlerrm);
      det := det || jsonb_build_object('peticion', paso::jsonb, 'error', sqlerrm);
    end;
  end loop;

  begin
    select * into r from extensions.http((
      'POST', fn || 'vigilancia-sii',
      array[extensions.http_header('Authorization', 'Bearer ' || tok)],
      'application/json', format('{"cuantos":3,"desde":"%s"}', to_char((now() at time zone 'America/Santiago')::date - 7, 'YYYY-MM-DD')))::extensions.http_request);
    det := det || jsonb_build_object('peticion', '{"vigilancia":true}'::jsonb, 'estado', r.status,
                                     'respuesta', left(r.content, 300));
  exception when others then
    err := coalesce(err, sqlerrm);
    det := det || jsonb_build_object('peticion', '{"vigilancia":true}'::jsonb, 'error', sqlerrm);
  end;

  if extract(hour from now() at time zone 'America/Santiago') < 12 then
    begin
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '400');
      select * into r from extensions.http((
        'POST', fn || 'cargar-leyes',
        array[extensions.http_header('x-token', tok), extensions.http_header('Authorization', 'Bearer ' || anon)],
        'application/json', '{"delta":{"avisar":false}}')::extensions.http_request);
      det := det || jsonb_build_object('peticion', '{"leyes":true}'::jsonb, 'estado', r.status,
                                       'respuesta', left(r.content, 300));
    exception when others then
      err := coalesce(err, sqlerrm);
      det := det || jsonb_build_object('peticion', '{"leyes":true}'::jsonb, 'error', sqlerrm);
    end;
  end if;

  begin
    select * into r from extensions.http((
      'GET', 'https://wcdeyrdetrxmpgatscgi.supabase.co/rest/v1/jurisprudencia_judicial?select=id&limit=1',
      array[extensions.http_header('apikey', anon),
            extensions.http_header('Authorization', 'Bearer ' || anon),
            extensions.http_header('Prefer', 'count=exact'),
            extensions.http_header('Range', '0-0')], null, null)::extensions.http_request);
    select (split_part(value, '/', 2))::integer into ahora
    from unnest(r.headers) where lower(field) = 'content-range';
  exception when others then err := coalesce(err, sqlerrm); end;

  insert into public.vigilancia_rondas (documentos, nuevos, detalle, fallo)
  values (ahora, case when antes is null or ahora is null then null else ahora - antes end,
          jsonb_build_object('ronda', 'normativa') || jsonb_build_object('pasos', det), err)
  returning * into fila;
  return fila;
end $function$;

create or replace function public.ronda_vigilancia() returns vigilancia_rondas
 language plpgsql security definer set search_path to 'public','extensions','vault','pg_catalog'
as $function$
declare
  tok text; fn text := 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/';
  anon text := public.anon_corpus();
  paso text; det jsonb := '[]'::jsonb; r extensions.http_response;
  antes integer; ahora integer; fila public.vigilancia_rondas; err text := null; rotos jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('ronda_normativa_vigilancia')) then
    insert into public.vigilancia_rondas (documentos, nuevos, detalle, fallo)
    values (null, null, jsonb_build_object('ronda', 'vigilancia', 'omitida', 'otra ronda en curso'), null) returning * into fila;
    return fila;
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '180');
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT', '15');

  select decrypted_secret into tok from vault.decrypted_secrets where name = 'mcp_token';
  if tok is null or length(tok) < 24 then
    insert into public.vigilancia_rondas (documentos, nuevos, detalle, fallo)
    values (null, null, null, 'Falta el secreto mcp_token en Vault.') returning * into fila;
    return fila;
  end if;

  select documentos into antes from public.vigilancia_rondas
  where documentos is not null order by corrida desc limit 1;

  -- Oficios, circulares y resoluciones los trae ronda_normativa dos veces al día: aquí solo lo que ella no hace.
  foreach paso in array array['{"sentencias":true}', '{"normas":true,"cuantos":8}'] loop
    begin
      select * into r from extensions.http((
        'POST', fn || 'cargar-oficios',
        array[extensions.http_header('Authorization', 'Bearer ' || tok)],
        'application/json', paso)::extensions.http_request);
      det := det || jsonb_build_object('peticion', paso::jsonb, 'estado', r.status,
                                       'respuesta', left(r.content, 300));
    exception when others then
      err := coalesce(err, sqlerrm);
      det := det || jsonb_build_object('peticion', paso::jsonb, 'error', sqlerrm);
    end;
  end loop;

  begin
    select * into r from extensions.http((
      'POST', fn || 'vigilancia-convenios',
      array[extensions.http_header('Authorization', 'Bearer ' || tok)],
      'application/json', '{}')::extensions.http_request);
    det := det || jsonb_build_object('convenios', jsonb_build_object('estado', r.status, 'respuesta', left(r.content, 400)));
    if r.status <> 200 then
      err := coalesce(err || ' · ', '') || 'Convenios: ' || coalesce((r.content::jsonb)->>'error', 'HTTP ' || r.status);
    end if;
  exception when others then
    err := coalesce(err || ' · ', '') || 'Convenios: ' || sqlerrm;
    det := det || jsonb_build_object('convenios', jsonb_build_object('error', sqlerrm));
  end;

  begin
    det := det || jsonb_build_object('refresco',
      left(public.llamar_corpus('rpc/refrescar_repertorio'), 120));
  exception when others then err := coalesce(err, sqlerrm); end;

  begin
    select * into r from extensions.http((
      'GET', 'https://wcdeyrdetrxmpgatscgi.supabase.co/rest/v1/jurisprudencia_judicial?select=id&limit=1',
      array[extensions.http_header('apikey', anon),
            extensions.http_header('Authorization', 'Bearer ' || anon),
            extensions.http_header('Prefer', 'count=exact'),
            extensions.http_header('Range', '0-0')], null, null)::extensions.http_request);
    select (split_part(value, '/', 2))::integer into ahora
    from unnest(r.headers) where lower(field) = 'content-range';
  exception when others then err := coalesce(err, sqlerrm); end;

  begin
    select jsonb_agg(x) into rotos
    from jsonb_array_elements(public.llamar_corpus('rpc/salud_corpus')::jsonb) x
    where (x->>'ok')::boolean is not true;
    det := det || jsonb_build_object('salud', coalesce(rotos, '[]'::jsonb));
    if rotos is not null then
      err := coalesce(err || ' · ', '') || 'Salud del corpus: ' ||
             (select string_agg(x->>'control' || ' = ' || (x->>'medido'), '; ')
              from jsonb_array_elements(rotos) x);
    end if;
  exception when others then err := coalesce(err, sqlerrm); end;

  insert into public.vigilancia_rondas (documentos, nuevos, detalle, fallo)
  values (ahora, case when antes is null or ahora is null then null else ahora - antes end, det, err)
  returning * into fila;
  return fila;
end $function$;
