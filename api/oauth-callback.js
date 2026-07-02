// api/oauth-callback.js
// GHL OAuth callback — exchanges code for access token, stores per location

const axios = require("axios");
const { db, admin } = require("../lib/firebaseAdmin");

const GHL_CLIENT_ID     = process.env.GHL_CLIENT_ID;
const GHL_CLIENT_SECRET = process.env.GHL_CLIENT_SECRET;
const GHL_TOKEN_URL     = "https://services.leadconnectorhq.com/oauth/token";

module.exports = async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing OAuth code.");

  try {
    // Exchange code for access token
    const tokenRes = await axios.post(GHL_TOKEN_URL,
      new URLSearchParams({
        client_id:     GHL_CLIENT_ID,
        client_secret: GHL_CLIENT_SECRET,
        grant_type:    "authorization_code",
        code,
        redirect_uri:  "https://snbx-pay.vercel.app/api/oauth-callback",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const data = tokenRes.data;
    console.log("GHL token response keys:", Object.keys(data));

    const access_token  = data.access_token;
    const refresh_token = data.refresh_token;
    const expires_in    = data.expires_in;
    const locationId    = data.locationId ?? data.location_id ?? null;
    const companyId     = data.companyId ?? data.company_id ?? null;
    const isCompanyInstall = data.userType === "Company";

    if (!locationId && !companyId) {
      return res.status(400).send("Could not determine location from OAuth response.");
    }

    const docId = locationId ?? companyId;

    // Store tokens in Firestore
    await db.collection("ghl_installations").doc(docId).set({
      locationId:      locationId ?? null,
      companyId:       companyId ?? null,
      isCompanyInstall,
      accessToken:     access_token,
      refreshToken:    refresh_token,
      expiresAt:       Date.now() + (expires_in * 1000),
      installedAt:     admin.firestore.FieldValue.serverTimestamp(),
      status:          "active",
    }, { merge: true });

    // Redirect to setup iframe
    const installType = isCompanyInstall ? "company" : "location";
    return res.redirect(
  `https://snbx-pay.vercel.app/api/setup?locationId=${docId}&type=${installType}`
);

  } catch (error) {
    console.error("OAuth callback error:", error?.response?.data || error.message);
    return res.status(500).send("OAuth flow failed. Please try again.");
  }
};