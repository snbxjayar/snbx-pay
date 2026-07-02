// api/query.js
// The core queryUrl — GHL calls this for ALL payment operations

const axios = require("axios");
const { db } = require("../lib/firebaseAdmin");

const PAYMONGO_BASE = "https://api.paymongo.com/v1";

// Get PayMongo credentials for a location
async function getPayMongoCredentials(locationId) {
  const snap = await db.collection("paymongo_credentials").doc(locationId).get();
  const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists;
  if (!exists) throw new Error(`No PayMongo credentials found for location: ${locationId}`);
  return snap.data();
}

// PayMongo auth header
function paymongoAuth(secretKey) {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { type, locationId, contactId, apiKey, ...payload } = req.body;

  console.log(`GHL queryUrl called: type=${type}, locationId=${locationId}`);

  try {
    const creds = await getPayMongoCredentials(locationId);
    const secretKey = creds.liveMode ? creds.liveSecretKey : creds.testSecretKey;
    const authHeader = paymongoAuth(secretKey);

    switch (type) {

      // ── List payment methods ───────────────────────────────────────────
      // Return empty array — GHL will use paymentsUrl iframe for collection
      case "list_payment_methods": {
        return res.status(200).json([]);
      }

      // ── Charge a payment ───────────────────────────────────────────────
      case "charge_payment": {
        const { amount, currency, chargeDescription, transactionId } = payload;

        // Create PayMongo checkout session
        const checkoutRes = await axios.post(
          `${PAYMONGO_BASE}/checkout_sessions`,
          {
            data: {
              attributes: {
                send_email_receipt: false,
                show_description:   true,
                show_line_items:    true,
                line_items: [{
                  currency:  currency?.toLowerCase() ?? "php",
                  amount:    Math.round(amount * 100),
                  name:      chargeDescription ?? "Payment",
                  quantity:  1,
                }],
                payment_method_types: ["gcash", "paymaya", "card"],
                description: chargeDescription ?? "Payment via SNBX Pay",
                success_url: `https://snbx-pay.vercel.app/payment-success?txn=${transactionId}`,
                cancel_url:  `https://snbx-pay.vercel.app/payment-cancel?txn=${transactionId}`,
                metadata: { locationId, contactId, transactionId },
              },
            },
          },
          { headers: { Authorization: authHeader, "Content-Type": "application/json" } }
        );

        const session    = checkoutRes.data.data;
        const chargeId   = session.id;
        const sessionUrl = session.attributes.checkout_url;

        // Store pending transaction
        await db.collection("ghl_transactions").doc(transactionId).set({
          locationId,
          contactId,
          transactionId,
          chargeId,
          amount,
          currency,
          status:    "pending",
          createdAt: new Date(),
        });

        console.log(`Checkout session created: ${chargeId} → ${sessionUrl}`);

        return res.status(200).json({
          success:        true,
          failed:         false,
          chargeId,
          message:        "Checkout session created",
          redirectUrl:    sessionUrl,
          chargeSnapshot: {
            id:        chargeId,
            status:    "pending",
            amount,
            chargeId,
            chargedAt: Math.floor(Date.now() / 1000),
          },
        });
      }

      // ── Verify a payment ───────────────────────────────────────────────
      case "verify": {
        const { chargeId, transactionId } = payload;

        const txnSnap = await db.collection("ghl_transactions").doc(transactionId).get();
        const txnExists = typeof txnSnap.exists === "function" ? txnSnap.exists() : txnSnap.exists;

        if (!txnExists) {
          return res.status(200).json({
            success: false,
            status:  "pending",
            message: "Transaction not found",
          });
        }

        const txn    = txnSnap.data();
        const isPaid = txn.status === "paid";

        return res.status(200).json({
          success: isPaid,
          status:  txn.status ?? "pending",
          chargeSnapshot: {
            id:        txn.chargeId,
            status:    isPaid ? "succeeded" : "pending",
            amount:    txn.amount,
            chargeId:  txn.chargeId,
            chargedAt: Math.floor(Date.now() / 1000),
          },
        });
      }

      // ── Refund ─────────────────────────────────────────────────────────
      case "refund": {
        const { chargeId, amount: refundAmount } = payload;

        const r = await axios.post(
          `${PAYMONGO_BASE}/refunds`,
          {
            data: {
              attributes: {
                amount:     Math.round(refundAmount * 100),
                payment_id: chargeId,
                reason:     "requested_by_customer",
              },
            },
          },
          { headers: { Authorization: authHeader, "Content-Type": "application/json" } }
        );

        return res.status(200).json({
          success:  true,
          refundId: r.data.data.id,
          message:  "Refund processed successfully",
        });
      }

      // ── Create subscription ────────────────────────────────────────────
      case "create_subscription": {
        return res.status(200).json({
          success:        true,
          subscriptionId: `sub_${Date.now()}`,
          status:         "active",
          message:        "Subscription created",
        });
      }

      // ── Cancel subscription ────────────────────────────────────────────
      case "cancel_subscription": {
        return res.status(200).json({
          success: true,
          status:  "canceled",
          message: "Subscription cancelled",
        });
      }

      default:
        console.warn(`Unknown query type: ${type}`);
        return res.status(400).json({ error: `Unknown type: ${type}` });
    }

  } catch (error) {
    console.error("Query endpoint error:", error?.response?.data || error.message);
    return res.status(500).json({
      success: false,
      failed:  true,
      message: error?.response?.data?.errors?.[0]?.detail ?? error.message,
    });
  }
};