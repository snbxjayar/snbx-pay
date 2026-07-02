// api/checkout.js
// Serves the checkout HTML page
const fs   = require("fs");
const path = require("path");

module.exports = (req, res) => {
  const html = fs.readFileSync(
    path.join(process.cwd(), "public", "checkout.html"), "utf8"
  );
  res.setHeader("Content-Type", "text/html");
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  res.status(200).send(html);
};