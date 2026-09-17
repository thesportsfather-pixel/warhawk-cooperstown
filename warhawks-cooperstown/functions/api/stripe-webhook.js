function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function hex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((b) =>
      b.toString(16).padStart(2, "0")
    )
    .join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);
  }

  return result === 0;
}

async function verifyStripeSignature(
  payload,
  header,
  secret
) {
  if (!header || !secret) {
    return false;
  }

  const timestampMatch =
    header.match(/(?:^|,)t=([^,]+)/);

  const signatureMatches = [
    ...header.matchAll(/(?:^|,)v1=([^,]+)/g),
  ];

  const timestamp =
    timestampMatch?.[1];

  const signatures =
    signatureMatches.map(
      (match) => match[1]
    );

  if (
    !timestamp ||
    signatures.length === 0
  ) {
    return false;
  }

  const age = Math.abs(
    Math.floor(Date.now() / 1000) -
      Number(timestamp)
  );

  if (
    !Number.isFinite(age) ||
    age > 300
  ) {
    return false;
  }

  const key =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    );

  const digest =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        `${timestamp}.${payload}`
      )
    );

  const expected =
    hex(digest);

  return signatures.some(
    (signature) =>
      safeEqual(
        expected,
        signature
      )
  );
}

async function markSold(
  env,
  session
) {
  const metadata =
    session?.metadata || {};

  if (
    metadata.payment_type !==
    "baseball"
  ) {
    return;
  }

  if (
    session.payment_status !==
    "paid"
  ) {
    return;
  }

  const playerId =
    metadata.player_id;

  const numbers =
    String(
      metadata.baseball_numbers || ""
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
    return;
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
}

export async function onRequestPost({
  request,
  env,
}) {
  try {
    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY ||
      !env.STRIPE_WEBHOOK_SECRET
    ) {
      return json(
        {
          success: false,
          error:
            "Missing webhook configuration.",
        },
        500
      );
    }

    const payload =
      await request.text();

    const signature =
      request.headers.get(
        "stripe-signature"
      );

    const valid =
      await verifyStripeSignature(
        payload,
        signature,
        env.STRIPE_WEBHOOK_SECRET
      );

    if (!valid) {
      return json(
        {
          success: false,
          error:
            "Invalid Stripe signature.",
        },
        400
      );
    }

    const event =
      JSON.parse(payload);

    if (
      event.type ===
      "checkout.session.completed"
    ) {
      await markSold(
        env,
        event.data.object
      );
    }

    return json({
      received: true,
    });
  } catch (error) {
    console.error(error);

    return json(
      {
        success: false,
        error:
          error?.message ||
          "Webhook failed.",
      },
      500
    );
  }
}
