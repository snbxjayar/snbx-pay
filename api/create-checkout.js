// api/create-checkout.js
// Place at: snbxsf-pay/api/create-checkout.js
//
// Endpoint: POST /api/create-checkout
// Called by SNBX Pro app when subscriber taps a payment option.

const axios = require("axios");
const { db, admin } = require("../lib/firebaseAdmin");

// PayMongo secret key — set in Vercel environment variables, never in code
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_BASE_URL   = "https://api.paymongo.com/v1";

// Where PayMongo redirects after payment (success/failure)
const SUCCESS_URL = "https://snbxpro.com/payment-success";
const CANCEL_URL  = "https://snbxpro.com/payment-cancel";

function authHeader() {
  const encoded = Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
}

module.exports = async (req, res) => {
  // CORS — allow requests from the mobile app
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { userId, amount, method, type, description, planTarget } = req.body;

    // ── Validate input ──────────────────────────────────────────────────────
    if (!userId || !amount || !method || !type || !description) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const validMethods = ["gcash", "maya", "card"];
    if (!validMethods.includes(method)) {
      return res.status(400).json({ error: "Invalid payment method." });
    }

    const amountCentavos = Math.round(amount * 100); // PayMongo uses centavos

    // ── Create PayMongo Checkout Session ────────────────────────────────────
    const checkoutPayload = {
      data: {
        attributes: {
          send_email_receipt: false,
          show_description: true,
          show_line_items: true,
          line_items: [
            {
              currency: "PHP",
              amount: amountCentavos,
              name: description,
              quantity: 1,
            },
          ],
          payment_method_types: [method],
          description: description,
          success_url: SUCCESS_URL,
          cancel_url: CANCEL_URL,
        },
      },
    };

    const checkoutRes = await axios.post(
      `${PAYMONGO_BASE_URL}/checkout_sessions`,
      checkoutPayload,
      { headers: authHeader() }
    );

    const checkoutData      = checkoutRes.data.data;
    const checkoutId        = checkoutData.id;
    const checkoutUrl       = checkoutData.attributes.checkout_url;

    // ── Save pending payment record to Firestore ────────────────────────────
    const paymentRef = await db.collection("payments").add({
      userId,
      type,                        // "plan_upgrade" | "sim_load" | "renewal"
      amount,
      method,
      status: "pending",
      description,
      planTarget: planTarget ?? null,
      paymongoCheckoutId: checkoutId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      checkoutUrl,
      checkoutId,
      paymentId: paymentRef.id,
    });

  } catch (error) {
    console.error("create-checkout error:", error?.response?.data || error.message);
    return res.status(500).json({
      error: "Failed to create checkout session.",
      details: error?.response?.data?.errors ?? error.message,
    });
  }
};