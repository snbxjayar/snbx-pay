// api/webhook.js
// Place at: snbxsf-pay/api/webhook.js
//
// Endpoint: POST /api/webhook
// Called by PayMongo automatically when a payment succeeds or fails.
// You must register this URL in PayMongo Dashboard → Developers → Webhooks.

const crypto = require("crypto");
const { db, admin } = require("../lib/firebaseAdmin");

const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET;

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
  const signature = parts.li || parts.te; // live or test signature

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  return signature === expectedSignature;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const rawBody = await getRawBody(req);
    const signatureHeader = req.headers["paymongo-signature"];

    // ── Verify this request actually came from PayMongo ─────────────────────
    const isValid = verifySignature(rawBody, signatureHeader, PAYMONGO_WEBHOOK_SECRET);
    if (!isValid) {
      console.warn("Webhook signature verification failed.");
      return res.status(401).json({ error: "Invalid signature." });
    }

    const event = JSON.parse(rawBody);
    const eventType = event.data?.attributes?.type;
    const eventData  = event.data?.attributes?.data;

    console.log("PayMongo webhook received:", eventType);

    // ── Handle checkout session payment events ──────────────────────────────
    if (eventType === "checkout_session.payment.paid") {
      const checkoutId = eventData?.id;
      await handlePaymentSuccess(checkoutId);
    } else if (eventType === "checkout_session.payment.failed") {
      const checkoutId = eventData?.id;
      await handlePaymentFailed(checkoutId);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error("Webhook processing error:", error.message);
    return res.status(500).json({ error: "Webhook processing failed." });
  }
};

// ── Handle successful payment ───────────────────────────────────────────────
async function handlePaymentSuccess(checkoutId) {
  const paymentsSnap = await db
    .collection("payments")
    .where("paymongoCheckoutId", "==", checkoutId)
    .limit(1)
    .get();

  if (paymentsSnap.empty) {
    console.warn("No matching payment found for checkout:", checkoutId);
    return;
  }

  const paymentDoc = paymentsSnap.docs[0];
  const payment    = paymentDoc.data();

  // 1. Update payment status to paid
  await paymentDoc.ref.update({
    status: "paid",
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // 2. If this was a plan upgrade, update the subscriber's plan
  if (payment.type === "plan_upgrade" && payment.planTarget) {
    const subsSnap = await db
      .collection("subscriptions")
      .where("userId", "==", payment.userId)
      .limit(1)
      .get();

    if (!subsSnap.empty) {
      const subDoc = subsSnap.docs[0];
      const newRenewal = new Date();
      newRenewal.setDate(newRenewal.getDate() + 30);

      await subDoc.ref.update({
        plan: payment.planTarget,
        status: "active",
        renewalDate: newRenewal,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`Subscription updated to ${payment.planTarget} for user ${payment.userId}`);
    } else {
      console.warn("No subscription doc found for user:", payment.userId);
    }
  }

  // 3. If this was a SIM load top-up, log it (optional: track load balance)
  if (payment.type === "sim_load") {
    await db.collection("sim_load_history").add({
      userId: payment.userId,
      amount: payment.amount,
      paymentId: paymentDoc.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  console.log(`Payment ${paymentDoc.id} marked as paid.`);
}

// ── Handle failed payment ───────────────────────────────────────────────────
async function handlePaymentFailed(checkoutId) {
  const paymentsSnap = await db
    .collection("payments")
    .where("paymongoCheckoutId", "==", checkoutId)
    .limit(1)
    .get();

  if (paymentsSnap.empty) return;

  const paymentDoc = paymentsSnap.docs[0];
  await paymentDoc.ref.update({
    status: "failed",
    failedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Payment ${paymentDoc.id} marked as failed.`);
}