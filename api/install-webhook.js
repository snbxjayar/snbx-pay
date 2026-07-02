// api/install-webhook.js
// Handles GHL app install/uninstall webhook events

const { db, admin } = require("../lib/firebaseAdmin");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  try {
    // Log full body to see exact structure
    console.log("GHL webhook body:", JSON.stringify(req.body, null, 2));

    const body = req.body;
    const type = body.type ?? body.event ?? "";

    // GHL sends locationId in different fields
    const locationId = body.locationId 
      ?? body.location?.id 
      ?? body.activeLocation 
      ?? null;

    const companyId = body.companyId 
      ?? body.company?.id 
      ?? null;

    console.log(`GHL webhook: type=${type}, locationId=${locationId}, companyId=${companyId}`);

    // Use locationId or companyId as document ID
    const docId = locationId ?? companyId;

    if (!docId) {
      console.warn("No locationId or companyId in webhook body");
      return res.status(200).json({ received: true }); // Return 200 so GHL doesn't retry
    }

    if (type === "INSTALL" || type === "app.install") {
      await db.collection("ghl_installations").doc(docId).set({
        locationId:  locationId ?? null,
        companyId:   companyId ?? null,
        status:      "installed",
        installedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      console.log(`Installation recorded for: ${docId}`);
    }

    if (type === "UNINSTALL" || type === "app.uninstall") {
      await db.collection("ghl_installations").doc(docId).set({
        status:        "uninstalled",
        uninstalledAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Clear PayMongo credentials
      if (locationId) {
        await db.collection("paymongo_credentials").doc(locationId).delete();
      }
      console.log(`Uninstallation recorded for: ${docId}`);
    }

    return res.status(200).json({ received: true });

  } catch (e) {
    console.error("Install webhook error:", e.message);
    return res.status(200).json({ received: true }); // Always return 200 to GHL
  }
};