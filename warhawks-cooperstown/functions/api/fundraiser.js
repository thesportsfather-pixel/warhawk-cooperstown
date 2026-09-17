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

export async function onRequestGet({ request, env }) {
  try {
    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return json(
        {
          success: false,
          error: "Missing Supabase configuration.",
        },
        500
      );
    }

    const url = new URL(request.url);
    const playerKey = (
      url.searchParams.get("player") || ""
    ).trim();

    if (!playerKey) {
      return json(
        {
          success: false,
          error: "Player is required.",
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

    if (!Array.isArray(players) || players.length === 0) {
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
      )}&select=id,ball_number,amount_cents,status,donor_name&order=ball_number.asc`
    );

    const safeBaseballs = Array.isArray(baseballs)
      ? baseballs
      : [];

    let raisedCents = 0;
    let soldCount = 0;

    for (const baseball of safeBaseballs) {
      if (baseball.status === "sold") {
        raisedCents += Number(baseball.amount_cents || 0);
        soldCount += 1;
      }
    }

    return json({
      success: true,

      team: {
        key: team.team_key,
        name: team.team_name,
      },

      player: {
        id: player.id,
        key: player.player_key,
        name: player.player_name,
        number: player.player_number,
      },

      baseballs: safeBaseballs,

      totals: {
        soldCount,
        raisedCents,
        raisedDollars: raisedCents / 100,
        goalDollars: 5050,
      },
    });
  } catch (error) {
    console.error(error);

    return json(
      {
        success: false,
        error:
          error?.message ||
          "Unable to load fundraiser.",
      },
      500
    );
  }
}
