-- Diferencia aceitação pelo provedor de entrega final na caixa postal.
-- SMTP/Resend confirmam a aceitação inicial; devoluções podem ocorrer depois.
alter table public.report_deliveries
  add column if not exists delivery_state text not null default 'queued',
  add column if not exists provider_response text,
  add column if not exists provider_accepted jsonb not null default '[]'::jsonb;

update public.report_deliveries
set delivery_state = case
  when status = 'sent' then 'provider_accepted'
  when status = 'failed' then 'failed'
  else coalesce(nullif(status, ''), 'queued')
end
where delivery_state = 'queued' and status <> 'queued';

create index if not exists report_deliveries_delivery_state_idx
  on public.report_deliveries (delivery_state, created_at desc);

comment on column public.report_deliveries.delivery_state is
  'queued, provider_accepted, delivered, bounced ou failed. provider_accepted não garante entrega final.';

-- Permite separar o endereço de login do endereço que recebe relatórios.
alter table public.profiles
  add column if not exists report_email text;

create unique index if not exists profiles_report_email_unique_idx
  on public.profiles (lower(report_email))
  where report_email is not null and btrim(report_email) <> '';

comment on column public.profiles.report_email is
  'Endereço opcional e autoritativo para relatórios; quando vazio, usa o e-mail de login.';
