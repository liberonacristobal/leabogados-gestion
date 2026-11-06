-- Tiempo real: la app se suscribe a los cambios de estas tablas (src/lib/tiempoReal.js) y vuelve a leer la que cambió.
-- Solo agrega las tablas a la publicación de Realtime; no cambia datos, permisos ni RLS (cada usuario recibe solo lo que su política le deja ver).
-- Para revertir: ALTER PUBLICATION supabase_realtime DROP TABLE public.<tabla>;
ALTER PUBLICATION supabase_realtime ADD TABLE public.billing, public.clients, public.sales, public.expenses, public.tasks, public.petty_cash, public.anticipos, public.terceros_pagos, public.conciliacion;
