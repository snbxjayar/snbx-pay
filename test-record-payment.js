// test-ghl-webhook.js
require("dotenv").config();
const axios = require("axios");

async function main() {
  const payload = {
    event: "payment.captured",
    chargeId: "cs_test_manual_confirm_001", // your PayMongo checkout/charge id
    ghlTransactionId: "6a470a7222eb9510d9101632",
    chargeSnapshot: {
      status: "succeeded",
      amount: 100,            // if this fails or records ₱1.00, try 10000 (minor units)
      chargeId: "cs_test_manual_confirm_001",
      chargedAt: Math.floor(Date.now() / 1000),
    },
    locationId: "fBmHS43QUr0H51dHbiqr",
    apiKey: process.env.PAYMONGO_SECRET_KEY || "PASTE_YOUR_TEST_SECRET_KEY_HERE",
  };

  try {
    const res = await axios.post(
      "https://backend.leadconnectorhq.com/payments/custom-provider/webhook",
      payload,
      { headers: { "Content-Type": "application/json" } }
    );
    console.log("Status:", res.status);
    console.log("Response:", JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.log("ERR", e?.response?.status, JSON.stringify(e?.response?.data, null, 2));
  }
}
main();