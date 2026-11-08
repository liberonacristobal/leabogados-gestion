-- Cómo y por quién se cerró cada hallazgo del auditor: 'automatico' (el detector dejó de verlo), o lo que fije una persona ('corregido', 'esperable', 'falso_positivo').
alter table public.auditoria_hallazgos add column if not exists cierre text, add column if not exists motivo text, add column if not exists resuelto_por text;
update public.auditoria_hallazgos set cierre = 'automatico', resuelto_por = 'auditor-datos' where estado = 'resuelto' and resuelto_at is not null and cierre is null;
notify pgrst, 'reload schema';
