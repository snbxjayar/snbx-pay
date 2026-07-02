// api/payment-cancel.js
module.exports = (req, res) => {
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Payment Cancelled</title>
<style>
body{font-family:sans-serif;background:#0D1B2A;color:#F0F5F2;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;}
.card{background:#0F2030;border-radius:18px;padding:40px;max-width:400px;}
.icon{font-size:60px;margin-bottom:20px;}
h2{color:#E05A5A;margin-bottom:10px;}
p{color:#7A9E8E;margin-bottom:20px;}
.btn{background:#1A3A2A;color:#7A9E8E;border:none;padding:12px 24px;border-radius:10px;font-size:14px;cursor:pointer;}
</style></head>
<body><div class="card">
<div class="icon">❌</div>
<h2>Payment Cancelled</h2>
<p>Your payment was cancelled. You can close this window and try again.</p>
<button class="btn" onclick="window.close()">Close Window</button>
</div></body></html>`;

  res.setHeader("Content-Type", "text/html");
  res.status(200).send(html);
};