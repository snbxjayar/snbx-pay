// test-provider-config.js
require("dotenv").config();
const axios = require("axios");
const { db } = require("./lib/firebaseAdmin");

const GHL_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = "fBmHS43QUr0H51dHbiqr";

async function getOAuthToken() {
  const snap = await db.collection("ghl_installations").doc(LOCATION_ID).get();
  const { refreshToken } = snap.data();
  const res = await axios.post(`${GHL_BASE}/oauth/token`, new URLSearchParams({
    client_id: process.env.GHL_CLIENT_ID,
    client_secret: process.env.GHL_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    user_type: "Location",
  }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  await db.collection("ghl_installations").doc(LOCATION_ID).update({
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
  });
  return res.data.access_token;
}

async function main() {
  const token = await getOAuthToken();

  // 1. Fetch provider config (the /connect path)
  try {
    const res = await axios.get(`${GHL_BASE}/payments/custom-provider/connect`, {
      params: { locationId: LOCATION_ID },
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
    });
    console.log("CONFIG:", JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.log("CONFIG ERR", e?.response?.status, JSON.stringify(e?.response?.data));
  }
}
main();