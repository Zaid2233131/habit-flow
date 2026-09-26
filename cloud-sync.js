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

  // Convert Supabase habits into Habit Flow's current format
  state.habits = (data || []).map(habit => ({
    id: habit.id,
    name: habit.name,
    category: habit.description || "Other",
    completions: {},
    longest: 0,
    createdAt: habit.created_at
  }));

  console.log("Habit Flow: habits loaded from Supabase", state.habits);

  render();
}


// Save one habit to Supabase
async function saveHabitToCloud(habit) {
  const user = await getCurrentUser();

  if (!user) {
    console.warn("No logged-in user.");
    return false;
  }

  const { data, error } = await supabaseClient
    .from("habits")
    .insert({
      user_id: user.id,
      name: habit.name,
      description: habit.category || "",
      frequency: "daily"
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


// Delete habit from Supabase
async function deleteHabitFromCloud(habitId) {
  const user = await getCurrentUser();

  if (!user) return false;

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

  const repeatConfig = {
    days: item.days || [],
    priority: item.priority || "P3",
    notify: item.notify ?? true,
    remindBefore: item.remindBefore || 0,
    monitor: item.monitor ?? false,
    interval: item.interval || 60,
    maxRem: item.maxRem ?? 3,

    // Store per-day schedule history in Supabase
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