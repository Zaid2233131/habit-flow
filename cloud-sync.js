// Habit Flow — Cloud Sync
// Step 1: Habits

async function getCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error) {
    console.error("Could not get current user:", error);
    return null;
  }

  return data.user;
}


// Load habits from Supabase
async function loadHabitsFromCloud() {
  const user = await getCurrentUser();

  if (!user) {
    console.warn("No logged-in user.");
    return;
  }

  const { data, error } = await supabaseClient
    .from("habits")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Could not load habits:", error);
    return;
  }

  // Convert Supabase habits into Habit Flow's current format.
  // IMPORTANT: Supabase stores frequency as scalar values (daily/weekly/monthly/custom)
  // plus target_days/target_value. Convert those back into the UI frequency object so
  // specific-day and quota habits do not silently become daily habits after reload.
  state.habits = (data || []).map(habit => ({
    id: habit.id,
    name: habit.name,
    category: (habit.description || "Other").split("|")[0] || "Other",
    icon: (habit.description || "").split("|")[1] || "",
    frequency: normalizeHabitFrequencyFromCloud(habit),
    completions: {},
    longest: 0,
    createdAt: habit.created_at
  }));

  console.log("Habit Flow: habits loaded from Supabase", state.habits);

  render();
}


// Save one habit to Supabase
function normalizeHabitFrequencyFromCloud(habit) {
  const frequency = habit?.frequency || "daily";
  const targetDays = Array.isArray(habit?.target_days) ? habit.target_days.map(Number).filter(Number.isFinite) : [];
  const targetValue = Math.max(1, Number(habit?.target_value) || 1);

  if (frequency === "custom") {
    return { type: "specific_days", days: targetDays };
  }
  if (frequency === "weekly") {
    return { type: "times_per_week", count: targetValue };
  }
  if (frequency === "monthly") {
    return { type: "times_per_month", count: targetValue };
  }
  if (frequency === "daily") return { type: "daily" };

  // Backward compatibility with older object/string records.
  if (typeof frequency === "object" && frequency?.type) return frequency;
  try {
    const parsed = JSON.parse(String(frequency));
    if (parsed?.type) return parsed;
  } catch (_) {}
  return { type: "daily" };
}

function habitFrequencyForCloud(habit) {
  const f = habit?.frequency && typeof habit.frequency === "object"
    ? habit.frequency
    : { type: habit?.frequency || "daily" };

  if (f.type === "specific_days") {
    return { frequency: "custom", target_days: Array.isArray(f.days) ? f.days.map(Number).filter(Number.isFinite) : [], target_value: Array.isArray(f.days) ? f.days.length : 1 };
  }
  if (f.type === "times_per_week") {
    return { frequency: "weekly", target_days: [], target_value: Math.max(1, Number(f.count) || 1) };
  }
  if (f.type === "times_per_month") {
    return { frequency: "monthly", target_days: [], target_value: Math.max(1, Number(f.count) || 1) };
  }
  return { frequency: "daily", target_days: [], target_value: 1 };
}

// Save one habit to Supabase using the existing scalar DB fields.
async function saveHabitToCloud(habit) {
  const user = await getCurrentUser();

  if (!user) {
    console.warn("No logged-in user.");
    return false;
  }

  const frequencyData = habitFrequencyForCloud(habit);

  const { data, error } = await supabaseClient
    .from("habits")
    .insert({
      user_id: user.id,
      name: habit.name,
      description: (habit.category || "") + (habit.icon ? "|" + habit.icon : ""),
      frequency: frequencyData.frequency,
      target_days: frequencyData.target_days,
      target_value: frequencyData.target_value
    })
    .select()
    .single();

  if (error) {
    console.error("Could not save habit:", error);
    return false;
  }

  // Replace temporary local ID with Supabase ID
  habit.id = data.id;
  habit.createdAt = data.created_at;

  console.log("Habit saved to Supabase:", data);

  return true;
}


// Delete habit from Supabase.
// Order matters: (1) detach schedules that point at the habit (schedules are kept),
// (2) delete the habit's completion records explicitly, (3) delete the habit itself.
// Every query is scoped to the signed-in user. Returns false on the first failure.
async function deleteHabitFromCloud(habitId) {
  const user = await getCurrentUser();

  if (!user) return false;

  const unlink = await supabaseClient
    .from("schedule_items")
    .update({ linked_habit_id: null })
    .eq("linked_habit_id", habitId)
    .eq("user_id", user.id);

  if (unlink.error) {
    console.error("Could not unlink schedules from habit:", unlink.error);
    return false;
  }

  const comps = await supabaseClient
    .from("habit_completions")
    .delete()
    .eq("habit_id", habitId)
    .eq("user_id", user.id);

  if (comps.error) {
    console.error("Could not delete habit completions:", comps.error);
    return false;
  }

  const { error } = await supabaseClient
    .from("habits")
    .delete()
    .eq("id", habitId)
    .eq("user_id", user.id);

  if (error) {
    console.error("Could not delete habit:", error);
    return false;
  }

  console.log("Habit deleted from Supabase:", habitId);

  return true;
}

// Save today's habit completion to Supabase
async function saveHabitCompletionToCloud(habitId, date, status) {
  const user = await getCurrentUser();

  if (!user) return false;

  // If the habit was unchecked completely, remove today's record
  if (!status) {
    const { error } = await supabaseClient
      .from("habit_completions")
      .delete()
      .eq("habit_id", habitId)
      .eq("completion_date", date)
      .eq("user_id", user.id);

    if (error) {
      console.error("Could not remove habit completion:", error);
      return false;
    }

    return true;
  }

  const { error } = await supabaseClient
    .from("habit_completions")
    .upsert(
      {
        user_id: user.id,
        habit_id: habitId,
        completion_date: date,
        value: status === "done" ? 1 : 0,
        completed_at: status === "done"
          ? new Date().toISOString()
          : null
      },
      {
        onConflict: "habit_id,completion_date"
      }
    );

  if (error) {
    console.error("Could not save habit completion:", error);
    return false;
  }

  console.log("✅ Habit completion synced:", habitId, date, status);

  return true;
}


// Load habit completions from Supabase
async function loadHabitCompletionsFromCloud() {
  const user = await getCurrentUser();

  if (!user) return;

  const { data, error } = await supabaseClient
    .from("habit_completions")
    .select("*")
    .eq("user_id", user.id);

  if (error) {
    console.error("Could not load habit completions:", error);
    return;
  }

  // Cloud is the source of truth: drop stale local completions before applying it
  state.habits.forEach(h => { h.completions = {}; });

  for (const completion of data || []) {
    const habit = state.habits.find(
      h => h.id === completion.habit_id
    );

    if (!habit) continue;

    habit.completions[completion.completion_date] =
      completion.value === 1 ? "done" : "skip";
  }

  console.log(
    "✅ Habit completions loaded:",
    data?.length || 0
  );
}

// ===============================
// TASK CLOUD SYNC
// ===============================

async function saveTaskToCloud(task) {
  const user = await getCurrentUser();

  if (!user) return false;

  const { data, error } = await supabaseClient
    .from("tasks")
    .insert({
      user_id: user.id,
      title: task.title,
      description: "",
      status: task.completed ? "completed" : "pending",
      priority:
  task.priority === "P1"
    ? "high"
    : task.priority === "P2"
      ? "medium"
      : "low",
      due_date: task.due || null,
      category: task.category || null,
      completed_at: task.completed
        ? new Date().toISOString()
        : null
    })
    .select()
    .single();

  if (error) {
    console.error("Could not save task:", error);
    return false;
  }

  task.id = data.id;
  task.createdAt = data.created_at;

  console.log("✅ Task saved to Supabase:", data);

  return true;
}


async function loadTasksFromCloud() {
  const user = await getCurrentUser();

  if (!user) return;

  const { data, error } = await supabaseClient
    .from("tasks")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Could not load tasks:", error);
    return;
  }

  state.tasks = (data || []).map(task => ({
    id: task.id,
    title: task.title,
    priority:
  task.priority === "high"
    ? "P1"
    : task.priority === "medium"
      ? "P2"
      : "P3",
    category: task.category || "",
    due: task.due_date || null,
    completed: task.status === "completed",
    completedAt: task.completed_at
      ? task.completed_at.slice(0, 10)
      : null,
    createdAt: task.created_at
  }));

  console.log(
    "✅ Tasks loaded from Supabase:",
    state.tasks
  );
}


async function updateTaskInCloud(task) {
  const user = await getCurrentUser();

  if (!user) return false;

  const { error } = await supabaseClient
    .from("tasks")
    .update({
      status: task.completed ? "completed" : "pending",
      completed_at: task.completed
        ? new Date().toISOString()
        : null
    })
    .eq("id", task.id)
    .eq("user_id", user.id);

  if (error) {
    console.error("Could not update task:", error);
    return false;
  }

  console.log("✅ Task updated in Supabase:", task.id);

  return true;
}


async function deleteTaskFromCloud(taskId) {
  const user = await getCurrentUser();

  if (!user) return false;

  const { error } = await supabaseClient
    .from("tasks")
    .delete()
    .eq("id", taskId)
    .eq("user_id", user.id);

  if (error) {
    console.error("Could not delete task:", error);
    return false;
  }

  console.log("✅ Task deleted from Supabase:", taskId);

  return true;
}

// ===============================
// SCHEDULE CLOUD SYNC
// ===============================

async function saveScheduleToCloud(item) {
  const user = await getCurrentUser();

  if (!user) return false;

  const { data, error } = await supabaseClient
    .from("schedule_items")
    .insert({
      user_id: user.id,
      title: item.title,
      item_type: item.type,
      scheduled_date: item.date,
      start_time: item.start,
      end_time: item.end,
      description: "",
      linked_task_id: item.taskId || null,
      linked_habit_id: item.habitId || null,
      repeat_type:
  item.repeat === "once"
    ? "none"
    : item.repeat === "weekdays" || item.repeat === "weekends"
      ? "custom"
      : item.repeat || "none",

repeat_config: {
  days:
    item.repeat === "weekdays"
      ? [1, 2, 3, 4, 5]
      : item.repeat === "weekends"
        ? [0, 6]
        : (item.days || []),

  priority: item.priority || "P3",
  notify: item.notify ?? true,
  remindBefore: item.remindBefore || 0,
  monitor: item.monitor ?? false,
  interval: item.interval || 60,
  maxRem: item.maxRem ?? 3
},
      status: "upcoming"
    })
    .select()
    .single();

  if (error) {
    console.error("Could not save schedule:", error);
    return false;
  }

  // Replace temporary local ID with Supabase ID
  item.id = data.id;
  item.createdAt = data.created_at;

  console.log("✅ Schedule saved to Supabase:", data);

  return true;
}


async function loadSchedulesFromCloud() {
  const user = await getCurrentUser();

  if (!user) return;

  const { data, error } = await supabaseClient
    .from("schedule_items")
    .select("*")
    .eq("user_id", user.id)
    .order("scheduled_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    console.error("Could not load schedules:", error);
    return;
  }

  state.schedules = (data || []).map(item => {

    const config = item.repeat_config || {};

    return {
      id: item.id,
      title: item.title,
      type: item.item_type,
      date: item.scheduled_date,
      start: item.start_time?.slice(0, 5),
      end: item.end_time?.slice(0, 5),

      repeat:
  item.repeat_type === "none"
    ? "once"
    : item.repeat_type === "daily"
      ? "daily"
      : item.repeat_type === "custom" &&
        JSON.stringify(config.days || []) === JSON.stringify([1, 2, 3, 4, 5])
        ? "weekdays"
        : item.repeat_type === "custom" &&
          JSON.stringify(config.days || []) === JSON.stringify([0, 6])
          ? "weekends"
          : item.repeat_type || "once",

      days: config.days || [],

      priority: config.priority || "P3",

      notify: config.notify ?? true,

      remindBefore: config.remindBefore || 0,

      monitor: config.monitor ?? false,

      interval: config.interval || 60,

      maxRem: config.maxRem ?? 3,

      taskId: item.linked_task_id || null,
      habitId: item.linked_habit_id || null,

      log: config.log || {},

      createdAt: item.created_at
    };
  });

  console.log(
    "✅ Schedules loaded from Supabase:",
    state.schedules
  );
}

// ===============================
// SCHEDULE OCCURRENCE SYNC
// ===============================

async function updateScheduleOccurrenceToCloud(item, date, action) {
  const user = await getCurrentUser();

  if (!user) return false;

  let status = "upcoming";

  if (action === "start") {
    status = "active";
  }

  if (action === "complete") {
    status = "completed";
  }

  if (action === "skip") {
    status = "skipped";
  }

  // Get the current repeat_config first so we don't accidentally
  // erase pushLog written by the automatic reminder system.
  const { data: existing, error: fetchError } = await supabaseClient
    .from("schedule_items")
    .select("repeat_config")
    .eq("id", item.id)
    .eq("user_id", user.id)
    .single();

  if (fetchError) {
    console.error("Could not read existing schedule config:", fetchError);
    return false;
  }

  const existingConfig = existing?.repeat_config || {};

  const repeatConfig = {
    ...existingConfig,

    days: item.days || existingConfig.days || [],
    priority: item.priority || existingConfig.priority || "P3",
    notify: item.notify ?? existingConfig.notify ?? true,
    remindBefore: item.remindBefore ?? existingConfig.remindBefore ?? 0,
    monitor: item.monitor ?? existingConfig.monitor ?? false,
    interval: item.interval ?? existingConfig.interval ?? 60,
    maxRem: item.maxRem ?? existingConfig.maxRem ?? 3,

    // Preserve per-day schedule history
    log: item.log || existingConfig.log || {},

    // IMPORTANT: preserve automatic reminder history
    pushLog: existingConfig.pushLog || {}
  };

  const { error } = await supabaseClient
    .from("schedule_items")
    .update({
      status,
      repeat_config: repeatConfig
    })
    .eq("id", item.id)
    .eq("user_id", user.id);

  if (error) {
    console.error("Could not update schedule:", error);
    return false;
  }

  console.log(
    "✅ Schedule action synced:",
    action,
    item.title,
    date
  );

  return true;
}

// ===============================
// SCHEDULE OCCURRENCE SYNC
// ===============================

async function updateScheduleOccurrenceToCloud(item, date, action) {
  const user = await getCurrentUser();

  if (!user) return false;

  let status = "upcoming";

  if (action === "start") {
    status = "active";
  }

  if (action === "complete") {
    status = "completed";
  }

  if (action === "skip") {
    status = "skipped";
  }

  const repeatConfig = {
    days: item.days || [],
    priority: item.priority || "P3",
    notify: item.notify ?? true,
    remindBefore: item.remindBefore || 0,
    monitor: item.monitor ?? false,
    interval: item.interval || 60,
    maxRem: item.maxRem ?? 3,
    log: item.log || {}
  };

  const { error } = await supabaseClient
    .from("schedule_items")
    .update({
      status,
      repeat_config: repeatConfig
    })
    .eq("id", item.id)
    .eq("user_id", user.id);

  if (error) {
    console.error("Could not update schedule:", error);
    return false;
  }

  console.log(
    "✅ Schedule action synced to Supabase:",
    action,
    item.title,
    date
  );

  return true;
}

// ===============================
// SNOOZE / RESCHEDULE SYNC
// ===============================

async function updateScheduleTimeToCloud(item, date, action, occurrence) {
  const user = await getCurrentUser();

  if (!user) return false;

  const newStart = occurrence?.ov?.start || item.start;
  const newEnd = occurrence?.ov?.end || item.end;

  console.log("🔄 Updating schedule in Supabase:", {
    title: item.title,
    date: date,
    start: newStart,
    end: newEnd,
    occurrence: occurrence
  });

  // Read the existing config first so automatic reminder history
  // (pushLog) is not accidentally erased.
  const { data: existing, error: fetchError } = await supabaseClient
    .from("schedule_items")
    .select("repeat_config")
    .eq("id", item.id)
    .eq("user_id", user.id)
    .single();

  if (fetchError) {
    console.error("Could not read existing schedule config:", fetchError);
    return false;
  }

  const existingConfig = existing?.repeat_config || {};

  const repeatConfig = {
    ...existingConfig,

    days: item.days || existingConfig.days || [],
    priority: item.priority || existingConfig.priority || "P3",
    notify: item.notify ?? existingConfig.notify ?? true,
    remindBefore: item.remindBefore ?? existingConfig.remindBefore ?? 0,
    monitor: item.monitor ?? existingConfig.monitor ?? false,
    interval: item.interval ?? existingConfig.interval ?? 60,
    maxRem: item.maxRem ?? existingConfig.maxRem ?? 3,

    // Preserve per-day schedule history
    log: item.log || existingConfig.log || {},

    // IMPORTANT: preserve automatic reminder history
    pushLog: existingConfig.pushLog || {}
  };

  const { data, error } = await supabaseClient
    .from("schedule_items")
    .update({
      scheduled_date: date,
      start_time: newStart,
      end_time: newEnd,
      repeat_config: repeatConfig,
      status: "upcoming"
    })
    .eq("id", item.id)
    .eq("user_id", user.id)
    .select("id, title, scheduled_date, start_time, end_time, status")
    .single();

  if (error) {
    console.error("❌ Could not update schedule time:", error);
    return false;
  }

  console.log("✅ Supabase returned updated schedule:", data);

  console.log(
    "✅ Schedule time synced to Supabase:",
    action,
    item.title,
    date
  );

  return true;
}
// ===============================
// DELETE SCHEDULE FROM CLOUD
// ===============================

async function deleteScheduleFromCloud(id) {
  const user = await getCurrentUser();

  if (!user) return false;

  const { error } = await supabaseClient
    .from("schedule_items")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("❌ Could not delete schedule from Supabase:", error);
    return false;
  }

  console.log("✅ Schedule deleted from Supabase:", id);
  return true;
}


// ===============================
// SERVER-SIDE HABIT REMINDER SYNC
// ===============================

async function syncHabitReminderSettingsToCloud() {
  const user = await getCurrentUser();
  if (!user) return false;

  const S = state.settings || {};
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const row = {
    user_id: user.id,
    enabled: !!(S.notificationsEnabled && S.uncompletedHabitReminders),
    max_reminders: Math.max(1, Math.min(10, Number(S.habitReminderMax) || 6)),
    start_time: S.habitReminderStart || "09:00",
    end_time: S.habitReminderEnd || "22:00",
    quiet_enabled: !!S.quiet?.enabled,
    quiet_start: S.quiet?.start || "23:00",
    quiet_end: S.quiet?.end || "06:00",
    timezone: tz
  };

  const { data, error } = await supabaseClient
    .from("habit_reminder_plans")
    .upsert(row, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) {
    console.error("Could not sync server-side habit reminder settings:", error);
    state.settings.serverHabitRemindersReady = false;
    save();
    return false;
  }

  state.settings.serverHabitRemindersReady = true;
  if (data?.plan_date) {
    state.settings.habitReminderPlan = {
      date: data.plan_date,
      slots: Array.isArray(data.slots) ? data.slots : [],
      sent: data.sent_slots && typeof data.sent_slots === "object" ? Object.keys(data.sent_slots).map(Number) : [],
      lastHabitId: data.last_habit_id || null
    };
  }
  save();
  return true;
}

async function loadHabitReminderSettingsFromCloud() {
  const user = await getCurrentUser();
  if (!user) return false;

  const { data, error } = await supabaseClient
    .from("habit_reminder_plans")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("Server-side habit reminder settings unavailable:", error);
    state.settings.serverHabitRemindersReady = false;
    save();
    return false;
  }

  if (!data) {
    return await syncHabitReminderSettingsToCloud();
  }

  state.settings.notificationsEnabled = !!data.enabled;
  state.settings.uncompletedHabitReminders = !!data.enabled;
  state.settings.habitReminderMax = Math.max(1, Math.min(10, Number(data.max_reminders) || 6));
  state.settings.habitReminderStart = String(data.start_time || "09:00").slice(0,5);
  state.settings.habitReminderEnd = String(data.end_time || "22:00").slice(0,5);
  state.settings.quiet = Object.assign({}, state.settings.quiet, {
    enabled: !!data.quiet_enabled,
    start: String(data.quiet_start || "23:00").slice(0,5),
    end: String(data.quiet_end || "06:00").slice(0,5)
  });
  state.settings.serverHabitRemindersReady = true;
  state.settings.habitReminderPlan = {
    date: data.plan_date || null,
    slots: Array.isArray(data.slots) ? data.slots : [],
    sent: data.sent_slots && typeof data.sent_slots === "object" ? Object.keys(data.sent_slots).map(Number) : [],
    lastHabitId: data.last_habit_id || null
  };
  save();
  return true;
}

// One shared loader so login and auth-state events never run overlapping loads
// (a habits-only reload used to wipe the completions loaded a moment earlier).
let _cloudLoad = null;
function loadAllFromCloud() {
  if (_cloudLoad) return _cloudLoad;
  _cloudLoad = (async () => {
    try {
      await loadHabitReminderSettingsFromCloud();
      if (state.settings.notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
        try { await registerPushNotifications(); } catch (e) { console.warn('Push re-registration skipped:', e); }
      }
      await loadHabitsFromCloud();
      await loadHabitCompletionsFromCloud();
      await loadTasksFromCloud();
      await loadSchedulesFromCloud();
      save();
      render();
    } finally { _cloudLoad = null; }
  })();
  return _cloudLoad;
}
