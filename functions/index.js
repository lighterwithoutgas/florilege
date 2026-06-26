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
const PRICE_CENTS = 500;      // €5.00 — only used if PAYMENTS_ENABLED is turned back on
const CURRENCY = "eur";

/* ---------- free-tier cap ----------
   Florilège is free. To keep it from being abused into an unlimited book farm,
   each (real, signed-in) account may create at most this many books. The site
   owner can lift the cap for themselves with the OWNER_CODE below. */
const MAX_BOOKS_PER_USER = 2;

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
const PAYMENTS_ENABLED = true;   // €5/book — books activate only after Stripe confirms payment.

/* Secret owner code — lets YOU create books for free.
   Visit /create?owner=THE_CODE and the payment step is skipped.
   Stored in functions/.env (which is gitignored) — never committed, never sent to browsers. */
const OWNER_CODE = process.env.OWNER_CODE || "";

/* Site admins — the Google accounts allowed into the /console moderation view.
   Comma-separated emails in functions/.env (gitignored), e.g.
     ADMIN_EMAILS=you@gmail.com,teammate@gmail.com
   Empty → nobody is an admin (the console denies everyone), a safe default. */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/* true only for a signed-in caller whose verified Google email is allowlisted */
function isAdmin(request) {
  const t = request.auth && request.auth.token;
  if (!t || !t.email || t.email_verified !== true) return false;
  return ADMIN_EMAILS.includes(String(t.email).toLowerCase());
}

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

/* ============================================================
   PayPal — second payment option, redirect flow mirroring Stripe.
   Keep PAYPAL_ENABLED false until the REST app credentials are in
   Secret Manager:
     firebase functions:secrets:set PAYPAL_CLIENT_ID
     firebase functions:secrets:set PAYPAL_SECRET
   then set PAYPAL_ENABLED = true and redeploy. Flip PAYPAL_LIVE = true
   only when moving off sandbox. Also flip PAYPAL_ON in create.html so
   the button shows. The book is still only created after capture.
   ============================================================ */
const PAYPAL_ENABLED = true;    // PayPal functions live (sandbox creds in Secret Manager)
const PAYPAL_LIVE = false;      // false → sandbox API, true → live API
const PAYPAL_CLIENT_ID = defineSecret("PAYPAL_CLIENT_ID");
const PAYPAL_SECRET = defineSecret("PAYPAL_SECRET");
function paypalBase() {
  return PAYPAL_LIVE ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}
/* stable 2nd-gen alias for our HTTP functions — used as the PayPal return_url */
const FUNCTIONS_BASE = "https://us-central1-graduation-abd07.cloudfunctions.net";

/* fallback site origin used if the client doesn't send a clean one */
const FALLBACK_ORIGIN = "https://getflorilege.com";

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
  const friends = `${base}/a/${bookId}`;
  const recipient = `${base}/b/${bookId}`;
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
      <p style="background:#FBF3F6;border:1px solid #EBD3DD;border-radius:6px;padding:.7rem .9rem">
         <b>Keep this book for good →</b> <a href="${base}/my">Save it to your account</a> with Google,
         so you can find it on any device and manage it without hunting for this email.</p>
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

/* turn a paid checkout stash into the real, active book. Idempotent — safe to
   call more than once (duplicate Stripe webhooks, repeated PayPal return hits).
   Returns "created" | "existed" | "no-stash". paymentMeta is merged onto the book. */
async function materializeBook(bookId, paymentMeta) {
  const bookRef = db.doc(`books/${bookId}`);
  const existing = await bookRef.get();
  if (existing.exists) {
    await bookRef.set({
      status: "active",
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      ...paymentMeta,
    }, { merge: true });
    return "existed";
  }
  const stashRef = db.doc(`checkouts/${bookId}`);
  const stash = await stashRef.get();
  if (!stash.exists) return "no-stash";
  const { publicDoc, privateContent, keys } = stash.data();
  const batch = db.batch();
  batch.set(bookRef, {
    ...publicDoc,
    status: "active",
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
    ...paymentMeta,
  });
  batch.set(db.doc(`books/${bookId}/private/content`), privateContent);
  batch.set(db.doc(`books/${bookId}/private/keys`), keys);
  batch.delete(stashRef);
  await batch.commit();
  return "created";
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

  // a valid owner code lifts the free-tier cap for the site owner
  const ownerFree = typeof ownerCode === "string" && ownerCode.length > 0 && ownerCode === OWNER_CODE;

  // books may only be made from a real (Google) account, never an anonymous
  // throwaway — that's what makes the per-account book limit meaningful.
  const provider = request.auth.token &&
                   request.auth.token.firebase &&
                   request.auth.token.firebase.sign_in_provider;
  if (provider === "anonymous" && !ownerFree)
    throw new HttpsError("unauthenticated", "Please sign in with Google to make a book.");

  // free-tier abuse cap only applies when books are free. In paid mode the €5
  // charge is the throttle, so paying customers may make as many as they like.
  if (!ownerFree && !PAYMENTS_ENABLED) {
    const mine = await db.collection("books").where("ownerUid", "==", uid).get();
    if (mine.size >= MAX_BOOKS_PER_USER)
      throw new HttpsError("resource-exhausted",
        `You've reached the limit of ${MAX_BOOKS_PER_USER} books on your account.`);
  }

  const { publicDoc, privateContent, keys, recipientName } =
    buildBookDocs(uid, config, viewerKey, caretakerKey);

  const bookId = newId();
  const base = cleanOrigin(origin);

  // ----- FREE: payments globally off, OR the owner code was supplied -----
  if (!PAYMENTS_ENABLED || ownerFree) {
    publicDoc.status = "active";
    publicDoc.paidAt = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(db.doc(`books/${bookId}`), publicDoc);
    batch.set(db.doc(`books/${bookId}/private/content`), privateContent);
    batch.set(db.doc(`books/${bookId}/private/keys`), keys);
    await batch.commit();
    return { url: `${base}/s/${bookId}`, bookId, free: true };
  }

  // ----- PAID MODE: no book yet -----
  // The book is NOT created on "Pay". We only stash the assembled docs in a
  // server-only `checkouts/{bookId}` holding doc; the stripeWebhook turns that
  // into the real book once payment completes. If the buyer abandons checkout,
  // nothing is ever written to `books`, so no half-made book is left behind.
  await db.doc(`checkouts/${bookId}`).set({
    publicDoc,
    privateContent,
    keys,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

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
    success_url: `${base}/s/${bookId}`,
    cancel_url: `${base}/create?pay=cancel`,
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
            const result = await materializeBook(bookId, { stripeSessionId: session.id });
            if (result === "no-stash") {
              console.error("No checkout stash for paid session", bookId);
              return res.json({ received: true });   // nothing to build; don't make Stripe retry forever
            }
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

/* ---------- PayPal helpers ---------- */
async function paypalAccessToken() {
  const creds = Buffer.from(`${PAYPAL_CLIENT_ID.value()}:${PAYPAL_SECRET.value()}`).toString("base64");
  const r = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal auth failed: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

/* ============================================================
   startPaypalOrder — anyone (anonymous auth). Stashes the book in
   checkouts/{bookId} (no book yet) and creates a PayPal order.
   data: { config, viewerKey, caretakerKey, origin }
   returns: { url, bookId }  (url = PayPal approval link)
   ============================================================ */
exports.startPaypalOrder = onCall(
  PAYPAL_ENABLED ? { secrets: [PAYPAL_CLIENT_ID, PAYPAL_SECRET] } : {},
  guard(async (request) => {
    if (!PAYPAL_ENABLED) throw new HttpsError("failed-precondition", "PayPal isn't available yet.");
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Could not start. Please reload and try again.");

    const { config = {}, viewerKey, caretakerKey, origin } = request.data || {};

    // books may only be made from a real (Google) account, never an anonymous throwaway
    const provider = request.auth.token && request.auth.token.firebase &&
                     request.auth.token.firebase.sign_in_provider;
    if (provider === "anonymous")
      throw new HttpsError("unauthenticated", "Please sign in with Google to make a book.");

    const { publicDoc, privateContent, keys, recipientName } =
      buildBookDocs(uid, config, viewerKey, caretakerKey);
    const bookId = newId();
    const base = cleanOrigin(origin);

    // stash only — the book is created after capture, same as the Stripe path
    await db.doc(`checkouts/${bookId}`).set({
      publicDoc, privateContent, keys,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const token = await paypalAccessToken();
    const amount = (PRICE_CENTS / 100).toFixed(2);   // "5.00"
    const r = await fetch(`${paypalBase()}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          custom_id: bookId,
          description: `Florilège book for ${recipientName}`.slice(0, 127),
          amount: { currency_code: CURRENCY.toUpperCase(), value: amount },
        }],
        application_context: {
          brand_name: "Florilège",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: `${FUNCTIONS_BASE}/paypalCapture?bookId=${encodeURIComponent(bookId)}&origin=${encodeURIComponent(base)}`,
          cancel_url: `${base}/create?paypal=cancel`,
        },
      }),
    });
    if (!r.ok) throw new HttpsError("internal", `PayPal order failed: ${r.status} ${await r.text()}`);
    const order = await r.json();
    const approve = (order.links || []).find((l) => l.rel === "approve");
    if (!approve) throw new HttpsError("internal", "PayPal did not return an approval link.");
    return { url: approve.href, bookId };
  })
);

/* ============================================================
   paypalCapture — PayPal redirects the buyer here (return_url) after
   they approve. We capture the order, build the book from its stash,
   then redirect the browser to the success page. GET, idempotent.
   ============================================================ */
if (PAYPAL_ENABLED) {
  exports.paypalCapture = onRequest(
    { secrets: EMAIL_ENABLED
        ? [PAYPAL_CLIENT_ID, PAYPAL_SECRET, GMAIL_USER, GMAIL_APP_PASSWORD]
        : [PAYPAL_CLIENT_ID, PAYPAL_SECRET] },
    async (req, res) => {
      const bookId = req.query.bookId;
      const origin = cleanOrigin(req.query.origin);
      const orderId = req.query.token;   // PayPal appends ?token=<orderId>&PayerID=...
      const fail = (why) => {
        console.error("PayPal capture problem:", why, "book", bookId);
        return res.redirect(302, `${origin}/create?paypal=failed`);
      };
      if (!bookId || !orderId) return fail("missing bookId/token");
      try {
        const token = await paypalAccessToken();
        const r = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        const data = await r.json().catch(() => ({}));
        // an already-captured order returns 422 ORDER_ALREADY_CAPTURED — that's a
        // repeat visit to the return URL, so treat it as success (idempotent).
        const alreadyCaptured = r.status === 422 && JSON.stringify(data).includes("ORDER_ALREADY_CAPTURED");
        if (!r.ok && !alreadyCaptured) return fail(`capture ${r.status} ${JSON.stringify(data)}`);

        // verify the captured order is for this book and the right amount
        let capId = null, payerEmail = null;
        const pu = data.purchase_units && data.purchase_units[0];
        if (pu) {
          if (pu.custom_id && pu.custom_id !== bookId) return fail("custom_id mismatch");
          const cap = pu.payments && pu.payments.captures && pu.payments.captures[0];
          if (cap) {
            capId = cap.id;
            if (cap.amount && cap.amount.value !== (PRICE_CENTS / 100).toFixed(2)) return fail("amount mismatch");
          }
        }
        if (data.payer && data.payer.email_address) payerEmail = data.payer.email_address;

        const result = await materializeBook(bookId, { paypalOrderId: orderId, paypalCaptureId: capId });
        if (result === "no-stash") return fail("no checkout stash");

        if (EMAIL_ENABLED && payerEmail && result === "created") {
          try { await sendLinksEmail(payerEmail, bookId); }
          catch (e) { console.error("Failed to email links (paypal) for", bookId, e); }
        }
        return res.redirect(302, `${origin}/s/${encodeURIComponent(bookId)}`);
      } catch (e) {
        return fail(e && e.message ? e.message : String(e));
      }
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

/* ============================================================
   deleteBook — owner only. Permanently removes a book and
   everything beneath it: all friend pages, the private content +
   hashed keys, and every uploaded file. Lets an owner clean up old
   books (e.g. unfinished ones left over from the paid era).
   data: { bookId }
   ============================================================ */
/* shared wipe: remove every Storage object under the book, then the doc + all
   subcollections (messages, private/content, private/keys). Used by the owner
   delete and the admin delete. */
async function wipeBook(bookId) {
  const ref = db.doc(`books/${bookId}`);
  // best-effort: a Storage hiccup must not block the Firestore cleanup.
  try {
    await admin.storage().bucket().deleteFiles({ prefix: `books/${bookId}/` });
  } catch (e) { console.error("wipeBook: storage cleanup failed", bookId, e); }
  await db.recursiveDelete(ref);
}

exports.deleteBook = onCall(guard(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const { bookId } = request.data || {};
  if (!bookId) throw new HttpsError("invalid-argument", "Missing bookId.");

  const ref = db.doc(`books/${bookId}`);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };           // already gone — treat as success
  if (snap.data().ownerUid !== uid)
    throw new HttpsError("permission-denied", "Only the owner can delete this book.");

  await wipeBook(bookId);
  return { ok: true };
}));

/* ============================================================
   adminListBooks / adminDeleteBook — site-wide moderation view.
   Restricted to allowlisted admin accounts (ADMIN_EMAILS). The
   listing uses the Admin SDK so it can read every book regardless
   of owner, which the client SDK's rules never allow.
   ============================================================ */
exports.adminListBooks = onCall(guard(async (request) => {
  if (!isAdmin(request)) throw new HttpsError("permission-denied", "Admins only.");

  const snap = await db.collection("books").orderBy("createdAt", "desc").get();
  const books = snap.docs.map((d) => {
    const b = d.data() || {};
    return {
      id: d.id,
      recipientName: b.recipientName || "",
      ownerEmail: b.ownerEmail || null,
      ownerUid: b.ownerUid || null,
      status: b.status || "pending",
      major: b.major || "",
      year: b.year || "",
      flower: b.flower || "carnation",
      flowerColor: b.flowerColor || "#D2588A",
      coverSymbol: b.coverSymbol || "flower",
      emblem: b.emblem || "cap",
      nameScript: b.nameScript || "latin",
      hasManageKey: !!b.hasManageKey,
      createdAtMs: (b.createdAt && b.createdAt.toMillis) ? b.createdAt.toMillis() : null,
      paidAtMs: (b.paidAt && b.paidAt.toMillis) ? b.paidAt.toMillis() : null,
    };
  });
  return { books, total: books.length };
}));

exports.adminDeleteBook = onCall(guard(async (request) => {
  if (!isAdmin(request)) throw new HttpsError("permission-denied", "Admins only.");
  const { bookId } = request.data || {};
  if (!bookId) throw new HttpsError("invalid-argument", "Missing bookId.");
  await wipeBook(bookId);
  return { ok: true };
}));

/* ============================================================
   startClaim / finishClaim — attach a book to the buyer's real
   (Google) account.

   A book is created under a throwaway *anonymous* uid. When the
   buyer signs in with Google, the browser tries to LINK that
   anonymous account to Google (which keeps the same uid — nothing
   to do here). But if they already have a Florilège account from a
   previous purchase, linking fails and they end up signed into that
   *existing* account, whose uid differs from the book's ownerUid.
   These two calls hand ownership across that gap without ever
   letting a stranger claim someone else's book:

     1) startClaim  — called while still the anonymous OWNER. Mints a
        one-time token (stored hashed on the locked keys doc) that
        proves "whoever holds this owned the book moments ago".
     2) finishClaim — called after signing into the real account.
        Possession of the token transfers ownerUid to the caller.

   The token lives only ~10 minutes and is single-use.
   ============================================================ */
exports.startClaim = onCall(guard(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please reload and try again.");
  const { bookId } = request.data || {};
  if (!bookId) throw new HttpsError("invalid-argument", "Missing bookId.");

  const book = await db.doc(`books/${bookId}`).get();
  if (!book.exists) throw new HttpsError("not-found", "No such book.");
  if (book.data().ownerUid !== uid)
    throw new HttpsError("permission-denied", "Only the current owner can move this book.");

  const token = randomBytes(24).toString("base64url");
  await db.doc(`books/${bookId}/private/keys`).set({
    claim: {
      ...hashKey(token),
      expires: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    },
  }, { merge: true });
  return { token };
}));

exports.finishClaim = onCall(guard(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in and try again.");
  const { bookId, token } = request.data || {};
  if (!bookId || !token) throw new HttpsError("invalid-argument", "Missing bookId or token.");

  const keysRef = db.doc(`books/${bookId}/private/keys`);
  const snap = await keysRef.get();
  const claim = snap.exists && snap.data().claim;
  if (!claim) throw new HttpsError("failed-precondition", "This book can't be claimed right now.");
  if (!claim.expires || claim.expires.toMillis() < Date.now()) {
    await keysRef.update({ claim: admin.firestore.FieldValue.delete() });
    throw new HttpsError("deadline-exceeded", "This claim expired. Please try again.");
  }
  if (!verifyKey(token, claim.salt, claim.hash))
    throw new HttpsError("permission-denied", "Invalid claim token.");

  const email = (request.auth.token && request.auth.token.email) || null;
  await db.doc(`books/${bookId}`).set({
    ownerUid: uid,
    ownerEmail: email ? String(email).toLowerCase() : null,
  }, { merge: true });
  await keysRef.update({ claim: admin.firestore.FieldValue.delete() });
  return { ok: true };
}));
