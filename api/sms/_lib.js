// api/sms/_lib.js — Shared helpers for SNBX SMS (Phase 12)
// Reuses the existing Firebase Admin init from lib/firebaseAdmin.js
const { db } = require("../../lib/firebaseAdmin");
const admin = require("firebase-admin");

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const GHL_API_BASE = "https://services.leadconnectorhq.com";
const TOKENS_COLLECTION = "sms_ghl_tokens";

// Save tokens for a location
async function saveTokens(locationId, tokens) {
  await db.collection(TOKENS_COLLECTION).doc(locationId).set(
    {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in - 300) * 1000, // refresh 5 min early
      companyId: tokens.companyId || null,
      userType: tokens.userType || null,
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

// Get a valid access token, auto-refreshing if expired
async function getAccessToken(locationId) {
  const doc = await db.collection(TOKENS_COLLECTION).doc(locationId).get();
  if (!doc.exists) throw new Error(`No tokens for location ${locationId}`);
  const data = doc.data();

  if (Date.now() < data.expires_at) return data.access_token;

  const res = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GHL_SMS_CLIENT_ID,
      client_secret: process.env.GHL_SMS_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
    }),
  });
  const tokens = await res.json();
  if (!res.ok) {
    console.error("[SMS] Token refresh failed:", tokens);
    throw new Error("Token refresh failed");
  }
  await saveTokens(locationId, tokens);
  return tokens.access_token;
}

// Update message status in GHL (delivered / failed)
async function updateGHLMessageStatus(locationId, messageId, status, errorMsg) {
  const token = await getAccessToken(locationId);
  const body = { status };
  if (errorMsg) body.error = { code: "1", type: "sms", message: errorMsg };

  const res = await fetch(
    `${GHL_API_BASE}/conversations/messages/${messageId}/status`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Version: "2021-04-15",
      },
      body: JSON.stringify(body),
    }
  );
  const out = await res.json().catch(() => ({}));
  console.log(`[SMS] GHL status ${status} for ${messageId}:`, res.status, out);
  return res.ok;
}

module.exports = { db, admin, saveTokens, getAccessToken, updateGHLMessageStatus, GHL_API_BASE, GHL_TOKEN_URL };