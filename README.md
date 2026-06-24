# Florilège 🌸

A graduation keepsake-book web app. Someone makes a little interactive book for a
graduate, friends add pages (a message, a photo, a voice note), and the graduate
opens it with a secret key — the whole class, pressed into one book.

**Live:** https://getflorilege.com

---

## How it works

1. **Make a book** (`/create`) — sign in with Google, then pick the recipient's name,
   faculty/major theme, a flower (or major emblem), colours, a dedication, a
   "then & now" photo, and a recipient key. It's **free** — the book is created the
   moment you confirm. Each account may make **up to two books**.
2. **Friends add pages** (`/a/<id>`) — one shared link; each friend presses in their
   own page (text + optional photo + optional voice note).
3. **The graduate opens it** (`/b/<id>`) — enters the secret key and flips through
   the book: cover, dedication, botanical plate, then & now, every friend's page.
4. **Manage** (`/m/<id>`) — with an optional management key, the owner can remove pages.

A short example with no key: **`/book?demo=1`**.

## Routes

| Path | Page |
|------|------|
| `/` | Landing |
| `/create` | Make a book |
| `/s/<id>` | Success / share links |
| `/a/<id>` | Friends add a page |
| `/b/<id>` | The book (key-gated) |
| `/m/<id>` | Manage / remove pages (management key) |

## Stack

- **Firebase Hosting** (static, clean URLs + rewrites for the short paths)
- **Cloud Functions (gen 2, Node)** — `startCheckout`, `stripeWebhook`, `redeemKey`, `deletePage`
- **Cloud Firestore** + **Cloud Storage** (rules-enforced)
- **Firebase Auth** — Google sign-in (book owners) + anonymous (friends) + custom tokens for the `viewer`/`caretaker` roles
- **Free**, capped at two books per account (server-enforced in `startCheckout`). Stripe Checkout code is retained but dormant (`PAYMENTS_ENABLED = false`) for easy re-enabling.
- Vanilla HTML / CSS / JS (no framework)

## Security model

- Recipient/management keys are **hashed server-side** (scrypt + salt) — never stored or sent in plaintext.
- `redeemKey` verifies a key server-side and mints a **custom token** scoped to one book + role; the Firestore rules check those claims.
- Books are created **active** (free); friends can only post to active books; brute-force is throttled. Books may only be made from a real (Google) account, and each account is capped at two — both enforced server-side.
- All real secrets live in **Google Secret Manager / `functions/.env`** — never in this repo.

## Setup

```bash
cd functions && npm install
```

Create `functions/.env` from the example and set your owner code:

```bash
cp functions/.env.example functions/.env   # then edit OWNER_CODE
```

Set the secrets (only needed for the features you enable):

```bash
firebase functions:secrets:set STRIPE_SECRET          # sk_live_… / sk_test_…
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET  # whsec_… (from the Stripe webhook)
firebase functions:secrets:set GMAIL_USER             # gmail address (for buyer emails)
firebase functions:secrets:set GMAIL_APP_PASSWORD     # 16-char Gmail app password
```

Feature flags in `functions/index.js`:

- `PAYMENTS_ENABLED` — `false` (current) makes the site free; `true` re-enables Stripe payment.
- `MAX_BOOKS_PER_USER` — free-tier cap per account (default `2`).
- `EMAIL_ENABLED` — emails owners their links after payment (only fires in paid mode; needs the Gmail secrets).
- `OWNER_CODE` (from `.env`) — visit `/create?owner=<code>` to lift the two-book cap for yourself.

Deploy:

```bash
firebase deploy
```

> Note: this repo intentionally contains **no secrets**. `functions/.env` and
> `node_modules/` are gitignored; copy `.env.example` and add your own values.
