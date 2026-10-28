-- Habit Flow 1.1.0: Daily Tasks
-- Run this once in Supabase SQL Editor.

create table if not exists public.daily_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists daily_tasks_user_id_idx
  on public.daily_tasks(user_id);

create table if not exists public.daily_task_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_task_id uuid not null references public.daily_tasks(id) on delete cascade,
  completion_date date not null,
  completed boolean not null default false,
  completed_at timestamptz,
  unique (daily_task_id, completion_date)
);

create index if not exists daily_task_completions_user_id_idx
  on public.daily_task_completions(user_id);

create index if not exists daily_task_completions_task_date_idx
  on public.daily_task_completions(daily_task_id, completion_date);

alter table public.daily_tasks enable row level security;
alter table public.daily_task_completions enable row level security;

drop policy if exists "Users can view own daily tasks" on public.daily_tasks;
create policy "Users can view own daily tasks"
  on public.daily_tasks for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own daily tasks" on public.daily_tasks;
create policy "Users can insert own daily tasks"
  on public.daily_tasks for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own daily tasks" on public.daily_tasks;
create policy "Users can update own daily tasks"
  on public.daily_tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own daily tasks" on public.daily_tasks;
create policy "Users can delete own daily tasks"
  on public.daily_tasks for delete
  using (auth.uid() = user_id);

drop policy if exists "Users can view own daily task completions" on public.daily_task_completions;
create policy "Users can view own daily task completions"
  on public.daily_task_completions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own daily task completions" on public.daily_task_completions;
create policy "Users can insert own daily task completions"
  on public.daily_task_completions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own daily task completions" on public.daily_task_completions;
create policy "Users can update own daily task completions"
  on public.daily_task_completions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own daily task completions" on public.daily_task_completions;
create policy "Users can delete own daily task completions"
  on public.daily_task_completions for delete
  using (auth.uid() = user_id);


-- Explicit API privileges for signed-in Habit Flow users.
grant select, insert, update, delete on public.daily_tasks to authenticated;
grant select, insert, update, delete on public.daily_task_completions to authenticated;
