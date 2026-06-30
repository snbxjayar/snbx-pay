// lib/firebaseAdmin.js
// Place at: snbxsf-pay/lib/firebaseAdmin.js

const admin = require("firebase-admin");

// Service account credentials come from Vercel environment variables.
// We never commit the actual JSON key file to git.
//
// In Vercel, set these env vars (copy values from your downloaded service account JSON):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (paste the full key, including \n line breaks)

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel env vars store \n as literal characters — convert back to real newlines
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
        : undefined,
    }),
  });
}

const db = admin.firestore();

module.exports = { admin, db };