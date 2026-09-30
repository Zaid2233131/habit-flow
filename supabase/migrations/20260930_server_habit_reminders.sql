-- Habit Flow: server-side random habit reminder scheduler
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.habit_reminder_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  max_reminders integer not null default 6 check (max_reminders between 1 and 10),
  start_time time not null default '09:00',
  end_time time not null default '22:00',
  quiet_enabled boolean not null default false,
  quiet_start time not null default '23:00',
  quiet_end time not null default '06:00',
  timezone text not null default 'UTC',
  plan_date date,
  slots jsonb not null default '[]'::jsonb,
  sent_slots jsonb not null default '{}'::jsonb,
  last_habit_id uuid,
  updated_at timestamptz not null default now()
);

alter table public.habit_reminder_plans enable row level security;

drop policy if exists "Users can read own habit reminder plan" on public.habit_reminder_plans;
create policy "Users can read own habit reminder plan"
on public.habit_reminder_plans for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own habit reminder plan" on public.habit_reminder_plans;
create policy "Users can insert own habit reminder plan"
on public.habit_reminder_plans for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own habit reminder plan" on public.habit_reminder_plans;
create policy "Users can update own habit reminder plan"
on public.habit_reminder_plans for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.claim_habit_reminder_slot(p_user_id uuid, p_slot_index integer, p_plan_date date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare claimed boolean;
begin
  update public.habit_reminder_plans
     set sent_slots = jsonb_set(coalesce(sent_slots, '{}'::jsonb), array[p_slot_index::text], 'true'::jsonb, true),
         updated_at = now()
   where user_id = p_user_id
     and plan_date = p_plan_date
     and not (coalesce(sent_slots, '{}'::jsonb) ? p_slot_index::text);
  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

grant execute on function public.claim_habit_reminder_slot(uuid, integer, date) to service_role;

create or replace function public.release_habit_reminder_slot(p_user_id uuid, p_slot_index integer, p_plan_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.habit_reminder_plans
     set sent_slots = coalesce(sent_slots, '{}'::jsonb) - p_slot_index::text,
         updated_at = now()
   where user_id = p_user_id and plan_date = p_plan_date;
end;
$$;

grant execute on function public.release_habit_reminder_slot(uuid, integer, date) to service_role;

-- Replace only this scheduler if it already exists.
do $$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'habit-flow-process-habit-reminders';
  if jid is not null then perform cron.unschedule(jid); end if;
end $$;

select cron.schedule(
  'habit-flow-process-habit-reminders',
  '* * * * *',
  $$select net.http_post(
    url := 'https://owzzrcyjlogtjmwwhdpd.supabase.co/functions/v1/process-habit-reminders',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  );$$
);
