// api/ghl.js
// Place at: snbxsf-pay/api/ghl.js
// Vercel proxy for GHL API v2 — keeps API keys server-side

const axios = require("axios");

const GHL_BASE = "https://services.leadconnectorhq.com";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, locationId, apiKey, ...payload } = req.body;

  if (!action || !locationId || !apiKey) {
    return res.status(400).json({ error: "Missing required fields: action, locationId, apiKey" });
  }

  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type":  "application/json",
    "Version":       "2021-07-28",
  };

  try {
    let result;

    switch (action) {

      // ── Get contacts list ──────────────────────────────────────────────────
      case "getContacts": {
  const params = {
    locationId,
    limit: 20,
    startAfter: ((payload.page ?? 1) - 1) * 20,
  };
  if (payload.search) params.query = payload.search;
  const r = await axios.get(`${GHL_BASE}/contacts/`, { headers, params });
  console.log("Sample contact:", JSON.stringify(r.data.contacts?.[0], null, 2)); // ← ADD HERE
  result = {
    contacts: r.data.contacts ?? [],
    total:    r.data.total ?? 0,
  };
  break;
}

      // ── Get single contact ─────────────────────────────────────────────────
      case "getContact": {
        const r = await axios.get(`${GHL_BASE}/contacts/${payload.contactId}`, { headers });
        result = r.data.contact ?? r.data;
        break;
      }

      // ── Create contact ─────────────────────────────────────────────────────
      case "createContact": {
        const body = { ...payload.contact, locationId };
        const r = await axios.post(`${GHL_BASE}/contacts/`, body, { headers });
        result = r.data.contact ?? r.data;
        break;
      }

      // ── Update contact ─────────────────────────────────────────────────────
      case "updateContact": {
        const r = await axios.put(
          `${GHL_BASE}/contacts/${payload.contactId}`,
          payload.contact,
          { headers }
        );
        result = r.data.contact ?? r.data;
        break;
      }

      // ── Add tags ───────────────────────────────────────────────────────────
      case "addTags": {
        const r = await axios.post(
          `${GHL_BASE}/contacts/${payload.contactId}/tags`,
          { tags: payload.tags },
          { headers }
        );
        result = r.data;
        break;
      }

      // ── Remove tags ────────────────────────────────────────────────────────
      case "removeTags": {
        const r = await axios.delete(
          `${GHL_BASE}/contacts/${payload.contactId}/tags`,
          { headers, data: { tags: payload.tags } }
        );
        result = r.data;
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("GHL proxy error:", error?.response?.data || error.message);
    return res.status(error?.response?.status ?? 500).json({
      error: error?.response?.data?.message ?? error.message ?? "GHL API error",
    });
  }
};