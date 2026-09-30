import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY
);

webpush.setVapidDetails(
  "mailto:habitflow@zaid2233131.github.io",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

Deno.serve(async (req) => {

  try {

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "POST required" }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const body = await req.json();

    const {
      user_id,
      title = "Habit Flow",
      message = "You have a reminder."
    } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({
          error: "user_id is required"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }


    const { data: subscriptions, error } =
      await supabaseAdmin
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", user_id);


    if (error) {
      console.error(
        "Subscription query failed:",
        error
      );

      return new Response(
        JSON.stringify({
          error: error.message
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }


    if (!subscriptions || subscriptions.length === 0) {

      return new Response(
        JSON.stringify({
          error: "No push subscriptions found for this user."
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    const results = [];


    for (const sub of subscriptions) {

      try {

        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth
            }
          },
          JSON.stringify({
            title,
            body: message,
            icon:
              "https://zaid2233131.github.io/habit-flow/icon-192.png",
            badge:
              "https://zaid2233131.github.io/habit-flow/icon-192.png"
          }),
          {
            TTL: 300,
            urgency: "high"
          }
        );


        results.push({
          id: sub.id,
          success: true
        });


      } catch (pushError) {

        console.error(
          "Push failed for subscription:",
          sub.id,
          pushError
        );


        results.push({
          id: sub.id,
          success: false,
          error: String(pushError)
        });


        /*
          If Apple/browser tells us that this subscription
          is permanently gone, remove it from the database.
        */

        const errorText =
          String(pushError);

        if (
          errorText.includes("404") ||
          errorText.includes("410")
        ) {

          await supabaseAdmin
            .from("push_subscriptions")
            .delete()
            .eq("id", sub.id);

        }

      }

    }


    return new Response(
      JSON.stringify({
        success: true,
        sent: results
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );


  } catch (error) {

    console.error(
      "Push function error:",
      error
    );


    return new Response(
      JSON.stringify({
        success: false,
        error: String(error)
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  }

});