-- Habit Flow: enforce one random reminder at a time with a 30-minute cooldown.
-- This migration upgrades the reminder claim function to the 30-minute common-reminder model.

drop function if exists public.claim_habit_reminder_slot(uuid, integer, date);

alter table public.habit_reminder_plans
  add column if not exists last_sent_at timestamptz;

create or replace function public.claim_habit_reminder_slot(
  p_user_id uuid,
  p_slot_index integer,
  p_plan_date date,
  p_cooldown_minutes integer default 30
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean;
begin
  update public.habit_reminder_plans
     set sent_slots = jsonb_set(
           coalesce(sent_slots, '{}'::jsonb),
           array[p_slot_index::text],
           'true'::jsonb,
           true
         ),
         last_sent_at = now(),
         updated_at = now()
   where user_id = p_user_id
     and plan_date = p_plan_date
     and not (coalesce(sent_slots, '{}'::jsonb) ? p_slot_index::text)
     and (
       last_sent_at is null
       or last_sent_at <= now() - make_interval(mins => greatest(1, p_cooldown_minutes))
     );

  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

grant execute on function public.claim_habit_reminder_slot(uuid, integer, date, integer) to service_role;

create or replace function public.release_habit_reminder_slot(
  p_user_id uuid,
  p_slot_index integer,
  p_plan_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.habit_reminder_plans
     set sent_slots = coalesce(sent_slots, '{}'::jsonb) - p_slot_index::text,
         last_sent_at = null,
         updated_at = now()
   where user_id = p_user_id
     and plan_date = p_plan_date;
end;
$$;

grant execute on function public.release_habit_reminder_slot(uuid, integer, date) to service_role;

-- Regenerate today's reminder slots using the new 30-minute cadence.
-- This does not touch habits or completions.
update public.habit_reminder_plans
set slots = '[]'::jsonb,
    sent_slots = '{}'::jsonb,
    last_habit_id = null,
    last_sent_at = null,
    updated_at = now()
where plan_date = current_date;
