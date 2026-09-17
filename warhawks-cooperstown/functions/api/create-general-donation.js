function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function cleanDonorName(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 50);

  return cleaned || "Anonymous";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.STRIPE_SECRET_KEY) {
      return json(
        {
          success: false,
          error: "Missing Stripe configuration.",
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

    const amount = Number(body?.amount);
    const donorName = cleanDonorName(
      body?.donorName
    );

    if (
      !Number.isFinite(amount) ||
      amount < 1
    ) {
      return json(
        {
          success: false,
          error:
            "Donation must be at least $1.",
        },
        400
      );
    }

    const amountCents =
      Math.round(amount * 100);

    const origin =
      new URL(request.url).origin;

    const form =
      new URLSearchParams();

    form.set(
      "mode",
      "payment"
    );

    form.set(
      "success_url",
      `${origin}/?general_donation=success&session_id={CHECKOUT_SESSION_ID}`
    );

    form.set(
      "cancel_url",
      `${origin}/?general_donation=cancelled`
    );

    form.set(
      "metadata[payment_type]",
      "general"
    );

    form.set(
      "metadata[team_key]",
      "warhawks-cooperstown"
    );

    form.set(
      "metadata[donor_name]",
      donorName
    );

    form.set(
      "line_items[0][price_data][currency]",
      "usd"
    );

    form.set(
      "line_items[0][price_data][unit_amount]",
      String(amountCents)
    );

    form.set(
      "line_items[0][price_data][product_data][name]",
      "Warhawks Baseball - General Team Donation"
    );

    form.set(
      "line_items[0][price_data][product_data][description]",
      "Road to Cooperstown fundraiser"
    );

    form.set(
      "line_items[0][quantity]",
      "1"
    );

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
      throw new Error(
        stripeData?.error?.message ||
          "Unable to create donation checkout."
      );
    }

    if (!stripeData?.url) {
      throw new Error(
        "Checkout URL was not returned."
      );
    }

    return json({
      success: true,
      url: stripeData.url,
      sessionId: stripeData.id,
    });
  } catch (error) {
    console.error(error);

    return json(
      {
        success: false,
        error:
          error?.message ||
          "Unable to create donation checkout.",
      },
      500
    );
  }
}
