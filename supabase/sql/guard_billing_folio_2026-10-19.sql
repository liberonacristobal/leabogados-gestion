-- DOCUMENTACIÓN (2026-10-19): protección que YA existía en producción y no estaba en el repo.
-- Una factura con folio del SII (invoice_no no vacío) no se elimina ni se manda a la papelera: se anula con nota de crédito.
-- Escotilla para operaciones administrativas deliberadas: SET LOCAL app.allow_folio_delete = 'on'.
-- La app aplica la misma regla antes de intentar borrar (conFolioSII en src/App.jsx).
-- Complementa trg_guard_sale_delete (no deja eliminar una venta con facturas, gastos o comisiones vivos).

create or replace function public.billing_guard_folio_delete() returns trigger language plpgsql as $function$
begin
  -- escotilla para operaciones administrativas deliberadas: SET LOCAL app.allow_folio_delete='on'
  if coalesce(current_setting('app.allow_folio_delete', true),'') = 'on' then
    return case when TG_OP='DELETE' then OLD else NEW end;
  end if;
  if TG_OP='DELETE' then
    if coalesce(OLD.invoice_no,'') <> '' then
      raise exception 'Regla de oro: no se puede eliminar la factura con folio % (documento del SII). Para dejarla sin efecto: estado Anulada + su nota de credito.', OLD.invoice_no;
    end if;
    return OLD;
  end if;
  -- UPDATE que hace soft-delete (deleted_at pasa de NULL a no-NULL)
  if NEW.deleted_at is not null and OLD.deleted_at is null and coalesce(OLD.invoice_no,'') <> '' then
    raise exception 'Regla de oro: no se puede borrar la factura con folio % (documento del SII). Para dejarla sin efecto: estado Anulada + su nota de credito.', OLD.invoice_no;
  end if;
  return NEW;
end $function$;

-- create trigger trg_billing_guard_folio_delete before delete or update on public.billing
--   for each row execute function billing_guard_folio_delete();
