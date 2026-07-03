// api/payment-result.js — handles both payment success and cancel (merged for Hobby limit)
const { db } = require("../lib/firebaseAdmin");

module.exports = async (req, res) => {
  const { txn, outcome } = req.query;
  const isSuccess = outcome === "success";

  if (isSuccess && txn) {
    try {
      await db.collection("ghl_transactions").doc(txn).update({
        status: "paid",
        paidAt: new Date(),
      });
      console.log(`Transaction ${txn} marked as paid`);
    } catch (e) {
      console.error("Update transaction error:", e.message);
    }
  }

  const icon = isSuccess ? "✅" : "❌";
  const title = isSuccess ? "Payment Successful" : "Payment Cancelled";
  const heading = isSuccess ? "Payment Successful!" : "Payment Cancelled";
  const color = isSuccess ? "#1D9E75" : "#E05A5A";
  const status = isSuccess ? "paid" : "cancelled";
  const delay = isSuccess ? 1200 : 1500;
  const cancelBtn = isSuccess
    ? ""
    : `<button class="btn" onclick="window.close()">Close Window</button>`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>${title}</title>
<style>
body{font-family:sans-serif;background:#0D1B2A;color:#F0F5F2;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;}
.card{background:#0F2030;border-radius:18px;padding:40px;max-width:400px;}
.icon{font-size:60px;margin-bottom:20px;}
h2{color:${color};margin-bottom:10px;}
p{color:#7A9E8E;margin-bottom:20px;}
.btn{background:#1A3A2A;color:#7A9E8E;border:none;padding:12px 24px;border-radius:10px;font-size:14px;cursor:pointer;}
</style></head>
<body><div class="card">
<div class="icon">${icon}</div>
<h2>${heading}</h2>
<p>Closing automatically...</p>
${cancelBtn}
</div>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "SNBX_PAYMENT_DONE", status: "${status}", chargeId: "${txn || ""}" }, "*");
  }
  setTimeout(() => window.close(), ${delay});
</script>
</body></html>`;

  res.setHeader("Content-Type", "text/html");
  res.status(200).send(html);
};