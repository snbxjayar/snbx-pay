// test-list-orders.js
// Standalone diagnostic script — run locally with: node test-list-orders.js
// Place this in the root of your snbx-pay project (same level as /api, /lib)
// so it can reuse your existing Firebase Admin setup.
//
// Purpose: call GHL's List Orders API directly and log the raw response,
// so we can see (a) whether any order exists at all for this location given
// payment_initiate_props never fired, and (b) the exact shape of order
// objects so we know what to match on for Record Order Payment.
require("dotenv").config();
const axios = require("axios");
const { db } = require("./lib/firebaseAdmin");

const GHL_BASE          = "https://services.leadconnectorhq.com";
const GHL_CLIENT_ID     = process.env.GHL_CLIENT_ID;
const GHL_CLIENT_SECRET = process.env.GHL_CLIENT_SECRET;

// CHANGE THIS if testing a different location
const LOCATION_ID = "fBmHS43QUr0H51dHbiqr";

async function refreshLocationToken(locationId) {
  const snap = await db.collection("ghl_installations").doc(locationId).get();
  const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists;
  if (!exists) throw new Error("No installation found for this locationId");

  const { refreshToken } = snap.data();

  const res = await axios.post(
    `${GHL_BASE}/oauth/token`,
    new URLSearchParams({
      client_id:     GHL_CLIENT_ID,
      client_secret: GHL_CLIENT_SECRET,
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
      user_type:     "Location",
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept:         "application/json",
      },
    }
  );

  await db.collection("ghl_installations").doc(locationId).update({
    accessToken:  res.data.access_token,
    refreshToken: res.data.refresh_token,
    expiresAt:    Date.now() + (res.data.expires_in * 1000),
  });

  return res.data.access_token;
}

async function main() {
  console.log(`\n=== Testing List Orders for location: ${LOCATION_ID} ===\n`);

  try {
    const token = await refreshLocationToken(LOCATION_ID);
    console.log("Got fresh access token.\n");

    const res = await axios.get(`${GHL_BASE}/payments/orders`, {
      params: {
        altId:   LOCATION_ID,
        altType: "location",
      },
      headers: {
        Authorization: `Bearer ${token}`,
        Version:       "2021-07-28",
      },
    });

    console.log("=== RAW RESPONSE ===");
    console.log(JSON.stringify(res.data, null, 2));

    const orders = res.data?.data ?? res.data?.orders ?? [];
    console.log(`\n=== Found ${orders.length} order(s) ===`);
    orders.forEach((o, i) => {
      console.log(`\nOrder ${i + 1}:`);
      console.log("  _id:      ", o._id);
      console.log("  status:   ", o.status);
      console.log("  amount:   ", o.amount ?? o.total);
      console.log("  contactId:", o.contactId ?? o.contactDetails?.id);
      console.log("  createdAt:", o.createdAt);
    });

  } catch (e) {
    console.error("\n=== ERROR ===");
    console.error("Status:", e?.response?.status);
    console.error("Data:  ", JSON.stringify(e?.response?.data, null, 2));
    console.error("Message:", e.message);
  }
}

main();