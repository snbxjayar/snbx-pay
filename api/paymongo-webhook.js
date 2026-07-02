// api/paymongo-webhook.js
// PayMongo webhook — updates GHL transaction status when payment completes

const crypto = require("crypto");
const { db } = require("../lib/firebaseAdmin");

module.exports.config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const rawBody = await getRawBody(req);
    const event   = JSON.parse(rawBody);
    const eventType = event.data?.attributes?.type;
    const eventData  = event.data?.attributes?.data;

    console.log("PayMongo webhook:", eventType);

    if (eventType === "checkout_session.payment.paid") {
      const checkoutId = eventData?.id;
      const metadata   = eventData?.attributes?.metadata ?? {};
      const { locationId, contactId, transactionId } = metadata;

      if (transactionId) {
        // Update our transaction record
        await db.collection("ghl_transactions").doc(transactionId).update({
          status:   "paid",
          paidAt:   new Date(),
          checkoutId,
        });

        console.log(`Transaction ${transactionId} marked as paid`);
      }
    }

    return res.status(200).json({ received: true });

  } catch (e) {
    console.error("PayMongo webhook error:", e.message);
    return res.status(500).json({ error: e.message });
  }
};