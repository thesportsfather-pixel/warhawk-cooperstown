function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function supabaseFetch(env, path) {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${path}`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}

function normalizeBaseballs(baseballs) {
  if (!Array.isArray(baseballs)) {
    return [];
  }

  const cleaned = baseballs
    .map((number) => Number(number))
    .filter(
      (number) =>
        Number.isInteger(number) &&
        number >= 1 &&
        number <= 100
    );

  return [...new Set(cleaned)].sort(
    (a, b) => a - b
  );
}

function cleanDonorName(donorName) {
  const cleaned = String(donorName || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 50);

  return cleaned || "Anonymous";
}

export async function onRequestPost({ request, env }) {
  try {
    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY ||
      !env.STRIPE_SECRET_KEY
    ) {
      return json(
        {
          success: false,
          error: "Missing server configuration.",
        },
        500
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json(
        {
          success: false,
          error: "Invalid request body.",
        },
        400
      );
    }

    const playerKey = String(
      body?.playerKey || ""
    ).trim();

    const baseballNumbers = normalizeBaseballs(
      body?.baseballs
    );

    const donorName = cleanDonorName(
      body?.donorName
    );

    if (!playerKey) {
      return json(
        {
          success: false,
          error: "Player is required.",
        },
        400
      );
    }

    if (baseballNumbers.length === 0) {
      return json(
        {
          success: false,
          error: "Select at least one baseball.",
        },
        400
      );
    }

    const TEAM_KEY = "warhawks-cooperstown";

    const teams = await supabaseFetch(
      env,
      `teams?team_key=eq.${encodeURIComponent(
        TEAM_KEY
      )}&select=id,team_key,team_name&limit=1`
    );

    if (!Array.isArray(teams) || teams.length === 0) {
      return json(
        {
          success: false,
          error: "Team not found.",
        },
        404
      );
    }

    const team = teams[0];

    const players = await supabaseFetch(
      env,
      `players?team_id=eq.${encodeURIComponent(
        team.id
      )}&player_key=eq.${encodeURIComponent(
        playerKey
      )}&select=id,player_key,player_name,player_number&limit=1`
    );

    if (
      !Array.isArray(players) ||
      players.length === 0
    ) {
      return json(
        {
          success: false,
          error: "Player not found.",
        },
        404
      );
    }

    const player = players[0];

    const baseballs = await supabaseFetch(
      env,
      `baseballs?player_id=eq.${encodeURIComponent(
        player.id
      )}&ball_number=in.(${baseballNumbers.join(
        ","
      )})&select=id,ball_number,amount_cents,status&order=ball_number.asc`
    );

    if (
      !Array.isArray(baseballs) ||
      baseballs.length !== baseballNumbers.length
    ) {
      return json(
        {
          success: false,
          error:
            "One or more baseballs could not be found.",
        },
        400
      );
    }

    const unavailable = baseballs.filter(
      (baseball) =>
        baseball.status !== "available"
    );

    if (unavailable.length > 0) {
      return json(
        {
          success: false,
          error:
            `Baseball${
              unavailable.length === 1 ? "" : "s"
            } ${unavailable
              .map((ball) => `#${ball.ball_number}`)
              .join(", ")} ${
              unavailable.length === 1 ? "is" : "are"
            } no longer available.`,
        },
        409
      );
    }

    const origin = new URL(request.url).origin;
    const form = new URLSearchParams();

    form.set("mode", "payment");

    form.set(
      "success_url",
      `${origin}/fundraiser.html?player=${encodeURIComponent(
        player.player_key
      )}&payment=success&session_id={CHECKOUT_SESSION_ID}`
    );

    form.set(
      "cancel_url",
      `${origin}/fundraiser.html?player=${encodeURIComponent(
        player.player_key
      )}&payment=cancelled`
    );

    form.set(
      "metadata[payment_type]",
      "baseball"
    );

    form.set(
      "metadata[team_key]",
      TEAM_KEY
    );

    form.set(
      "metadata[team_id]",
      String(team.id)
    );

    form.set(
      "metadata[player_id]",
      String(player.id)
    );

    form.set(
      "metadata[player_key]",
      String(player.player_key)
    );

    form.set(
      "metadata[player_name]",
      String(player.player_name).slice(0, 100)
    );

    form.set(
      "metadata[player_number]",
      String(player.player_number)
    );

    form.set(
      "metadata[baseball_numbers]",
      baseballNumbers.join(",")
    );

    form.set(
      "metadata[donor_name]",
      donorName
    );

    baseballs.forEach((baseball, index) => {
      form.set(
        `line_items[${index}][price_data][currency]`,
        "usd"
      );

      form.set(
        `line_items[${index}][price_data][unit_amount]`,
        String(baseball.amount_cents)
      );

      form.set(
        `line_items[${index}][price_data][product_data][name]`,
        `Warhawks Baseball - ${player.player_name} - Baseball #${baseball.ball_number}`
      );

      form.set(
        `line_items[${index}][price_data][product_data][description]`,
        "Road to Cooperstown fundraiser"
      );

      form.set(
        `line_items[${index}][quantity]`,
        "1"
      );
    });

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${env.STRIPE_SECRET_KEY}`,

          "Content-Type":
            "application/x-www-form-urlencoded",
        },

        body: form.toString(),
      }
    );

    const stripeData =
      await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error(
        "Stripe error:",
        stripeData
      );

      throw new Error(
        stripeData?.error?.message ||
          "Unable to create Stripe checkout."
      );
    }

    if (!stripeData?.url) {
      throw new Error(
        "Stripe checkout URL was not returned."
      );
    }

    return json({
      success: true,
      url: stripeData.url,
      sessionId: stripeData.id,
      playerKey: player.player_key,
      baseballs: baseballNumbers,
      donorName,
    });
  } catch (error) {
    console.error(error);

    return json(
      {
        success: false,
        error:
          error?.message ||
          "Unable to create checkout.",
      },
      500
    );
  }
}
