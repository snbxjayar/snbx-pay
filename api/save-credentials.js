// api/save-credentials.js
const axios = require("axios");
const { db } = require("../lib/firebaseAdmin");

const GHL_BASE          = "https://services.leadconnectorhq.com";
const GHL_CLIENT_ID     = process.env.GHL_CLIENT_ID;
const GHL_CLIENT_SECRET = process.env.GHL_CLIENT_SECRET;

// Get a fresh location token using the stored refresh token
async function refreshLocationToken(locationId) {
  try {
    const snap = await db.collection("ghl_installations").doc(locationId).get();
    const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists;
    if (!exists) throw new Error("No installation found");

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

    const newToken        = res.data.access_token;
    const newRefreshToken = res.data.refresh_token;

    // Update stored tokens
    await db.collection("ghl_installations").doc(locationId).update({
      accessToken:  newToken,
      refreshToken: newRefreshToken,
      expiresAt:    Date.now() + (res.data.expires_in * 1000),
    });

    console.log("Token refreshed for location:", locationId);
    return newToken;

  } catch (e) {
    console.error("Token refresh error:", e?.response?.data || e.message);
    throw e;
  }
}

// Step 1 — Create base integration (registers SNBX Pay as a provider)
async function createBaseConfig(locationId, token) {
  try {
    const response = await axios.post(
  `${GHL_BASE}/payments/custom-provider/provider?locationId=${locationId}`,
  {
    name:        "SNBX Pay",
    description: "Accept GCash, Maya & Card payments via PayMongo",
    imageUrl:    "https://snbxpro.com/assets/snbx-pay-logo.png",
    queryUrl:    "https://snbx-pay.vercel.app/api/query",
    paymentsUrl: `https://snbx-pay.vercel.app/api/checkout/${locationId}`,
  },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Version:        "2021-07-28",
        },
      }
    );
    console.log("Base config created:", JSON.stringify(response.data));
    return response.data;
  } catch (e) {
    // Ignore if already exists — just log and continue
    console.log("Base config note:", e?.response?.data?.message || e.message);
  }
}

// Step 2 — Connect test/live credentials
async function connectConfig(locationId, mode, apiKey, publishableKey, token) {
  try {
    const body = {};
    if (mode === "test") {
      body.test = {
        apiKey:         String(apiKey),
        publishableKey: publishableKey ? String(publishableKey) : "",
      };
    } else {
      body.live = {
        apiKey:         String(apiKey),
        publishableKey: publishableKey ? String(publishableKey) : "",
      };
    }

    console.log(`Calling connect config: locationId=${locationId}, mode=${mode}`);

    const response = await axios.post(
      `${GHL_BASE}/payments/custom-provider/connect?locationId=${locationId}`,
      body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Version:        "2021-07-28",
        },
      }
    );

    console.log(`Connect config (${mode}) success:`, JSON.stringify(response.data));
    return response.data;

  } catch (e) {
    console.error(`Connect config (${mode}) error:`, e?.response?.data || e.message);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET — load existing credentials (public keys only)
  if (req.method === "GET") {
    const { locationId } = req.query;
    if (!locationId) return res.status(400).json({ error: "Missing locationId" });

    try {
      const snap = await db.collection("paymongo_credentials").doc(locationId).get();
      const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists;
      if (!exists) return res.status(404).json({ error: "Not found" });

      const d = snap.data();
      return res.status(200).json({
        testPublicKey: d.testPublicKey ?? "",
        livePublicKey: d.livePublicKey ?? "",
        liveMode:      d.liveMode ?? false,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — save credentials + register with GHL
  if (req.method === "POST") {
    const {
      locationId,
      testPublicKey, testSecretKey,
      livePublicKey, liveSecretKey,
      liveMode,
    } = req.body;

    if (!locationId) return res.status(400).json({ error: "Missing locationId" });
    if (!testSecretKey && !liveSecretKey) {
      return res.status(400).json({ error: "At least one secret key is required" });
    }

    try {
      // Save credentials to Firestore
      await db.collection("paymongo_credentials").doc(locationId).set({
        locationId,
        testPublicKey:  testPublicKey ?? "",
        testSecretKey:  testSecretKey ?? "",
        livePublicKey:  livePublicKey ?? "",
        liveSecretKey:  liveSecretKey ?? "",
        liveMode:       liveMode ?? false,
        updatedAt:      new Date(),
      }, { merge: true });

      // Get fresh token once — reuse for both calls
      const token = await refreshLocationToken(locationId);

      // Step 1 — Create base config (safe to call even if already exists)
      await createBaseConfig(locationId, token);

      // Step 2 — Connect test mode credentials
      if (testSecretKey) {
        await connectConfig(locationId, "test", testSecretKey, testPublicKey, token);
      }

      // Step 2 — Connect live mode credentials
      if (liveSecretKey) {
        await connectConfig(locationId, "live", liveSecretKey, livePublicKey, token);
      }

      return res.status(200).json({ success: true });

    } catch (e) {
      console.error("Save credentials error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};