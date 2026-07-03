// api/checkout/[locationId].js
const fs   = require("fs");
const path = require("path");

module.exports = (req, res) => {
  const { locationId } = req.query;

  let html = fs.readFileSync(
    path.join(process.cwd(), "public", "checkout.html"), "utf8"
  );

  const injection = `<script>window.__SNBX_LOCATION_ID__ = ${JSON.stringify(locationId || "")};</script>`;
  html = html.replace("<script>", `${injection}\n  <script>`);

  res.setHeader("Content-Type", "text/html");
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  res.status(200).send(html);
};