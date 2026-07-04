// api/sms-router.js — SNBX SMS: all routes in one function (Hobby plan friendly)
// Routes (via vercel.json rewrite):
//   /api/sms/oauth/callback → OAuth install
//   /api/sms/outbound       → GHL Conversation Provider webhook
const { db, admin, saveTokens, updateGHLMessageStatus } = require("./sms/_lib");

// Normalize PH numbers to +639XXXXXXXXX
function formatPHNumber(phone) {
  let p = String(phone || "").replace(/[\s\-()]/g, "");
  if (p.startsWith("09")) p = "+63" + p.slice(1);
  else if (p.startsWith("639")) p = "+" + p;
  else if (p.startsWith("9") && p.length === 10) p = "+63" + p;
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll a job doc until it reaches sent/failed, or timeout
async function waitForJobResult(jobId, timeoutMs = 8000, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const doc = await db.collection("sms_jobs").doc(jobId).get();
    const status = doc.exists ? doc.data().status : null;
    if (status === "sent") return { status: "sent" };
    if (status === "failed") return { status: "failed", error: doc.data().error || "Send failed on device" };
    await sleep(intervalMs);
  }
  return { status: "timeout" };
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

    const jobRef = await db.collection("sms_jobs").add({
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

    console.log(`[SMS Outbound] Queued job ${jobRef.id} for ${phone} (location ${locationId})`);

// ── FCM wake-up: nudge the gateway device (works even if app is killed) ──
    try {
      await admin.messaging().send({
        topic: "sms_gateway",
        android: { priority: "high" },
        data: { type: "sms_job", jobId: jobRef.id },
      });
      console.log(`[SMS Outbound] FCM wake-up sent for job ${jobRef.id}`);
    } catch (fcmErr) {
      console.error("[SMS Outbound] FCM send failed (job still queued):", fcmErr.message);
    }

    // ── Status feedback loop (Option A: poll for result) ──
    if (messageId) {
      const result = await waitForJobResult(jobRef.id);
      console.log(`[SMS Outbound] Job ${jobRef.id} result: ${result.status}`);

      if (result.status === "sent") {
        await updateGHLMessageStatus(locationId, messageId, "delivered");
      } else if (result.status === "failed") {
        await updateGHLMessageStatus(locationId, messageId, "failed", result.error);
      }
      // On timeout: leave GHL as pending — the gateway may still send it late.
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[SMS Outbound] Error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

// ── Route: /api/sms/inbound ─────────────────────────────────────
// Called by the gateway app when a subscriber's phone receives an SMS
async function handleInbound(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { deviceId, from, body } = req.body || {};
    console.log("[SMS Inbound] Payload:", JSON.stringify(req.body));

    if (!deviceId || !from || !body) {
      return res.status(400).json({ error: "Missing deviceId, from, or body" });
    }

    // Resolve device → location
    const deviceDoc = await db.collection("sms_devices").doc(deviceId).get();
    if (!deviceDoc.exists) {
      console.error(`[SMS Inbound] Unknown device: ${deviceId}`);
      return res.status(404).json({ error: "Device not registered" });
    }
    const locationId = deviceDoc.data().locationId;

    const { getAccessToken, GHL_API_BASE } = require("./sms/_lib");
    const token = await getAccessToken(locationId);
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Version: "2021-04-15",
    };

    // 1. Find the contact by phone number (or create one)
    const searchRes = await fetch(
      `${GHL_API_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(from)}`,
      { headers }
    );
    const searchData = await searchRes.json();
    let contactId = searchData.contacts?.[0]?.id;

    if (!contactId) {
      const createRes = await fetch(`${GHL_API_BASE}/contacts/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ locationId, phone: from, source: "SNBX SMS Inbound" }),
      });
      const created = await createRes.json();
      contactId = created.contact?.id;
      console.log(`[SMS Inbound] Created contact ${contactId} for ${from}`);
    }

    if (!contactId) {
      console.error("[SMS Inbound] Could not find/create contact:", searchData);
      return res.status(500).json({ error: "Contact resolution failed" });
    }

    // 2. Post the inbound message into Conversations
    const msgRes = await fetch(`${GHL_API_BASE}/conversations/messages/inbound`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "SMS",
        contactId,
        message: body,
        conversationProviderId: process.env.GHL_SMS_PROVIDER_ID,
      }),
    });
    const msgData = await msgRes.json();

    if (!msgRes.ok) {
      console.error("[SMS Inbound] GHL message post failed:", msgData);
      return res.status(500).json({ error: "GHL post failed" });
    }

    console.log(`[SMS Inbound] Posted message from ${from} to contact ${contactId}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[SMS Inbound] Error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

// ── Router ──────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const route = String(req.query.route || "");

  if (route === "oauth/callback") return handleOAuthCallback(req, res);
  if (route === "outbound") return handleOutbound(req, res);
  if (route === "inbound") return handleInbound(req, res);

  return res.status(404).json({ error: `Unknown SMS route: /${route}` });
};