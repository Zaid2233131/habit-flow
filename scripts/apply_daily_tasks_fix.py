from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Fix Daily Task creation so the client always owns the UUID and preserves the
# exact Supabase error instead of replacing it with a generic connection error.
index = ROOT / "index.html"
s = index.read_text(encoding="utf-8")
old = "const task={id:uid(),title,active:true,createdAt:new Date().toISOString(),completions:{}};"
new = "const task={id:(crypto.randomUUID?crypto.randomUUID():uid()),title,active:true,createdAt:new Date().toISOString(),completions:{}};"
if old in s:
    s = s.replace(old, new, 1)
old = "save();render();toast('Could not save daily task — check your connection');"
new = "save();render();\n    // saveDailyTaskToCloud already reports the exact Supabase error.\n    // Do not overwrite it with the old generic connection message."
if old in s:
    s = s.replace(old, new, 1)
index.write_text(s, encoding="utf-8")

cloud = ROOT / "cloud-sync.js"
s = cloud.read_text(encoding="utf-8")
old = '''async function saveDailyTaskToCloud(task) {\n  const user = await getCurrentUser();\n  if (!user) return false;\n  const { data, error } = await supabaseClient\n    .from("daily_tasks")\n    .insert({\n      user_id: user.id,\n      title: task.title,\n      active: task.active !== false\n    })\n    .select()\n    .single();\n  if (error) {\n    console.error("Could not save daily task:", error);\n    return false;\n  }\n  task.id = data.id;\n  task.createdAt = data.created_at;\n  return true;\n}'''
new = '''async function saveDailyTaskToCloud(task) {\n  let user = await getCurrentUser();\n  if (!user) {\n    const sessionResult = await supabaseClient.auth.getSession();\n    user = sessionResult?.data?.session?.user || null;\n  }\n  if (!user) {\n    console.error("Could not save daily task: no authenticated user");\n    if (typeof toast === "function") toast("Not signed in. Please sign in again.");\n    return false;\n  }\n\n  // Daily tasks use a UUID generated in the app. This avoids relying on\n  // INSERT ... SELECT ... after the insert, which can fail under RLS.\n  if (!task.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(task.id)) {\n    task.id = crypto.randomUUID ? crypto.randomUUID() : task.id;\n  }\n\n  const { error } = await supabaseClient\n    .from("daily_tasks")\n    .insert({\n      id: task.id,\n      user_id: user.id,\n      title: task.title,\n      active: task.active !== false,\n      created_at: task.createdAt || new Date().toISOString()\n    });\n\n  if (error) {\n    console.error("Could not save daily task:", error);\n    const detail = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" | ");\n    console.error("Daily task Supabase error details:", { message:error.message, details:error.details, hint:error.hint, code:error.code, userId:user.id, taskId:task.id });\n    if (typeof toast === "function") toast("Daily Task save failed: " + (detail || "Unknown Supabase error"));\n    return false;\n  }\n\n  return true;\n}'''
if old in s:
    s = s.replace(old, new, 1)
cloud.write_text(s, encoding="utf-8")

migration = ROOT / "supabase" / "migrations" / "20261028_daily_tasks.sql"
migration.parent.mkdir(parents=True, exist_ok=True)
migration.write_text('''-- Habit Flow 1.1.0: Daily Tasks\n-- Safe/idempotent migration for existing Habit Flow databases.\n\ncreate table if not exists public.daily_tasks (\n  id uuid primary key default gen_random_uuid(),\n  user_id uuid not null references auth.users(id) on delete cascade,\n  title text not null,\n  active boolean not null default true,\n  created_at timestamptz not null default now()\n);\n\nalter table public.daily_tasks add column if not exists user_id uuid;\nalter table public.daily_tasks add column if not exists title text;\nalter table public.daily_tasks add column if not exists active boolean not null default true;\nalter table public.daily_tasks add column if not exists created_at timestamptz not null default now();\n\ncreate table if not exists public.daily_task_completions (\n  id uuid primary key default gen_random_uuid(),\n  user_id uuid not null references auth.users(id) on delete cascade,\n  daily_task_id uuid not null references public.daily_tasks(id) on delete cascade,\n  completion_date date not null,\n  completed boolean not null default false,\n  completed_at timestamptz,\n  unique (daily_task_id, completion_date)\n);\n\nalter table public.daily_task_completions add column if not exists user_id uuid;\nalter table public.daily_task_completions add column if not exists daily_task_id uuid;\nalter table public.daily_task_completions add column if not exists completion_date date;\nalter table public.daily_task_completions add column if not exists completed boolean not null default false;\nalter table public.daily_task_completions add column if not exists completed_at timestamptz;\n\ncreate index if not exists daily_tasks_user_id_idx\n  on public.daily_tasks(user_id);\ncreate index if not exists daily_task_completions_user_id_idx\n  on public.daily_task_completions(user_id);\ncreate index if not exists daily_task_completions_task_date_idx\n  on public.daily_task_completions(daily_task_id, completion_date);\n\nalter table public.daily_tasks enable row level security;\nalter table public.daily_task_completions enable row level security;\n\ndrop policy if exists "Users can manage their daily tasks" on public.daily_tasks;\ncreate policy "Users can manage their daily tasks"\n  on public.daily_tasks for all\n  using (auth.uid() = user_id)\n  with check (auth.uid() = user_id);\n\ndrop policy if exists "Users can manage their daily task completions" on public.daily_task_completions;\ncreate policy "Users can manage their daily task completions"\n  on public.daily_task_completions for all\n  using (auth.uid() = user_id)\n  with check (auth.uid() = user_id);\n\ngrant select, insert, update, delete on public.daily_tasks to authenticated;\ngrant select, insert, update, delete on public.daily_task_completions to authenticated;\n\nnotify pgrst, 'reload schema';\n''', encoding="utf-8")

# Remove this one-shot helper and its workflow after the patch is committed.
workflow = ROOT / ".github" / "workflows" / "apply-daily-tasks-fix.yml"
self_path = Path(__file__)
self_path.unlink(missing_ok=True)
workflow.unlink(missing_ok=True)

print("Daily Tasks fix applied.")
