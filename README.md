# Keepsake Book — a template anyone can use

Make a small interactive book of messages for someone, themed around a
flower they love. Friends add "pages" from anywhere; the recipient opens
the finished book with a private key. One deployment can host **many**
books — each with its own ID, theme, messages, and key.

## How access works (the secure part)

- **Friends** sign in anonymously and may only *add* a page to a book.
- **Recipient** has a **key**. They type it, a Cloud Function (`redeemKey`)
  verifies it server-side and mints a **token scoped to that one book**.
  The key alone unlocks nothing — only the function can issue the token —
  so a friend who has the submission link still cannot read the book.
- **You (owner)** sign in with Google. You manage your own books.
- Page deletion runs through the `deletePage` function so the photo/voice
  files are removed too.

Keys are stored only as salted hashes, in a doc no client can read.

---

## What's included

All pages are built and wired to `?b=BOOKID`:

- **`create.html`** — owner wizard: pick flower + colour + name + dedication, set the recipient's key, get three links.
- **`index.html`** — friends' submission page (themed from the book; English).
- **`book.html`** — the recipient's book: enter the key → page-turn book themed to their flower.
- **`admin.html`** — owner manage page: Google sign-in, view and remove pages.

Recipient books are English. The friends' page uses the owner's custom
invitation text when given, otherwise a sensible default line.

---

## Deploy (one-time)

> Requires the **Blaze** plan (Cloud Functions). At this scale it's effectively free.

1. **Firebase project** → create or pick one; upgrade to Blaze.
2. **Authentication → Sign-in method:** enable **Google** *and* **Anonymous**.
3. **Firestore Database → Create**, and **Storage → Get started**.
4. Paste your web config into `assets/firebase-init.js` (the `firebaseConfig` block).
5. Install function deps:
   ```bash
   cd functions && npm install && cd ..
   ```
6. Deploy everything:
   ```bash
   firebase login
   firebase use --add
   firebase deploy
   ```
   This publishes hosting, the three functions, and the Firestore + Storage rules.

7. Open `https://YOURSITE.web.app/create.html`, sign in with Google, and make a book.

### Notes
- Functions default to the `us-central1` region. If you deploy elsewhere,
  set the region in `assets/firebase-init.js` (`getFunctions(app, 'your-region')`).
- The owner's Google account is automatically the manager of the books they create.
- `flowers.js` holds the flower library — add more by writing one function and
  registering it in the `FLOWERS` map.

### Files
```
create.html            owner wizard (build a book)
index.html             friends' submission page  (?b=BOOKID)
book.html              recipient's book          (?b=BOOKID, keyed)
admin.html             owner manage page         (?b=BOOKID, Google)
assets/
  flowers.js           themeable flower SVG library
  theme.js             petals, music, accent, specimen renderer
  theme.css            shared styling
  firebase-init.js     ← paste config; client helpers
functions/
  index.js             createBook, redeemKey, deletePage
  package.json
firestore.rules        multi-tenant DB security
storage.rules          multi-tenant file security
firebase.json          hosting + functions + rules
```
