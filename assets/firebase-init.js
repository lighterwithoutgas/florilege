/* ============================================================
   Keepsake Book — client Firebase helpers (multi-tenant)
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, signInWithCustomToken, signInWithPopup,
  linkWithPopup, signInWithCredential,
  GoogleAuthProvider, onAuthStateChanged, signOut as fbSignOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, getDoc, getDocs, where,
  onSnapshot, query, orderBy, serverTimestamp, updateDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

/* ⬇⬇⬇  PASTE THE DEPLOYER'S FIREBASE CONFIG HERE  ⬇⬇⬇ */
export const firebaseConfig = {
  apiKey: "AIzaSyABD1zUpCM033wp498z09kmlhx_ZftNpeQ",
  authDomain: "graduation-abd07.firebaseapp.com",
  projectId: "graduation-abd07",
  storageBucket: "graduation-abd07.firebasestorage.app",
  messagingSenderId: "26444805197",
  appId: "1:26444805197:web:637f43096c9cfd13399804",
  measurementId: "G-D9J88X5CGP"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);
const fnStartCheckout = httpsCallable(functions, "startCheckout");
const fnRedeemKey     = httpsCallable(functions, "redeemKey");
const fnDeletePage    = httpsCallable(functions, "deletePage");
const fnStartClaim    = httpsCallable(functions, "startClaim");
const fnFinishClaim   = httpsCallable(functions, "finishClaim");

const PENDING_CLAIM = "florilege_pending_claim";

/* ---------- auth ---------- */
export function googleSignIn() { return signInWithPopup(auth, new GoogleAuthProvider()); }
export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }
export function signOut() { return fbSignOut(auth); }
export function currentUser() { return auth.currentUser; }
export function isSignedInAccount() { const u = auth.currentUser; return !!u && !u.isAnonymous; }
export function ensureAnon() {
  return new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, (u) => {
      if (u) { off(); resolve(u); }
      else signInAnonymously(auth).catch(reject);
    });
  });
}
export async function redeemKeyAndSignIn(bookId, role, key) {
  const res = await fnRedeemKey({ bookId, role, key });
  await signInWithCustomToken(auth, res.data.token);
}

/* ---------- buyer: pay, then a book is created ----------
   Signs in anonymously (invisible), creates a PENDING book and a Stripe
   Checkout session, and returns { url, bookId }. Redirect the browser to
   `url`; the book goes live only after Stripe confirms payment. */
export async function startCheckout(config, viewerKey, caretakerKey, ownerCode) {
  await ensureAnon();
  const res = await fnStartCheckout({
    config,
    viewerKey,
    caretakerKey: caretakerKey || null,
    origin: location.origin,
    ownerCode: ownerCode || null,
  });
  return res.data; // { url, bookId }
}
/* buyer uploads a "then"/"now" photo BEFORE the book exists (no login).
   Returns a download URL to store in the book's private content. */
export async function uploadPhoto(file, kind) {
  await ensureAnon();
  const uid = auth.currentUser.uid;
  const path = `uploads/${uid}/${Date.now()}_${kind}`;
  await uploadBytes(ref(storage, path), file);
  return await getDownloadURL(ref(storage, path));
}

/* owner uploads a "then" photo after the book exists, then records it */
export async function attachThenPhoto(bookId, file) {
  const uid = auth.currentUser.uid;
  const path = `books/${bookId}/owner/${uid}/then`;
  await uploadBytes(ref(storage, path), file);
  const url = await getDownloadURL(ref(storage, path));
  await updateDoc(doc(db, `books/${bookId}`), { hasThen: true });
  await setDoc(doc(db, `books/${bookId}/private/content`), { thenPhotoURL: url }, { merge: true });
  return url;
}

/* ---------- buyer: save a book to a real (Google) account ----------
   Turns the throwaway anonymous owner into a durable Google account so
   the buyer can find and manage the book on any device.

   Returns one of: 'already' (was already signed in), 'linked' (the
   anonymous account became this Google account — same uid, nothing else
   to do), or 'claimed' (the book was handed to a pre-existing account).

   The 'claimed' path stashes a one-time token in localStorage and signs
   into the existing account; finishPendingClaim() (run on the dashboard)
   completes the hand-off, so a hiccup mid-switch can always be retried. */
export async function saveBookToAccount(bookId) {
  await ensureAnon();
  const u = auth.currentUser;
  if (u && !u.isAnonymous) {            // already a real account → book is already theirs
    await markOwnerEmail(bookId);
    return "already";
  }
  const provider = new GoogleAuthProvider();
  try {
    await linkWithPopup(auth.currentUser, provider);  // anon → Google, uid preserved
    await markOwnerEmail(bookId);
    return "linked";
  } catch (e) {
    if (e && e.code === "auth/credential-already-in-use") {
      const cred = GoogleAuthProvider.credentialFromError(e);
      if (!cred) throw e;
      const { data } = await fnStartClaim({ bookId });   // proof minted while still owner
      try { localStorage.setItem(PENDING_CLAIM, JSON.stringify({ bookId, token: data.token })); } catch (_) {}
      await signInWithCredential(auth, cred);            // now their existing account
      await finishPendingClaim();
      return "claimed";
    }
    throw e;
  }
}

/* Record the owner's email on the book (handy for support/lookup).
   Allowed by the rules because the caller is the owner. Best-effort. */
export async function markOwnerEmail(bookId) {
  const u = auth.currentUser;
  if (!u || !u.email) return;
  try { await updateDoc(doc(db, `books/${bookId}`), { ownerEmail: u.email.toLowerCase() }); } catch (_) {}
}

/* Complete any ownership transfer left pending in this browser.
   Safe to call on every dashboard load. Returns true if one finished. */
export async function finishPendingClaim() {
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(PENDING_CLAIM) || "null"); } catch (_) {}
  if (!pending || !pending.bookId || !pending.token) return false;
  const u = auth.currentUser;
  if (!u || u.isAnonymous) return false;   // need a real account to receive the book
  try {
    await fnFinishClaim({ bookId: pending.bookId, token: pending.token });
    try { localStorage.removeItem(PENDING_CLAIM); } catch (_) {}
    return true;
  } catch (e) {
    // a dead/expired/denied claim is unrecoverable — stop retrying it
    const c = (e && e.code) || "";
    if (/deadline-exceeded|permission-denied|failed-precondition|not-found|invalid-argument/.test(c)) {
      try { localStorage.removeItem(PENDING_CLAIM); } catch (_) {}
    }
    return false;
  }
}

/* ---------- owner dashboard: list the books I own ---------- */
export async function listMyBooks() {
  const u = auth.currentUser;
  if (!u || u.isAnonymous) return [];
  const snap = await getDocs(query(collection(db, "books"), where("ownerUid", "==", u.uid)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => ((b.createdAt && b.createdAt.toMillis && b.createdAt.toMillis()) || 0)
                  - ((a.createdAt && a.createdAt.toMillis && a.createdAt.toMillis()) || 0));
}

/* ---------- read config ---------- */
export async function getBookConfig(bookId) {
  const snap = await getDoc(doc(db, `books/${bookId}`));
  return snap.exists() ? { id: bookId, ...snap.data() } : null;
}
export async function getPrivateContent(bookId) {
  const snap = await getDoc(doc(db, `books/${bookId}/private/content`));
  return snap.exists() ? snap.data() : {};
}

/* ---------- friends: create a page ---------- */
export async function addSubmission(bookId, { name, message, lang }, photoFile, voiceBlob) {
  await ensureAnon();
  const uid = auth.currentUser.uid;
  const stamp = Date.now();
  let photoURL = null, photoPath = null, voiceURL = null, voicePath = null;
  if (photoFile) {
    photoPath = `books/${bookId}/submissions/${uid}/${stamp}_photo`;
    await uploadBytes(ref(storage, photoPath), photoFile);
    photoURL = await getDownloadURL(ref(storage, photoPath));
  }
  if (voiceBlob) {
    voicePath = `books/${bookId}/submissions/${uid}/${stamp}_voice.webm`;
    await uploadBytes(ref(storage, voicePath), voiceBlob);
    voiceURL = await getDownloadURL(ref(storage, voicePath));
  }
  await addDoc(collection(db, `books/${bookId}/messages`), {
    name: name || "", message: message || "", lang: lang || "en",
    photoURL, photoPath, voiceURL, voicePath,
    uid, createdAt: serverTimestamp(), createdMs: stamp,
  });
}

/* ---------- recipient/owner: read pages ---------- */
export function listenPages(bookId, cb, onErr) {
  const q = query(collection(db, `books/${bookId}/messages`), orderBy("createdMs", "asc"));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (err) => onErr && onErr(err));
}

/* ---------- owner/caretaker: delete a page ---------- */
export async function deletePage(bookId, msgId) {
  await fnDeletePage({ bookId, msgId });
}
