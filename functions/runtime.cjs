const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

if (!getApps().length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccount) {
    const credentials = JSON.parse(serviceAccount);
    if (credentials.project_id !== "home-market-368b4") throw new Error("Firebase service account belongs to another project.");
    initializeApp({ credential: cert(credentials) });
  } else {
    initializeApp();
  }
}

module.exports = { getAuth };
