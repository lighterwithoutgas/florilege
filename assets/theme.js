/* ============================================================
   Keepsake Book — shared theme helpers (English, config-driven)
   ============================================================ */

/* Recolor the whole theme to a book's flower colour. The petals and
   accents in theme.css read these variables, so they follow along. */
export function applyAccent(hex) {
  if (!hex) return;
  const r = document.documentElement.style;
  r.setProperty('--carnation', hex);
  r.setProperty('--carnation-2', shade(hex, -28));
  r.setProperty('--blush', shade(hex, 90));
}
export function shade(hex, amt) {
  try {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, Math.min(255, r + amt));
    g = Math.max(0, Math.min(255, g + amt));
    b = Math.max(0, Math.min(255, b + amt));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  } catch (e) { return hex; }
}

export function getBookId() {
  return new URLSearchParams(location.search).get('b');
}

export function dirOf(text = '') {
  const ar = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const lat = (text.match(/[A-Za-z]/g) || []).length;
  return ar > lat ? 'rtl' : 'ltr';
}
export function escapeHTML(s = '') {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids) { if (kid == null) continue; n.append(kid.nodeType ? kid : document.createTextNode(kid)); }
  return n;
}

/* pressed-flower corner sprig (decorative) */
export function sprigSVG() {
  return `
  <svg viewBox="0 0 80 80" width="74" height="74" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M8 72 C 26 58, 40 44, 52 18" fill="none" stroke="#7e966f" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M28 50 C 18 46, 12 50, 8 60 C 20 58, 26 54, 28 50Z" fill="#8aa07f"/>
    <path d="M38 36 C 30 30, 22 32, 18 42 C 30 40, 36 40, 38 36Z" fill="#7e966f"/>
    <g transform="translate(54 14)">
      <circle r="3.2" fill="var(--carnation, #D2588A)"/>
      <g fill="var(--blush, #f1a9c4)">
        ${[0,72,144,216,288].map(a=>{const x=(Math.cos(a*Math.PI/180)*7).toFixed(1),y=(Math.sin(a*Math.PI/180)*7).toFixed(1);return `<ellipse cx="${x}" cy="${y}" rx="4" ry="2.4" transform="rotate(${a} ${x} ${y})"/>`;}).join('')}
      </g>
      <circle r="2" fill="#C9A24B"/>
    </g>
  </svg>`;
}

/* falling petals */
export function startPetals(count = 12) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let field = document.querySelector('.petal-field');
  if (!field) { field = document.createElement('div'); field.className = 'petal-field'; document.body.appendChild(field); }
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div'); p.className = 'petal';
    const dur = 12 + Math.random() * 14;
    p.style.left = (Math.random() * 100) + 'vw';
    p.style.setProperty('--drift', (Math.random() * 160 - 80) + 'px');
    p.style.setProperty('--s', (0.6 + Math.random() * 0.9).toFixed(2));
    p.style.animationDuration = dur + 's';
    p.style.animationDelay = (-Math.random() * dur) + 's';
    field.appendChild(p);
  }
}

/* gentle generated music-box (off by default) */
let actx = null, timer = null, master = null;
export function toggleMusic(on) {
  if (on) {
    if (!actx) { actx = new (window.AudioContext || window.webkitAudioContext)(); master = actx.createGain(); master.gain.value = 0; master.connect(actx.destination); }
    actx.resume();
    master.gain.cancelScheduledValues(actx.currentTime);
    master.gain.linearRampToValueAtTime(0.16, actx.currentTime + 1.2);
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
    const play = () => {
      const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = scale[Math.floor(Math.random() * scale.length)];
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9, t + 0.04); g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 2.5);
    };
    play(); timer = setInterval(play, 1300); return true;
  } else {
    if (master) { master.gain.cancelScheduledValues(actx.currentTime); master.gain.linearRampToValueAtTime(0, actx.currentTime + 0.6); }
    clearInterval(timer); timer = null; return false;
  }
}

/* a friend's specimen page — shared by the book and the submission preview */
export function specimenPageHTML(page) {
  const mdir = dirOf(page.message || page.name || '');
  const name = escapeHTML(page.name || 'A friend');
  const msg = escapeHTML(page.message || '').replace(/\n/g, '<br>');
  const photo = page.photoSrc
    ? `<figure class="spec-photo"><img src="${page.photoSrc}" alt="" loading="lazy"><span class="tape tape-l"></span><span class="tape tape-r"></span></figure>` : '';
  const voice = page.voiceSrc
    ? `<div class="spec-voice"><button class="voice-btn" data-voice="${page.voiceSrc}" aria-label="Play voice note">▶</button>
         <span class="voice-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
         <span class="voice-label">Voice note</span></div>` : '';
  return `
    <div class="specimen" dir="${mdir}">
      <div class="spec-tag"><span class="spec-label">No.</span><span class="spec-name">${name}</span></div>
      ${photo}
      <p class="spec-msg">${msg}</p>
      ${voice}
      <div class="spec-press">${sprigSVG()}</div>
    </div>`;
}

export function wireVoice(scope) {
  scope.querySelectorAll('.voice-btn').forEach(btn => {
    const a = new Audio(btn.dataset.voice);
    const wave = btn.parentElement.querySelector('.voice-wave');
    btn.addEventListener('click', () => {
      if (a.paused) { a.play(); btn.textContent = '❚❚'; wave.classList.add('playing'); }
      else { a.pause(); btn.textContent = '▶'; wave.classList.remove('playing'); }
    });
    a.addEventListener('ended', () => { btn.textContent = '▶'; wave.classList.remove('playing'); });
  });
}
