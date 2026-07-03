// api/webhook.js
//
// Endpoint: POST /api/webhook
// Called by PayMongo automatically when a payment succeeds or fails.
// Registered in PayMongo Dashboard → Developers → Webhooks.
//
// Flow: PayMongo payment.paid → update Firestore → send payment.captured
// to GHL so the Order/Transaction flips to Completed (triggers workflows).

const crypto = require("crypto");
const axios  = require("axios");
const { db } = require("../lib/firebaseAdmin");

const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET;
const GHL_BASE = "https://services.leadconnectorhq.com";

// Vercel needs raw body for signature verification — disable default parsing
module.exports.config = {
  api: { bodyParser: false },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;

  // PayMongo signature header format: t=timestamp,te=test_signature,li=live_signature
  const parts = signatureHeader.split(",").reduce((acc, part) => {
    const [key, value] = part.split("=");
    acc[key] = value;
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.li || parts.te;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  return signature === expectedSignature;
}

// Fallback only: find newest pending GHL transaction by amount + recency.
// Used if the stored transactionId is somehow not a real GHL transaction id.
async function findGhlTransaction(locationId, amount) {
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
    Number(t.amount) === Number(amount) &&
    new Date(t.createdAt).getTime() > cutoff
  );
}

// Tell GHL the payment was captured — flips Order/Transaction to Completed
async function notifyGhlPaymentCaptured(locationId, ghlTransactionId, chargeId, amount, liveMode) {
  const credsSnap = await db.collection("paymongo_credentials").doc(locationId).get();
  const creds = credsSnap.data();
  const apiKey = liveMode ? creds.liveSecretKey : creds.testSecretKey;

  const res = await axios.post(
    "https://backend.leadconnectorhq.com/payments/custom-provider/webhook",
    {
      event: "payment.captured",
      chargeId,
      ghlTransactionId,
      chargeSnapshot: {
        status: "succeeded",
        amount: Number(amount),
        chargeId,
        chargedAt: Math.floor(Date.now() / 1000),
      },
      locationId,
      apiKey,
    },
    { headers: { "Content-Type": "application/json" } }
  );
  console.log(`GHL payment.captured sent for txn ${ghlTransactionId}:`, res.status);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const rawBody = await getRawBody(req);
    const signatureHeader = req.headers["paymongo-signature"];

    // ── Verify this request actually came from PayMongo ─────────────────
    const isValid = verifySignature(rawBody, signatureHeader, PAYMONGO_WEBHOOK_SECRET);
    if (!isValid) {
      console.warn("Webhook signature verification failed.");
      return res.status(401).json({ error: "Invalid signature." });
    }

    const event     = JSON.parse(rawBody);
    const eventType = event.data?.attributes?.type;
    const eventData = event.data?.attributes?.data;

    console.log("PayMongo webhook received:", eventType);

    // ── Handle successful checkout payment ──────────────────────────────
    if (eventType === "checkout_session.payment.paid") {
      const checkoutId = eventData?.id;
      const metadata   = eventData?.attributes?.metadata ?? {};
      const { locationId, transactionId } = metadata;

      if (transactionId) {
        // 1. Update our own Firestore record
        let storedTxn = null;
        try {
          const docRef = db.collection("ghl_transactions").doc(transactionId);
          await docRef.update({
            status:  "paid",
            paidAt:  new Date(),
            checkoutId,
          });
          const snap = await docRef.get();
          storedTxn = snap.data();
          console.log(`Transaction ${transactionId} marked as paid in Firestore`);
        } catch (e) {
          console.error("Firestore update error:", e.message);
        }

        // 2. Sync status to GHL — flips Order/Transaction to Completed
        try {
          if (storedTxn) {
            // transactionId is the real GHL transaction _id (set by create-checkout)
            await notifyGhlPaymentCaptured(
              locationId,
              transactionId,
              checkoutId,
              storedTxn.amount,
              storedTxn.liveMode ?? false
            );
          } else {
            // Fallback: match by amount + recency
            const amountPaid = (eventData?.attributes?.line_items?.[0]?.amount ?? 0) / 100;
            const ghlTxn = await findGhlTransaction(locationId, amountPaid);
            if (ghlTxn) {
              await notifyGhlPaymentCaptured(
                locationId,
                ghlTxn._id,
                checkoutId,
                ghlTxn.amount,
                ghlTxn.liveMode ?? false
              );
            } else {
              console.warn("No matching pending GHL transaction found for amount:", amountPaid);
            }
          }
        } catch (e) {
          console.error("GHL sync error:", e?.response?.data || e.message);
        }
      } else {
        console.warn("No transactionId in PayMongo metadata — cannot sync to GHL.");
      }
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error("Webhook processing error:", error.message);
    return res.status(500).json({ error: "Webhook processing failed." });
  }
};