// api/sms/_lib.js — Shared helpers for SNBX SMS (Phase 12)
// Reuses the existing Firebase Admin init from lib/firebaseAdmin.js
const { db } = require("../../lib/firebaseAdmin");
const admin = require("firebase-admin");

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const GHL_API_BASE = "https://services.leadconnectorhq.com";
const TOKENS_COLLECTION = "sms_ghl_tokens";

// ── Location tokens ──────────────────────────────────────────────
async function saveTokens(locationId, tokens) {
  await db.collection(TOKENS_COLLECTION).doc(locationId).set(
    {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at: Date.now() + ((tokens.expires_in || 86400) - 300) * 1000,
      companyId: tokens.companyId || null,
      userType: tokens.userType || "Location",
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

// ── Company tokens (agency-level installs) ───────────────────────
function companyDocId(companyId) {
  return `company_${companyId}`;
}

async function saveCompanyTokens(companyId, tokens) {
  await db.collection(TOKENS_COLLECTION).doc(companyDocId(companyId)).set(
    {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + ((tokens.expires_in || 86400) - 300) * 1000,
      userType: "Company",
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

async function getCompanyAccessToken(companyId) {
  const doc = await db.collection(TOKENS_COLLECTION).doc(companyDocId(companyId)).get();
  if (!doc.exists) throw new Error(`No company tokens for ${companyId}`);
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
    console.error("[SMS] Company token refresh failed:", tokens);
    throw new Error("Company token refresh failed");
  }
  await saveCompanyTokens(companyId, tokens);
  return tokens.access_token;
}

// Mint a location-scoped token from a company token
async function mintLocationToken(companyId, locationId) {
  const companyToken = await getCompanyAccessToken(companyId);
  const res = await fetch(`${GHL_API_BASE}/oauth/locationToken`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${companyToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Version: "2021-07-28",
      Accept: "application/json",
    },
    body: new URLSearchParams({ companyId, locationId }),
  });
  const tokens = await res.json();
  if (!res.ok) {
    console.error(`[SMS] locationToken mint failed for ${locationId}:`, tokens);
    throw new Error("Location token mint failed");
  }
  await saveTokens(locationId, { ...tokens, companyId, userType: "Location" });
  console.log(`[SMS] Minted location token for ${locationId}`);
  return tokens.access_token;
}

// List locations where the app is installed (company-level installs)
async function getInstalledLocations(companyId) {
  const companyToken = await getCompanyAccessToken(companyId);
  const appId = String(process.env.GHL_SMS_CLIENT_ID || "").split("-")[0];
  const res = await fetch(
    `${GHL_API_BASE}/oauth/installedLocations?companyId=${companyId}&appId=${appId}&isInstalled=true&limit=100`,
    {
      headers: {
        Authorization: `Bearer ${companyToken}`,
        Version: "2021-07-28",
        Accept: "application/json",
      },
    }
  );
  const data = await res.json();
  if (!res.ok) {
    console.error("[SMS] installedLocations failed:", data);
    throw new Error("installedLocations failed");
  }
  return data.locations || [];
}

// ── Get a valid location access token (refresh or re-mint) ───────
async function getAccessToken(locationId) {
  const doc = await db.collection(TOKENS_COLLECTION).doc(locationId).get();
  if (!doc.exists) throw new Error(`No tokens for location ${locationId}`);
  const data = doc.data();

  if (Date.now() < data.expires_at) return data.access_token;

  // Try standard refresh if we have a refresh token
  if (data.refresh_token) {
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
    if (res.ok) {
      await saveTokens(locationId, { ...tokens, companyId: data.companyId });
      return tokens.access_token;
    }
    console.error("[SMS] Location refresh failed, will try re-mint:", tokens);
  }

  // No refresh token (minted location token) → re-mint from company token
  if (data.companyId) {
    return mintLocationToken(data.companyId, locationId);
  }

  throw new Error(`Cannot renew token for location ${locationId}`);
}

// ── Update message status in GHL ─────────────────────────────────
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

module.exports = {
  db, admin, saveTokens, saveCompanyTokens, getAccessToken,
  mintLocationToken, getInstalledLocations, updateGHLMessageStatus,
  GHL_API_BASE, GHL_TOKEN_URL,
};