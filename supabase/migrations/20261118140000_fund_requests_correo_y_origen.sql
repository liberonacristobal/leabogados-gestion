-- Solicitar fondos: guarda el correo enviado (para verlo y descargarlo) y el origen de la solicitud.
-- origen: 'inicial' = fondo inicial de un cliente nuevo (pedido desde la app o registrado con «Ya la pedí»); 'rendicion' = pedido dentro de una rendición (se ve en Rendiciones).
alter table public.fund_requests add column if not exists correo jsonb;
alter table public.fund_requests add column if not exists origen text;
update public.fund_requests set origen = case when asunto ilike 'Rendici%' then 'rendicion' else 'inicial' end where origen is null;
notify pgrst, 'reload schema';
