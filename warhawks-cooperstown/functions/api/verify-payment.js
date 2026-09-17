function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function markSold(
  env,
  session
) {
  const metadata =
    session?.metadata || {};

  if (
    metadata.payment_type !==
      "baseball" ||
    session.payment_status !==
      "paid"
  ) {
    return {
      updated: false,
    };
  }

  const playerId =
    metadata.player_id;

  const numbers =
    String(
      metadata.baseball_numbers ||
      ""
    )
      .split(",")
      .map(Number)
      .filter(
        (number) =>
          Number.isInteger(number) &&
          number >= 1 &&
          number <= 100
      );

  if (
    !playerId ||
    numbers.length === 0
  ) {
    return {
      updated: false,
    };
  }

  const donorName =
    String(
      metadata.donor_name ||
      "Anonymous"
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 50) ||
    "Anonymous";

  const response =
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/baseballs` +
        `?player_id=eq.${encodeURIComponent(
          playerId
        )}` +
        `&ball_number=in.(${numbers.join(",")})`,
      {
        method: "PATCH",

        headers: {
          apikey:
            env.SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,

          "Content-Type":
            "application/json",

          Prefer:
            "return=minimal",
        },

        body:
          JSON.stringify({
            status: "sold",
            donor_name: donorName,
          }),
      }
    );

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${await response.text()}`
    );
  }

  return {
    updated: true,
    playerKey:
      metadata.player_key,
    baseballNumbers:
      numbers,
    donorName,
  };
}

export async function onRequestGet({
  request,
  env,
}) {
  try {
    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY ||
      !env.STRIPE_SECRET_KEY
    ) {
      return json(
        {
          success: false,
          error:
            "Missing server configuration.",
        },
        500
      );
    }

    const sessionId =
      new URL(request.url)
        .searchParams
        .get("session_id");

    if (
      !sessionId ||
      !sessionId.startsWith("cs_")
    ) {
      return json(
        {
          success: false,
          error:
            "A valid Stripe session_id is required.",
        },
        400
      );
    }

    const stripeResponse =
      await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
          sessionId
        )}`,
        {
          headers: {
            Authorization:
              `Bearer ${env.STRIPE_SECRET_KEY}`,
          },
        }
      );

    const session =
      await stripeResponse.json();

    if (!stripeResponse.ok) {
      throw new Error(
        session?.error?.message ||
          "Unable to verify payment."
      );
    }

    const paid =
      session.payment_status ===
      "paid";

    const result =
      paid
        ? await markSold(
            env,
            session
          )
        : {
            updated: false,
          };

    return json({
      success: true,
      paid,
      paymentStatus:
        session.payment_status,
      ...result,
    });
  } catch (error) {
    console.error(error);

    return json(
      {
        success: false,
        error:
          error?.message ||
          "Unable to verify payment.",
      },
      500
    );
  }
}
