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
    minute: Number(get("hour")) * 60 + Number(get("minute"))
  };
}

function toMin(value: string | undefined, fallback: number) {
  if (!value) return fallback;

  const [h, m] = String(value)
    .slice(0, 5)
    .split(":")
    .map(Number);

  return Number.isFinite(h) && Number.isFinite(m)
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

function makeSlots(
  start: number,
  end: number,
  count: number
) {
  if (end <= start) end = 1439;

  const span = end - start;

  if (span < 30) return [];

  const n = Math.min(
    count,
    Math.max(1, Math.floor(span / 60))
  );

  const gap = Math.max(
    45,
    Math.floor(span / (n + 1))
  );

  const out: number[] = [];

  for (let i = 0; i < n; i++) {
    const lo = start + i * gap + 10;

    const hi = Math.min(
      end - 10,
      start + (i + 1) * gap - 10
    );

    const m =
      hi > lo
        ? lo + Math.floor(Math.random() * (hi - lo + 1))
        : Math.min(end - 1, lo);

    out.push(m);
  }

  return out.sort((a, b) => a - b);
}

async function ensurePlan(row: any, date: string) {
  if (
    row.plan_date === date &&
    Array.isArray(row.slots) &&
    row.slots.length
  ) {
    return row;
  }

  const slots = makeSlots(
    toMin(row.start_time, 540),
    toMin(row.end_time, 1320),
    Math.max(
      1,
      Math.min(10, Number(row.max_reminders) || 6)
    )
  );

  const {
    data,
    error
  } = await admin
    .from("habit_reminder_plans")
    .update({
      plan_date: date,
      slots,
      sent_slots: {},
      last_habit_id: null,
      updated_at: new Date().toISOString()
    })
    .eq("user_id", row.user_id)
    .select("*")
    .single();

  if (error) throw error;

  return data;
}

async function sendPush(
  userId: string,
  title: string,
  message: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/send-push`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          user_id: userId,
          title,
          message,
        }),
      }
    );

    const data = await response.json().catch(() => null);

    console.log("send-push response:", {
      status: response.status,
      data,
    });

    if (!response.ok) {
      console.error(
        "send-push HTTP failure:",
        response.status,
        data
      );
      return false;
    }

    const successfulSubscriptions =
      Array.isArray(data?.sent)
        ? data.sent.filter(
            (item: any) => item?.success === true
          )
        : [];

    if (successfulSubscriptions.length === 0) {
      console.error(
        "send-push completed but no subscription succeeded:",
        data
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("send-push request failed:", error);
    return false;
  }
}

async function sendForUser(row: any) {
  if (!row.enabled) {
    return { sent: 0 };
  }

  const tz = row.timezone || "UTC";
  const now = parts(tz);

  if (
    quiet(
      now.minute,
      row.quiet_enabled,
      row.quiet_start,
      row.quiet_end
    )
  ) {
    return {
      sent: 0,
      quiet: true
    };
  }

  row = await ensurePlan(
    row,
    now.date
  );

  const slots = Array.isArray(row.slots)
    ? row.slots
    : [];

  const due = slots
    .map((m: number, i: number) => ({
      m,
      i
    }))
    .filter(
      x =>
        x.m <= now.minute &&
        !(row.sent_slots || {})[String(x.i)]
    );

  if (!due.length) {
    return { sent: 0 };
  }

  const {
    data: habits,
    error: hErr
  } = await admin
    .from("habits")
    .select("id,name,created_at")
    .eq("user_id", row.user_id)
    .order("created_at", {
      ascending: true
    });

  if (hErr) throw hErr;

  const eligible = (habits || []).filter(
    (h: any) =>
      String(h.created_at).slice(0, 10) <=
      now.date
  );

  if (!eligible.length) {
    return { sent: 0 };
  }

  const {
    data: comps,
    error: cErr
  } = await admin
    .from("habit_completions")
    .select("habit_id,value")
    .eq("user_id", row.user_id)
    .eq("completion_date", now.date);

  if (cErr) throw cErr;

  const done = new Set(
    (comps || [])
      .filter((c: any) => c.value === 1)
      .map((c: any) => c.habit_id)
  );

  const skipped = new Set(
    (comps || [])
      .filter((c: any) => c.value === 0)
      .map((c: any) => c.habit_id)
  );

  const pool = eligible.filter(
    (h: any) =>
      !done.has(h.id) &&
      !skipped.has(h.id)
  );

  if (!pool.length) {
    return { sent: 0 };
  }

  const dueSlot = due[due.length - 1];

  const claimed = await admin.rpc(
    "claim_habit_reminder_slot",
    {
      p_user_id: row.user_id,
      p_slot_index: dueSlot.i,
      p_plan_date: now.date
    }
  );

  if (claimed.error) {
    throw claimed.error;
  }

  if (!claimed.data) {
    return {
      sent: 0,
      claimed: false
    };
  }

  const last = row.last_habit_id;

  const candidates =
    pool.length > 1
      ? pool.filter(
          (h: any) => h.id !== last
        )
      : pool;

  const source =
    candidates.length
      ? candidates
      : pool;

  const habit =
    source[
      Math.floor(
        Math.random() * source.length
      )
    ];

  const result = await sendPush(
    row.user_id,
    "Habit Flow",
    `You haven't completed "${habit.name}" yet. Take a moment to do it now.`
  );

  if (!result.ok) {
    await admin.rpc(
      "release_habit_reminder_slot",
      {
        p_user_id: row.user_id,
        p_slot_index: dueSlot.i,
        p_plan_date: now.date
      }
    );

    return {
      sent: 0,
      pushFailed: true,
      pushStatus: result.status,
      pushResponse: result.data
    };
  }

  await admin
    .from("habit_reminder_plans")
    .update({
      last_habit_id: habit.id,
      updated_at: new Date().toISOString()
    })
    .eq("user_id", row.user_id);

  return {
    sent: 1,
    habit: habit.name,
    slot: dueSlot.i
  };
}

Deno.serve(async req => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "POST required"
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
      .from("habit_reminder_plans")
      .select("*")
      .eq("enabled", true);

    if (error) throw error;

    const results = [];

    for (const row of rows || []) {
      try {
        results.push({
          user_id: row.user_id,
          ...(await sendForUser(row))
        });
      } catch (e) {
        results.push({
          user_id: row.user_id,
          error: String(e)
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
        error: String(e)
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
});