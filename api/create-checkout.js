// api/create-checkout.js
// Creates a PayMongo checkout session for the iframe flow

const axios = require("axios");
const { db } = require("../lib/firebaseAdmin");

const PAYMONGO_BASE = "https://api.paymongo.com/v1";

// Add near the top
const GHL_BASE = "https://services.leadconnectorhq.com";

async function getLatestPendingGhlTxn(locationId) {
  const res = await axios.get(`${GHL_BASE}/payments/transactions`, {
    params: { altId: locationId, altType: "location" },
    headers: {
      Authorization: `Bearer ${process.env.GHL_PIT_TOKEN}`,
      Version: "2021-07-28",
    },
  });
  const txns = res.data?.data ?? [];
  const cutoff = Date.now() - 30 * 60 * 1000;
  return txns.find(t =>
    t.status === "pending" &&
    new Date(t.createdAt).getTime() > cutoff
  );
}

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
    const { locationId, paymentMethod } = req.body;

    if (!locationId) return res.status(400).json({ error: "Missing locationId" });

    // Authoritative transaction data from GHL, not from the iframe
    const ghlTxn = await getLatestPendingGhlTxn(locationId);
    if (!ghlTxn) {
      return res.status(400).json({
        error: "No pending GHL transaction found — please submit the order form first.",
      });
    }

    const transactionId = ghlTxn._id;
    const amount        = ghlTxn.amount;
    const currency      = ghlTxn.currency ?? "PHP";
    const description   = ghlTxn.entitySourceName ?? "SNBX Pay Payment";
    const contactId     = ghlTxn.contactId ?? "";

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
            liveMode:  ghlTxn.liveMode ?? false,   // ← add this line
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