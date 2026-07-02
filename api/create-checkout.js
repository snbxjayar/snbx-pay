// api/create-checkout.js
// Creates a PayMongo checkout session for the iframe flow

const axios = require("axios");
const { db } = require("../lib/firebaseAdmin");

const PAYMONGO_BASE = "https://api.paymongo.com/v1";

function paymongoAuth(secretKey) {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      locationId, transactionId, amount,
      currency, description, paymentMethod, contactId,
    } = req.body;

    if (!locationId) return res.status(400).json({ error: "Missing locationId" });

    // Get PayMongo credentials for this location
    const snap = await db.collection("paymongo_credentials").doc(locationId).get();
    const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists;
    if (!exists) return res.status(400).json({ error: "No credentials found for this location" });

    const creds     = snap.data();
    const secretKey = creds.liveMode ? creds.liveSecretKey : creds.testSecretKey;
    const authHeader = paymongoAuth(secretKey);

    // Determine payment methods to show
    const methods = paymentMethod
      ? [paymentMethod]
      : ["gcash", "paymaya", "card"];

    const checkoutRes = await axios.post(
      `${PAYMONGO_BASE}/checkout_sessions`,
      {
        data: {
          attributes: {
            send_email_receipt:   false,
            show_description:     true,
            show_line_items:      true,
            line_items: [{
              currency: (currency ?? "PHP").toUpperCase(),
              amount:   Math.round(amount * 100),
              name:     description ?? "Payment",
              quantity: 1,
            }],
            payment_method_types: methods,
            description:          description ?? "Payment via SNBX Pay",
            success_url: `https://snbx-pay.vercel.app/payment-success?txn=${transactionId}`,
            cancel_url:  `https://snbx-pay.vercel.app/payment-cancel?txn=${transactionId}`,
            metadata: { locationId, contactId, transactionId },
          },
        },
      },
      { headers: { Authorization: authHeader, "Content-Type": "application/json" } }
    );

    const session = checkoutRes.data.data;

    // Store pending transaction
    await db.collection("ghl_transactions").doc(transactionId).set({
      locationId, contactId, transactionId,
      chargeId:  session.id,
      amount, currency,
      status:    "pending",
      createdAt: new Date(),
    });

    return res.status(200).json({
      success:     true,
      checkoutUrl: session.attributes.checkout_url,
      chargeId:    session.id,
    });

  } catch (e) {
    console.error("Create checkout error:", e?.response?.data || e.message);
    return res.status(500).json({ error: e?.response?.data?.errors?.[0]?.detail ?? e.message });
  }
};