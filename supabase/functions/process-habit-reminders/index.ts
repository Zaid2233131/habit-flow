import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SERVICE_ROLE_KEY")!;

const admin = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY
);

function parts(timeZone: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const get = (type: string) =>
    p.find(x => x.type === type)?.value || "00";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minute:
      Number(get("hour")) * 60 +
      Number(get("minute"))
  };
}

function toMin(
  value: string | undefined,
  fallback: number
) {
  if (!value) return fallback;

  const [h, m] = String(value)
    .slice(0, 5)
    .split(":")
    .map(Number);

  return Number.isFinite(h) &&
    Number.isFinite(m)
    ? h * 60 + m
    : fallback;
}

function quiet(
  minute: number,
  enabled: boolean,
  start: string,
  end: string
) {
  if (!enabled) return false;

  const a = toMin(start, 1380);
  const b = toMin(end, 360);

  return a > b
    ? minute >= a || minute < b
    : minute >= a && minute < b;
}

function parseFrequency(
  raw: unknown,
  targetDays: unknown = [],
  targetValue: unknown = 1
) {
  if (
    raw &&
    typeof raw === "object"
  ) {
    return raw as any;
  }

  const days =
    Array.isArray(targetDays)
      ? targetDays
          .map(Number)
          .filter(Number.isFinite)
      : [];

  const count = Math.max(
    1,
    Number(targetValue) || 1
  );

  if (!raw || raw === "daily") {
    return { type: "daily" };
  }

  if (raw === "custom") {
    return {
      type: "specific_days",
      days
    };
  }

  if (raw === "weekly") {
    return {
      type: "times_per_week",
      count
    };
  }

  if (raw === "monthly") {
    return {
      type: "times_per_month",
      count
    };
  }

  try {
    const parsed =
      JSON.parse(String(raw));

    if (
      parsed &&
      parsed.type
    ) {
      return parsed;
    }
  } catch (_) {}

  if (
    typeof raw === "string" &&
    raw.startsWith("specific:")
  ) {
    return {
      type: "specific_days",
      days: raw
        .slice(9)
        .split(",")
        .map(Number)
        .filter(Number.isFinite)
    };
  }

  return {
    type: "daily"
  };
}

function weekStart(date: string) {
  const d = new Date(
    `${date}T00:00:00Z`
  );

  d.setUTCDate(
    d.getUTCDate() -
      d.getUTCDay()
  );

  return d
    .toISOString()
    .slice(0, 10);
}

function weekKeys(date: string) {
  const d = new Date(
    `${weekStart(date)}T00:00:00Z`
  );

  return Array.from(
    { length: 7 },
    (_, i) => {
      const x = new Date(d);

      x.setUTCDate(
        d.getUTCDate() + i
      );

      return x
        .toISOString()
        .slice(0, 10);
    }
  );
}

function monthKeys(date: string) {
  const [y, m] = date
    .split("-")
    .map(Number);

  const count =
    new Date(
      Date.UTC(y, m, 0)
    ).getUTCDate();

  return Array.from(
    { length: count },
    (_, i) =>
      `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
  );
}

function dayOfWeek(date: string) {
  return new Date(
    `${date}T00:00:00Z`
  ).getUTCDay();
}

function doneCount(
  completions: Map<string, number>,
  habitId: string,
  keys: string[]
) {
  return keys.filter(
    key =>
      completions.get(
        `${habitId}|${key}`
      ) === 1
  ).length;
}

function habitDueToday(
  habit: any,
  date: string,
  completions: Map<string, number>
) {
  const created =
    String(habit.created_at)
      .slice(0, 10);

  if (created > date) {
    return false;
  }

  const f = parseFrequency(
    habit.frequency,
    habit.target_days,
    habit.target_value
  );

  if (
    f.type === "specific_days"
  ) {
    return (
      Array.isArray(f.days) &&
      f.days.includes(
        dayOfWeek(date)
      )
    );
  }

  if (f.type === "daily") {
    return true;
  }

  const count = Math.max(
    1,
    Number(f.count) || 1
  );

  if (
    f.type ===
    "times_per_week"
  ) {
    return (
      doneCount(
        completions,
        habit.id,
        weekKeys(date)
      ) < count
    );
  }

  if (
    f.type ===
    "times_per_month"
  ) {
    return (
      doneCount(
        completions,
        habit.id,
        monthKeys(date)
      ) < count
    );
  }

  return true;
}

function randomGapMinutes() {
  return (
    30 +
    Math.floor(
      Math.random() * 91
    )
  );
}

async function sendPush(
  userId: string,
  title: string,
  message: string
): Promise<boolean> {
  try {
    const response =
      await fetch(
        `${SUPABASE_URL}/functions/v1/send-push`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            "apikey":
              SERVICE_ROLE_KEY,
            "Authorization":
              `Bearer ${SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({
            user_id: userId,
            title,
            message
          })
        }
      );

    const data =
      await response
        .json()
        .catch(() => null);

    console.log(
      "send-push response:",
      {
        status:
          response.status,
        data
      }
    );

    if (!response.ok) {
      return false;
    }

    const successful =
      Array.isArray(data?.sent)
        ? data.sent.filter(
            (item: any) =>
              item?.success === true
          )
        : [];

    return (
      successful.length > 0
    );
  } catch (error) {
    console.error(
      "send-push request failed:",
      error
    );

    return false;
  }
}

async function sendForUser(
  row: any
) {
  if (!row.enabled) {
    return {
      sent: 0,
      reason: "disabled"
    };
  }

  const tz =
    row.timezone || "UTC";

  const current =
    parts(tz);

  /*
   * Quiet hours.
   */
  if (
    quiet(
      current.minute,
      row.quiet_enabled,
      row.quiet_start,
      row.quiet_end
    )
  ) {
    return {
      sent: 0,
      reason: "quiet_hours"
    };
  }

  /*
   * Allowed reminder window.
   * Supports windows that cross midnight,
   * such as 07:00 -> 01:00.
   */
  const start = toMin(
    row.start_time,
    420
  );

  const end = toMin(
    row.end_time,
    60
  );

  const inReminderWindow =
    start <= end
      ? current.minute >= start &&
        current.minute < end
      : current.minute >= start ||
        current.minute < end;

  if (!inReminderWindow) {
    return {
      sent: 0,
      reason:
        "outside_reminder_window"
    };
  }

  /*
   * Get active habits.
   */
  const {
    data: habits,
    error: hErr
  } = await admin
    .from("habits")
    .select(
      "id,created_at,frequency,target_days,target_value"
    )
    .eq(
      "user_id",
      row.user_id
    )
    .eq(
      "is_archived",
      false
    );

  if (hErr) {
    throw hErr;
  }

  const eligible =
    (habits || []).filter(
      (h: any) =>
        String(
          h.created_at
        ).slice(0, 10) <=
        current.date
    );

  if (!eligible.length) {
    return {
      sent: 0,
      reason: "no_habits"
    };
  }

  /*
   * Load completions.
   */
  const {
    data: comps,
    error: cErr
  } = await admin
    .from(
      "habit_completions"
    )
    .select(
      "habit_id,completion_date,value"
    )
    .eq(
      "user_id",
      row.user_id
    );

  if (cErr) {
    throw cErr;
  }

  const completionMap =
    new Map<string, number>();

  for (const c of comps || []) {
    completionMap.set(
      `${c.habit_id}|${c.completion_date}`,
      Number(c.value)
    );
  }

  /*
   * Check whether at least one
   * applicable habit remains incomplete.
   */
  const incomplete =
    eligible.some(
      (h: any) => {
        const todayValue =
          completionMap.get(
            `${h.id}|${current.date}`
          );

        if (
          todayValue === 1 ||
          todayValue === 0
        ) {
          return false;
        }

        return habitDueToday(
          h,
          current.date,
          completionMap
        );
      }
    );

  if (!incomplete) {
    /*
     * Everything applicable is complete.
     * Stop reminders.
     */
    return {
      sent: 0,
      all_complete: true
    };
  }

  const now =
    new Date();

  /*
   * If there is already a scheduled
   * next reminder, wait until it arrives.
   */
  if (
    row.next_reminder_at
  ) {
    const next =
      new Date(
        row.next_reminder_at
      );

    if (
      now.getTime() <
      next.getTime()
    ) {
      return {
        sent: 0,
        reason:
          "waiting_for_next_reminder",
        next_reminder_at:
          row.next_reminder_at
      };
    }
  }

  /*
   * Claim the reminder.
   *
   * The database function still guarantees
   * a minimum 30-minute cooldown.
   */
  const claimed =
    await admin.rpc(
      "claim_habit_reminder_slot",
      {
        p_user_id:
          row.user_id,
        p_slot_index:
          Math.floor(
            Date.now() / 60000
          ),
        p_plan_date:
          current.date,
        p_cooldown_minutes:
          30
      }
    );

  if (claimed.error) {
    throw claimed.error;
  }

  if (!claimed.data) {
    return {
      sent: 0,
      reason:
        "claim_failed"
    };
  }

  /*
   * Send generic notification.
   */
  const ok =
    await sendPush(
      row.user_id,
      "Habit Flow",
      "Don't forget to complete your habits."
    );

  if (!ok) {
    return {
      sent: 0,
      pushFailed: true
    };
  }

  /*
   * Generate the next random reminder.
   *
   * 30–120 minutes after this reminder.
   */
  const gap =
    randomGapMinutes();

  const nextReminder =
    new Date(
      now.getTime() +
        gap * 60 * 1000
    );

  await admin
    .from(
      "habit_reminder_plans"
    )
    .update({
      last_sent_at:
        now.toISOString(),
      next_reminder_at:
        nextReminder.toISOString(),
      updated_at:
        now.toISOString()
    })
    .eq(
      "user_id",
      row.user_id
    );

  return {
    sent: 1,
    message:
      "Don't forget to complete your habits.",
    next_reminder_at:
      nextReminder.toISOString(),
    gap_minutes:
      gap
  };
}

Deno.serve(
  async req => {
    if (
      req.method !== "POST"
    ) {
      return new Response(
        JSON.stringify({
          error:
            "POST required"
        }),
        {
          status: 405,
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      );
    }

    try {
      const {
        data: rows,
        error
      } = await admin
        .from(
          "habit_reminder_plans"
        )
        .select("*")
        .eq(
          "enabled",
          true
        );

      if (error) {
        throw error;
      }

      const results = [];

      for (
        const row of rows || []
      ) {
        try {
          results.push({
            user_id:
              row.user_id,
            ...(await sendForUser(
              row
            ))
          });
        } catch (e) {
          results.push({
            user_id:
              row.user_id,
            error:
              String(e)
          });
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          results
        }),
        {
          status: 200,
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      );
    } catch (e) {
      console.error(e);

      return new Response(
        JSON.stringify({
          ok: false,
          error:
            String(e)
        }),
        {
          status: 500,
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      );
    }
  }
);