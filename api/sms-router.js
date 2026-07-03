// api/sms/[[...route]].js — SNBX SMS: all routes in one function (Hobby plan friendly)
const { db, admin, saveTokens } = require("./sms/_lib");

// Normalize PH numbers to +639XXXXXXXXX
function formatPHNumber(phone) {
  let p = String(phone || "").replace(/[\s\-()]/g, "");
  if (p.startsWith("09")) p = "+63" + p.slice(1);
  else if (p.startsWith("639")) p = "+" + p;
  else if (p.startsWith("9") && p.length === 10) p = "+63" + p;
  return p;
}

// ── Route: /api/sms/oauth/callback ──────────────────────────────
async function handleOAuthCallback(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing authorization code");

  try {
    const tokenRes = await fetch("https://services.leadconnectorhq.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GHL_SMS_CLIENT_ID,
        client_secret: process.env.GHL_SMS_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("[SMS OAuth] Exchange failed:", tokens);
      return res.status(500).send("OAuth token exchange failed");
    }

    const locationId = tokens.locationId;
    if (!locationId) {
      console.error("[SMS OAuth] No locationId in token response:", tokens);
      return res.status(500).send("No locationId returned");
    }

    await saveTokens(locationId, tokens);
    console.log(`[SMS OAuth] Installed for location ${locationId}`);

    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(`
      <html><body style="font-family:Arial;text-align:center;padding:60px">
        <h2 style="color:#1a5c3f">✅ SNBX SMS Installed!</h2>
        <p>Your sub-account is now connected. You can close this window.</p>
      </body></html>
    `);
  } catch (err) {
    console.error("[SMS OAuth] Error:", err);
    return res.status(500).send("Installation failed");
  }
}

// ── Route: /api/sms/outbound ────────────────────────────────────
async function handleOutbound(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { locationId, messageId, phone, message, contactId, attachments } = req.body || {};
    console.log("[SMS Outbound] Payload:", JSON.stringify(req.body));

    if (!locationId || !phone || !message) {
      return res.status(400).json({ error: "Missing locationId, phone, or message" });
    }

    await db.collection("sms_jobs").add({
      locationId,
      ghlMessageId: messageId || null,
      contactId: contactId || null,
      to: formatPHNumber(phone),
      body: message, // matches GatewayService.kt: data["body"]
      attachments: attachments || [],
      status: "queued",
      source: "ghl",
      createdAt: new Date(),
    });

    console.log(`[SMS Outbound] Queued job for ${phone} (location ${locationId})`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[SMS Outbound] Error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

// ── Router ──────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const route = String(req.query.route || "");

  if (route === "oauth/callback") return handleOAuthCallback(req, res);
  if (route === "outbound") return handleOutbound(req, res);

  return res.status(404).json({ error: `Unknown SMS route: /${route}` });
};