// api/payment-success.js
const { db } = require("../lib/firebaseAdmin");

module.exports = async (req, res) => {
  const { txn } = req.query;

  if (txn) {
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

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Payment Successful</title>
<style>
body{font-family:sans-serif;background:#0D1B2A;color:#F0F5F2;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;}
.card{background:#0F2030;border-radius:18px;padding:40px;max-width:400px;}
.icon{font-size:60px;margin-bottom:20px;}
h2{color:#1D9E75;margin-bottom:10px;}
p{color:#7A9E8E;margin-bottom:20px;}
.btn{background:#1D9E75;color:#fff;border:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;}
</style></head>
<body><div class="card">
<div class="icon">✅</div>
<h2>Payment Successful!</h2>
<p>Your payment has been processed. You can close this window.</p>
<button class="btn" onclick="window.close()">Close Window</button>
</div></body></html>`;

  res.setHeader("Content-Type", "text/html");
  res.status(200).send(html);
};