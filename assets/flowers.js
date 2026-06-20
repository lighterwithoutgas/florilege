/* ============================================================
   Flower library — themeable botanical SVGs
   Every flower is flowerSVG(name, { size, color }) and shares a
   consistent stem/leaf treatment so they read as one set.
   `color` recolors the bloom; sensible defaults per flower.
   ============================================================ */

const STEM = '#6E8B6A', STEM_DEEP = '#4F6A4C', LEAF = '#7e966f', LEAF2 = '#93a886';

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amt)));
  g = Math.max(0, Math.min(255, Math.round(g + amt)));
  b = Math.max(0, Math.min(255, Math.round(b + amt)));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
const wrap = (size, inner, vb = '0 0 200 244') =>
  `<svg viewBox="${vb}" width="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
const stemLeaves = () => `
  <path d="M100 150 C 98 188, 103 210, 100 240" fill="none" stroke="${STEM}" stroke-width="5" stroke-linecap="round"/>
  <path d="M100 200 C 76 194, 62 202, 54 222 C 78 218, 92 210, 100 202 Z" fill="${LEAF2}"/>
  <path d="M100 180 C 124 174, 138 182, 146 202 C 122 198, 108 190, 100 182 Z" fill="${LEAF}"/>`;

/* ---------------- Carnation (Chabaud) ---------------- */
function carnation(size, color) {
  const main = color || '#D2588A';
  const rings = [{r:64,n:17},{r:55,n:16},{r:45,n:15},{r:35,n:13},{r:25,n:11},{r:15,n:9}];
  let body = '';
  rings.forEach((ring, k) => {
    const rot = (k * 11) % 23;
    body += `<g transform="rotate(${rot})">`;
    body += fringeRing(ring.r, ring.n, main, 1.0, 0.62);
    body += fringeRing(ring.r, ring.n, '#fff3f7cc'.replace('#fff3f7', shade(main,150)), 0.9, 0.55);
    body += `</g>`;
  });
  return wrap(size, `
    <defs><linearGradient id="cst" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(STEM,20)}"/><stop offset="1" stop-color="${STEM_DEEP}"/></linearGradient></defs>
    <path d="M100 158 C 98 188, 103 210, 100 240" fill="none" stroke="url(#cst)" stroke-width="5" stroke-linecap="round"/>
    <path d="M100 204 C 76 198, 62 206, 54 226 C 78 222, 92 214, 100 206 Z" fill="${LEAF2}"/>
    <path d="M100 186 C 124 180, 138 188, 146 208 C 122 204, 108 196, 100 188 Z" fill="${LEAF}"/>
    <path d="M86 162 C 84 138, 88 126, 100 122 C 112 126, 116 138, 114 162 Z" fill="${STEM}"/>
    <g transform="translate(100 92)">${body}<circle r="4.5" fill="${shade(main,170)}"/></g>`);
}
function fringeRing(r, n, fill, lenK, widthK) {
  const step = (Math.PI*2)/n, dw = step*widthK; let d = '';
  for (let i=0;i<n;i++){
    const a=i*step+(Math.random()-.5)*step*.25, L=r*lenK*(.92+Math.random()*.16), ri=r*.16;
    const bx=Math.cos(a)*ri, by=Math.sin(a)*ri, lA=a-dw, rA=a+dw;
    const lx=Math.cos(lA)*r*.5, ly=Math.sin(lA)*r*.5, rx=Math.cos(rA)*r*.5, ry=Math.sin(rA)*r*.5;
    const t1=a-dw*.55, t2=a, t3=a+dw*.55;
    const p1x=Math.cos(t1)*L,p1y=Math.sin(t1)*L,p2x=Math.cos(t2)*L*.86,p2y=Math.sin(t2)*L*.86,p3x=Math.cos(t3)*L,p3y=Math.sin(t3)*L;
    const f=v=>v.toFixed(1);
    d+=`M${f(bx)} ${f(by)} L${f(lx)} ${f(ly)} L${f(p1x)} ${f(p1y)} L${f(p2x)} ${f(p2y)} L${f(p3x)} ${f(p3y)} L${f(rx)} ${f(ry)} Z `;
  }
  return `<path d="${d}" fill="${fill}"/>`;
}

/* ---------------- Rose (spiral bloom) ---------------- */
function rose(size, color) {
  const main = color || '#C75C7A';
  const g = `rose_${Math.random().toString(36).slice(2,7)}`;
  let petals = '';
  const layers = [{r:62,n:7},{r:48,n:6},{r:34,n:5},{r:22,n:5}];
  layers.forEach((L,li)=>{
    const lighten = li*16;
    for(let i=0;i<L.n;i++){
      const a = (360/L.n)*i + li*18;
      petals += `<g transform="rotate(${a}) translate(0 ${-L.r*0.5})">
        <path d="M0 ${-L.r*0.55} C ${L.r*0.5} ${-L.r*0.55}, ${L.r*0.42} ${L.r*0.35}, 0 ${L.r*0.42}
                 C ${-L.r*0.42} ${L.r*0.35}, ${-L.r*0.5} ${-L.r*0.55}, 0 ${-L.r*0.55} Z"
              fill="${shade(main,lighten)}" stroke="${shade(main,-25)}" stroke-width="0.6"/></g>`;
    }
  });
  // tight swirl center
  petals += `<path d="M-8 4 C -8 -8, 8 -8, 8 2 C 8 10, -4 10, -2 2" fill="none" stroke="${shade(main,40)}" stroke-width="3" stroke-linecap="round"/>`;
  return wrap(size, `
    ${stemLeaves()}
    <path d="M88 150 L112 150 L108 128 L92 128 Z" fill="${STEM}"/>
    <g transform="translate(100 96)">${petals}</g>`);
}

/* ---------------- Tulip (classic cup) ---------------- */
function tulip(size, color) {
  const main = color || '#D8504F';
  return wrap(size, `
    <path d="M100 120 C 98 170, 103 205, 100 240" fill="none" stroke="${STEM}" stroke-width="5.5" stroke-linecap="round"/>
    <path d="M100 210 C 70 196, 56 168, 52 138 C 74 150, 92 176, 100 206 Z" fill="${LEAF2}"/>
    <path d="M100 198 C 130 184, 146 156, 150 126 C 126 140, 110 168, 100 196 Z" fill="${LEAF}"/>
    <g transform="translate(100 86)">
      <path d="M-34 28 C -40 -18, -20 -44, 0 -44 C 20 -44, 40 -18, 34 28 C 18 40, -18 40, -34 28 Z" fill="${main}"/>
      <path d="M-34 28 C -34 -6, -28 -34, -14 -44 C -22 -22, -22 4, -14 30 Z" fill="${shade(main,-28)}"/>
      <path d="M34 28 C 34 -6, 28 -34, 14 -44 C 22 -22, 22 4, 14 30 Z" fill="${shade(main,-28)}"/>
      <path d="M-14 30 C -10 -10, -4 -38, 0 -44 C 4 -38, 10 -10, 14 30 C 6 40, -6 40, -14 30 Z" fill="${shade(main,22)}"/>
    </g>`);
}

/* ---------------- Lily (6 broad petals + spots + stamens) ---------------- */
function lily(size, color) {
  const main = color || '#E58BB0';
  let petals = '';
  for(let i=0;i<6;i++){
    const a=(360/6)*i + (i%2?14:-14);
    const back = i%2===0;
    const spots = back ? '' : `<g fill="${shade(main,-44)}" opacity=".55">
        <circle cx="-5" cy="-40" r="1.6"/><circle cx="5" cy="-52" r="1.6"/><circle cx="-3" cy="-64" r="1.4"/><circle cx="4" cy="-30" r="1.4"/></g>`;
    petals += `<g transform="rotate(${a})">
      <path d="M0 -6 C 30 -30, 28 -74, 6 -98 C 2 -101, -2 -101, -6 -98 C -28 -74, -30 -30, 0 -6 Z"
            fill="${back?shade(main,-16):main}" stroke="${shade(main,-30)}" stroke-width="0.7"/>
      <path d="M0 -10 L0 -92" stroke="${shade(main,-30)}" stroke-width="1.2" opacity=".45"/>
      ${spots}</g>`;
  }
  let stamens = '';
  for(let i=0;i<6;i++){
    const a=((360/6)*i + 30)*Math.PI/180, len=34;
    const x=(Math.cos(a-Math.PI/2)*len), y=(Math.sin(a-Math.PI/2)*len);
    stamens += `<line x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${shade(main,-46)}" stroke-width="1.8"/>
                <ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="5" ry="2.4" fill="#B5701F" transform="rotate(${(360/6)*i+30} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }
  return wrap(size, `
    ${stemLeaves()}
    <g transform="translate(100 94)">${petals}<g>${stamens}</g><circle r="6" fill="${shade(main,28)}"/></g>`);
}

/* ---------------- Sunflower ---------------- */
function sunflower(size, color) {
  const main = color || '#E6A92E';
  let petals = '';
  const n = 18;
  for(let i=0;i<n;i++){
    const a=(360/n)*i;
    petals += `<g transform="rotate(${a})"><path d="M0 -34 C 10 -54, 8 -76, 0 -86 C -8 -76, -10 -54, 0 -34 Z"
                 fill="${i%2?shade(main,18):main}" stroke="${shade(main,-30)}" stroke-width="0.5"/></g>`;
  }
  let seeds = '';
  for(let r=6;r<=26;r+=6){ const c=Math.round(r*1.6); for(let i=0;i<c;i++){ const a=(360/c)*i*Math.PI/180; seeds+=`<circle cx="${(Math.cos(a)*r).toFixed(1)}" cy="${(Math.sin(a)*r).toFixed(1)}" r="1.6" fill="#5b3d1f"/>`; } }
  return wrap(size, `
    ${stemLeaves()}
    <g transform="translate(100 96)">${petals}<circle r="32" fill="#7a5226"/><circle r="30" fill="#6b4a23"/>${seeds}</g>`);
}

/* ---------------- Lavender (floret spike) ---------------- */
function lavender(size, color) {
  const main = color || '#8E7BC4';
  let spikes = '';
  for(let s=-1;s<=1;s++){
    const cx = 100 + s*22, top = 40 + Math.abs(s)*16;
    let florets = '';
    for(let y=top;y<150;y+=12){
      const sway = Math.sin(y*0.2)*4;
      florets += `<ellipse cx="${cx+sway}" cy="${y}" rx="7" ry="6" fill="${y< top+40?shade(main,20):main}"/>`;
    }
    spikes += `<path d="M${cx} 150 C ${cx-2} 180, ${cx+ (100-cx)*0.6} 210, 100 240" fill="none" stroke="${STEM}" stroke-width="3.4" stroke-linecap="round"/>${florets}`;
  }
  return wrap(size, `
    <path d="M100 200 C 76 196, 64 204, 58 222 C 80 218, 92 210, 100 202 Z" fill="${LEAF2}"/>
    <path d="M100 188 C 124 184, 136 192, 142 210 C 120 206, 108 198, 100 190 Z" fill="${LEAF}"/>
    ${spikes}`);
}

/* ---------------- Daisy ---------------- */
function daisy(size, color) {
  const main = color || '#FFFFFF';
  let petals = '';
  const n = 14;
  for(let i=0;i<n;i++){
    const a=(360/n)*i;
    petals += `<g transform="rotate(${a})"><ellipse cx="0" cy="-58" rx="11" ry="30" fill="${main}" stroke="#e7e2d4" stroke-width="0.8"/></g>`;
  }
  return wrap(size, `
    ${stemLeaves()}
    <g transform="translate(100 96)">${petals}<circle r="24" fill="#F2C14E"/><circle r="24" fill="none" stroke="#d9a83a" stroke-width="2"/>
      <g fill="#d9a83a">${Array.from({length:30}).map(()=>{const a=Math.random()*6.28,r=Math.random()*20;return `<circle cx="${(Math.cos(a)*r).toFixed(1)}" cy="${(Math.sin(a)*r).toFixed(1)}" r="1.3"/>`;}).join('')}</g></g>`);
}

export const FLOWERS = {
  carnation: { label: 'Carnation', fn: carnation, default: '#D2588A' },
  rose:      { label: 'Rose',      fn: rose,      default: '#C75C7A' },
  tulip:     { label: 'Tulip',     fn: tulip,     default: '#D8504F' },
  lily:      { label: 'Lily',      fn: lily,      default: '#E58BB0' },
  sunflower: { label: 'Sunflower', fn: sunflower, default: '#E6A92E' },
  lavender:  { label: 'Lavender',  fn: lavender,  default: '#8E7BC4' },
  daisy:     { label: 'Daisy',     fn: daisy,     default: '#FFFFFF' },
};

export function flowerSVG(name, { size = 120, color = null } = {}) {
  const f = FLOWERS[name] || FLOWERS.carnation;
  return f.fn(size, color || f.default);
}

/* a little herbarium label for each flower — shown on the botanical plate page */
export const FLOWER_LORE = {
  carnation: { binomial: 'Dianthus caryophyllus', meaning: 'fascination & deep love',  line: 'Pressed for the ones who are impossible not to admire.' },
  rose:      { binomial: 'Rosa',                   meaning: 'love & gratitude',          line: 'The oldest way to say: you matter to me.' },
  tulip:     { binomial: 'Tulipa',                 meaning: 'a fresh, perfect start',    line: 'For new beginnings, and the courage to chase them.' },
  lily:      { binomial: 'Lilium',                 meaning: 'devotion & renewed hope',   line: 'For a pure heart and the bright chapter ahead.' },
  sunflower: { binomial: 'Helianthus annuus',      meaning: 'adoration & loyalty',       line: 'Always turning toward the light — just like you.' },
  lavender:  { binomial: 'Lavandula',              meaning: 'grace, calm & devotion',    line: 'For a steady heart and a serene success.' },
  daisy:     { binomial: 'Bellis perennis',        meaning: 'innocence & new beginnings',line: 'Simple, bright, and full of hope.' },
};
