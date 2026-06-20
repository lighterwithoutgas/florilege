/* ============================================================
   Keepsake Book — Cloud Functions (the security core)
   ------------------------------------------------------------
   • startCheckout (public/anon) → makes a PENDING book + a Stripe
                                   Checkout session. Returns the pay URL.
   • stripeWebhook (Stripe only) → on paid, flips the book to ACTIVE.
   • redeemKey     (public)      → checks a key on an ACTIVE book and
                                   mints a SCOPED token.
   • deletePage    (caretaker/owner) → removes a page + its files.

   A book is useless until Stripe confirms payment: redeemKey refuses
   any book whose status !== "active", so the create function cannot be
   abused to mint free books.
   ============================================================ */

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { scryptSync, randomBytes, timingSafeEqual } = require("crypto");

admin.initializeApp();
const db = admin.firestore();
// deploy marker: bind corrected STRIPE_SECRET (full key)

/* ---------- pricing ---------- */
const PRICE_CENTS = 500;      // €5.00 — change here
const CURRENCY = "eur";

/* ============================================================
   PAYMENTS — master switch.
   false → books are created for free (lets us deploy & demo the
           whole flow without Stripe configured).
   To turn on paid mode later:
     1) set PAYMENTS_ENABLED = true
     2) firebase functions:secrets:set STRIPE_SECRET
        firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
     3) firebase deploy --only functions
     4) add the printed stripeWebhook URL as a Stripe webhook
        (event: checkout.session.completed) and re-set the webhook secret
   Also flip the button label in create.html back to "Pay €5…".
   ============================================================ */
const PAYMENTS_ENABLED = true;

/* Secret owner code — lets YOU create books for free.
   Visit /create?owner=THE_CODE and the payment step is skipped.
   Stored in functions/.env (which is gitignored) — never committed, never sent to browsers. */
const OWNER_CODE = process.env.OWNER_CODE || "";

/* ---------- email the buyer their links after payment ----------
   Off until set up. To enable: create a Gmail App Password (Google account →
   Security → 2-Step Verification → App passwords), then:
     firebase functions:secrets:set GMAIL_USER           (your gmail address)
     firebase functions:secrets:set GMAIL_APP_PASSWORD   (the 16-char app password)
   set EMAIL_ENABLED = true, and redeploy. Uses Gmail SMTP — no domain needed. */
const EMAIL_ENABLED = true;
// only declared when enabled, so deploys don't demand them while email is off
const GMAIL_USER = EMAIL_ENABLED ? defineSecret("GMAIL_USER") : null;
const GMAIL_APP_PASSWORD = EMAIL_ENABLED ? defineSecret("GMAIL_APP_PASSWORD") : null;

/* ---------- secrets (only bound to functions when payments are on) ---------- */
const STRIPE_SECRET = defineSecret("STRIPE_SECRET");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

/* fallback site origin used if the client doesn't send a clean one */
const FALLBACK_ORIGIN = "https://graduation-abd07.web.app";

/* ---------- key hashing (no external deps) ---------- */
function hashKey(key) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(key), salt, 64).toString("hex");
  return { salt, hash };
}
function verifyKey(key, salt, hash) {
  if (!salt || !hash) return false;
  const got = scryptSync(String(key), salt, 64);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
function newId(n = 9) { // 9 bytes → 12-char id (shorter links, still unguessable)
  return randomBytes(n).toString("base64url");
}
function cleanOrigin(origin) {
  if (typeof origin === "string" && /^https?:\/\/[\w.-]+(:\d+)?$/.test(origin)) {
    return origin.replace(/\/+$/, "");
  }
  return FALLBACK_ORIGIN;
}

/* surface the real error message to the client instead of a bare "internal" */
function guard(fn) {
  return async (request) => {
    try { return await fn(request); }
    catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error(e);
      throw new HttpsError("internal", (e && e.message) ? e.message : String(e));
    }
  };
}

/* email the buyer their two links after payment.
   The key is the one they chose (never stored in plaintext), so we just remind them. */
async function sendLinksEmail(to, bookId) {
  const snap = await db.doc(`books/${bookId}`).get();
  const name = (snap.exists && snap.data().recipientName) || "your graduate";
  const base = FALLBACK_ORIGIN;
  const friends = `${base}/add?b=${bookId}`;
  const recipient = `${base}/book?b=${bookId}`;
  const nodemailer = require("nodemailer");
  const tx = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
  });
  const html = `
    <div style="font-family:Georgia,serif;color:#3A352C;max-width:560px;margin:0 auto;line-height:1.7">
      <h2 style="color:#B8466F;font-weight:600">${name}'s Florilège book is ready 🌸</h2>
      <p>Thank you! Here are your two links — please keep this email safe.</p>
      <p><b>Share with friends (to add their pages):</b><br><a href="${friends}">${friends}</a></p>
      <p><b>For ${name} (the recipient):</b><br><a href="${recipient}">${recipient}</a><br>
         Give them the <b>key you chose</b> when you made the book.</p>
      <p style="color:#6B6354;font-size:.9rem">Made with pressed flowers and good wishes — Florilège.</p>
    </div>`;
  await tx.sendMail({
    from: `Florilège <${GMAIL_USER.value()}>`,
    to, subject: `${name}'s Florilège book — your links`, html,
  });
}

/* validate + assemble the documents for a new (pending) book */
function buildBookDocs(uid, config, viewerKey, caretakerKey) {
  if (!config.recipientName || !String(config.recipientName).trim())
    throw new HttpsError("invalid-argument", "A recipient name is required.");
  if (!viewerKey || String(viewerKey).length < 4)
    throw new HttpsError("invalid-argument", "The recipient key must be at least 4 characters.");

  const now = admin.firestore.FieldValue.serverTimestamp();
  const recipientName = String(config.recipientName).slice(0, 80);

  const publicDoc = {
    ownerUid: uid,
    recipientName,
    nameScript: config.nameScript === "arabic" ? "arabic" : "latin",
    flower: String(config.flower || "carnation").slice(0, 24),
    flowerColor: String(config.flowerColor || "#D2588A").slice(0, 9),
    major: String(config.major || "").slice(0, 60),
    coverSymbol: ["flower", "emblem", "none"].includes(config.coverSymbol) ? config.coverSymbol : "flower",
    emblem: String(config.emblem || "cap").slice(0, 20),
    year: String(config.year || new Date().getFullYear()).slice(0, 8),
    intro: String(config.intro || "").slice(0, 600),
    hasThen: !!config.thenPhotoURL,
    hasNow: !!config.nowPhotoURL,
    hasManageKey: !!(caretakerKey && String(caretakerKey).length >= 4),
    lang: config.lang === "ar" ? "ar" : "en",
    status: "pending",          // becomes "active" once Stripe confirms payment
    priceCents: PRICE_CENTS,
    createdAt: now,
  };
  const privateContent = {
    dedication: String(config.dedication || "").slice(0, 1200),
    closing: String(config.closing || "").slice(0, 600),
    plateNote: String(config.plateNote || "").slice(0, 400),
    thenPhotoURL: config.thenPhotoURL || null,
    thenCaption: String(config.thenCaption || "").slice(0, 300),
    nowPhotoURL: config.nowPhotoURL || null,
    nowCaption: String(config.nowCaption || "").slice(0, 300),
  };
  const keys = { viewer: hashKey(viewerKey), attempts: 0 };
  if (caretakerKey && String(caretakerKey).length >= 4) keys.caretaker = hashKey(caretakerKey);

  return { publicDoc, privateContent, keys, recipientName };
}

/* ============================================================
   startCheckout — anyone (anonymous auth). Creates a PENDING book
   and a Stripe Checkout session. data: { config, viewerKey, caretakerKey, origin }
   returns: { url, bookId }
   ============================================================ */
exports.startCheckout = onCall(PAYMENTS_ENABLED ? { secrets: [STRIPE_SECRET] } : {}, guard(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Could not start. Please reload and try again.");

  const { config = {}, viewerKey, caretakerKey, origin, ownerCode } = request.data || {};
  const { publicDoc, privateContent, keys, recipientName } =
    buildBookDocs(uid, config, viewerKey, caretakerKey);

  const bookId = newId();
  const base = cleanOrigin(origin);

  // owner free-create: a valid owner code skips payment
  const ownerFree = typeof ownerCode === "string" && ownerCode.length > 0 && ownerCode === OWNER_CODE;

  // ----- FREE: payments globally off, OR the owner code was supplied -----
  if (!PAYMENTS_ENABLED || ownerFree) {
    publicDoc.status = "active";
    publicDoc.paidAt = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(db.doc(`books/${bookId}`), publicDoc);
    batch.set(db.doc(`books/${bookId}/private/content`), privateContent);
    batch.set(db.doc(`books/${bookId}/private/keys`), keys);
    await batch.commit();
    return { url: `${base}/success?b=${bookId}`, bookId, free: true };
  }

  // ----- PAID MODE: pending book + Stripe Checkout -----
  const batch = db.batch();
  batch.set(db.doc(`books/${bookId}`), publicDoc);
  batch.set(db.doc(`books/${bookId}/private/content`), privateContent);
  batch.set(db.doc(`books/${bookId}/private/keys`), keys);
  await batch.commit();

  const stripe = require("stripe")(STRIPE_SECRET.value());
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: CURRENCY,
        unit_amount: PRICE_CENTS,
        product_data: { name: `Florilège book for ${recipientName}` },
      },
    }],
    metadata: { bookId },
    success_url: `${base}/success?b=${bookId}`,
    cancel_url: `${base}/create`,
  });

  return { url: session.url, bookId };
}));

/* ============================================================
   stripeWebhook — called by Stripe only. Verifies the signature
   and, on a completed checkout, flips the book to "active".
   ============================================================ */
if (PAYMENTS_ENABLED) {
  exports.stripeWebhook = onRequest(
    { secrets: EMAIL_ENABLED
        ? [STRIPE_SECRET, STRIPE_WEBHOOK_SECRET, GMAIL_USER, GMAIL_APP_PASSWORD]
        : [STRIPE_SECRET, STRIPE_WEBHOOK_SECRET] },
    async (req, res) => {
      const stripe = require("stripe")(STRIPE_SECRET.value());
      let event;
      try {
        const sig = req.headers["stripe-signature"];
        event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET.value());
      } catch (e) {
        console.error("Webhook signature verification failed:", e.message);
        return res.status(400).send(`Webhook Error: ${e.message}`);
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const bookId = session.metadata && session.metadata.bookId;
        if (bookId) {
          try {
            await db.doc(`books/${bookId}`).set({
              status: "active",
              paidAt: admin.firestore.FieldValue.serverTimestamp(),
              stripeSessionId: session.id,
            }, { merge: true });
          } catch (e) {
            console.error("Failed to activate book", bookId, e);
            return res.status(500).send("activation failed");
          }
          if (EMAIL_ENABLED) {
            const email = session.customer_details && session.customer_details.email;
            if (email) {
              try { await sendLinksEmail(email, bookId); }
              catch (e) { console.error("Failed to email links for", bookId, e); }
            }
          }
        }
      }
      return res.json({ received: true });
    }
  );
}

/* ============================================================
   redeemKey — public. data: { bookId, role, key }
   Only works on an ACTIVE (paid) book.
   ============================================================ */
exports.redeemKey = onCall(guard(async (request) => {
  const { bookId, role, key } = request.data || {};
  if (!bookId || !role || !key)
    throw new HttpsError("invalid-argument", "Missing bookId, role, or key.");
  if (role !== "viewer" && role !== "caretaker")
    throw new HttpsError("invalid-argument", "Unknown role.");

  const bookSnap = await db.doc(`books/${bookId}`).get();
  if (!bookSnap.exists) throw new HttpsError("not-found", "No such book.");
  if (bookSnap.data().status !== "active")
    throw new HttpsError("failed-precondition", "This book isn't ready yet.");

  const keysRef = db.doc(`books/${bookId}/private/keys`);
  const snap = await keysRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "No such book.");
  const data = snap.data();

  // Brute-force throttle with a *temporary* cooldown (never a permanent lock,
  // so a stranger with the link can't grief the recipient out of their book).
  const now = admin.firestore.Timestamp.now();
  if (data.lockedUntil && data.lockedUntil.toMillis() > now.toMillis())
    throw new HttpsError("resource-exhausted", "Too many attempts. Please try again in a few minutes.");

  const entry = data[role];
  const ok = entry && verifyKey(key, entry.salt, entry.hash);
  if (!ok) {
    const attempts = (data.attempts || 0) + 1;
    const upd = { attempts };
    if (attempts >= 8) { // after 8 wrong tries, cool down for 10 minutes and reset the counter
      upd.lockedUntil = admin.firestore.Timestamp.fromMillis(now.toMillis() + 10 * 60 * 1000);
      upd.attempts = 0;
    }
    await keysRef.update(upd);
    throw new HttpsError("permission-denied", "That key didn't work.");
  }
  if (data.attempts || data.lockedUntil)
    await keysRef.update({ attempts: 0, lockedUntil: admin.firestore.FieldValue.delete() });

  const claimUid = `${role[0]}_${bookId}`;
  const token = await admin.auth().createCustomToken(claimUid, { bookId, role });
  return { token };
}));

/* ============================================================
   deletePage — owner (authed) or caretaker (claim) only
   data: { bookId, msgId }
   ============================================================ */
exports.deletePage = onCall(guard(async (request) => {
  const { bookId, msgId } = request.data || {};
  if (!bookId || !msgId) throw new HttpsError("invalid-argument", "Missing bookId or msgId.");

  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");

  // owner check
  const book = await db.doc(`books/${bookId}`).get();
  if (!book.exists) throw new HttpsError("not-found", "No such book.");
  const isOwner = book.data().ownerUid === auth.uid;
  const isCaretaker = auth.token && auth.token.bookId === bookId && auth.token.role === "caretaker";
  if (!isOwner && !isCaretaker)
    throw new HttpsError("permission-denied", "Not allowed to manage this book.");

  const msgRef = db.doc(`books/${bookId}/messages/${msgId}`);
  const msg = await msgRef.get();
  if (msg.exists) {
    const d = msg.data();
    const bucket = admin.storage().bucket();
    for (const p of [d.photoPath, d.voicePath]) {
      if (p) { try { await bucket.file(p).delete(); } catch (e) {} }
    }
    await msgRef.delete();
  }
  return { ok: true };
}));
