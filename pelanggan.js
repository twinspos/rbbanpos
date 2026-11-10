/* RB POS - Pelanggan: modul bersama untuk kasir (index.html) dan Backoffice (backoffice.html).
 * Taruh di folder yang sama dengan kedua file itu, lalu panggil sebelum script utama:
 *   <script src="pelanggan.js"></script>
 * Tiap aplikasi memanggil PL.init({...}) sekali untuk menghubungkan data & dialognya.
 *
 * Data pelanggan: {id,name,wa,address,note,discPct,sp:{idProduk:harga},active,ts,upd}
 *  - discPct : diskon otomatis (%) untuk semua produk pelanggan ini
 *  - sp      : harga khusus per produk (didahulukan dari discPct)
 *  - groupId : id grup pelanggan (harga grup dipakai bila pelanggan tidak punya harga sendiri)
 * Grup: {id,name,discPct,sp,ts,upd}. Urutan harga: harga khusus pelanggan > diskon pelanggan > harga khusus grup > diskon grup > normal.
 */
(function () {
'use strict';
const PL = window.PL = {};
let cfg = null, root = '', ST = {q: '', f: 'all'}, F = null, DP = {id: '', p: 'all'}, PK = null;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const fq = q => String(parseFloat((+q || 0).toFixed(3)));
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const p2 = n => String(n).padStart(2, '0');
const fmtT = ts => { const d = new Date(ts); return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const $ = id => document.getElementById(id);
const val = id => ($(id) || {}).value || '';
const ini = n => { const w = String(n || '').trim().split(/\s+/).filter(Boolean); if (!w.length) return '?'; return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase(); };

/* ---------- nomor WhatsApp ---------- */
const digits = s => String(s || '').replace(/\D/g, '');
function normWA(n) { n = digits(n); if (n.startsWith('0')) n = '62' + n.slice(1); else if (n.startsWith('8')) n = '62' + n; return n; }
PL.normWA = normWA;
PL.validWA = n => { n = normWA(n); return n.length >= 10 && n.length <= 15; };

/* ---------- format sheet (harus sama dengan Code.gs: HEAD_CUST) ---------- */
PL.HEAD = ['Nama', 'WhatsApp', 'Alamat', 'Catatan', 'Diskon %', 'Harga Khusus', 'Aktif'];
PL.row = c => [c.name, c.wa || '', c.address || '', c.note || '', c.discPct || 0, Object.keys(c.sp || {}).length, c.active === false ? 'Tidak' : 'Ya'];

PL.GHEAD = ['Nama', 'Diskon %', 'Harga Khusus'];   // sheet GrupPelanggan (harus sama dengan HEAD_GRP di Code.gs)
PL.grow = g => [g.name, g.discPct || 0, Object.keys(g.sp || {}).length];

/* ---------- harga pelanggan: harga khusus pelanggan > diskon pelanggan > harga khusus grup > diskon grup > normal ---------- */
const groups = () => (cfg && cfg.data().groups) || [];
const grpOf = c => (c && c.groupId) ? (groups().find(x => x.id === c.groupId) || null) : null;
PL.priceFor = function (c, p) {
  if (!c || !p) return p ? p.price : 0;
  const pick = o => { const sp = o && o.sp && o.sp[p.id]; return (sp !== undefined && sp !== null && sp !== '' && !isNaN(+sp)) ? Math.max(0, +sp) : null; };
  const disc = o => { const d = +(o && o.discPct) || 0; return d > 0 ? Math.max(0, Math.round(p.price * (1 - Math.min(d, 100) / 100))) : null; };
  const g = grpOf(c);
  let v = pick(c); if (v === null) v = disc(c); if (v === null) v = pick(g); if (v === null) v = disc(g);
  return v === null ? p.price : v;
};

/* ---------- laporan per pelanggan ---------- */
function index(d) {
  const by = {}, byWa = {};
  d.customers.forEach(c => { by[c.id] = []; if (c.wa) byWa[normWA(c.wa)] = c.id; });
  d.tx.forEach(t => {
    let id = t.customerId && by[t.customerId] ? t.customerId : null;
    if (!id && t.customer && t.customer.wa) id = byWa[normWA(t.customer.wa)] || null;   // nota kasbon lama
    if (id) by[id].push(t);
  });
  return by;
}
PL.index = index;
function summ(l, a, b) {
  const r = l.filter(t => t.ts >= a && t.ts < b), items = {};
  r.forEach(t => (t.items || []).forEach(i => {
    const q = +(i.qty - (i.refQty || 0)).toFixed(3); if (q <= 0) return;
    const o = items[i.name] || (items[i.name] = {unit: i.unit, q: 0, rev: 0}); o.q += q; o.rev += q * i.price;
  }));
  const total = sum(r, t => (t.total || 0) - (t.refunded || 0));
  return {
    r, n: r.length, total, avg: r.length ? total / r.length : 0, items,
    kasbon: sum(r, t => sum((t.payments || []).filter(p => p.m === 'kasbon'), p => p.ap)),
    last: l.length ? l.reduce((m, t) => Math.max(m, t.ts), 0) : 0
  };
}
PL.summ = summ;

/* ---------- gaya (memakai variabel warna & kelas .btn/.badge milik aplikasi) ---------- */
function css() {
  if ($('pl_css')) return;
  const s = document.createElement('style'); s.id = 'pl_css';
  s.textContent = '.pl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}' +
    '.pl-tool{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}.pl-tool input{flex:1;min-width:160px}.pl-tool select{width:auto;min-width:130px}' +
    '.pl-row{display:flex;gap:12px;align-items:center;padding:12px 6px;border-bottom:1px solid var(--bd);cursor:pointer;border-radius:10px}.pl-row:hover{background:var(--soft)}' +
    '.pl-av{width:42px;height:42px;border-radius:14px;background:var(--soft);color:var(--pri);display:grid;place-items:center;font-weight:800;flex-shrink:0}' +
    '.pl-mn{flex:1;min-width:0}.pl-mn b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pl-mn small{display:block;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pl-vl{text-align:right;font-weight:700;flex-shrink:0}.pl-vl small{display:block;color:var(--mut);font-weight:500}' +
    '.pl-g2{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}@media(max-width:560px){.pl-g2{grid-template-columns:1fr}}' +
    '.pl-sp{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px dashed var(--bd)}.pl-sp>span{flex:1;min-width:0}.pl-sp input{width:120px}' +
    '.pl-add{display:flex;gap:8px;margin-top:10px}.pl-add select{flex:2;min-width:0}.pl-add input{flex:1;min-width:90px}' +
    '.pl-act{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}.pl-act .btn{flex:1;min-width:110px}' +
    '.pl-t{width:100%;border-collapse:collapse;font-size:14px}.pl-t th,.pl-t td{padding:9px 6px;border-bottom:1px solid var(--bd);text-align:left}.pl-t th{color:var(--mut);font-size:12px;text-transform:uppercase}.pl-t .r{text-align:right}.pl-t tr.cl{cursor:pointer}.pl-t tr.cl:hover td{background:var(--soft)}' +
    '.pl-err{color:var(--bad);font-size:13px;min-height:18px;margin-top:8px}.pl-empty{text-align:center;color:var(--mut);padding:26px 0}' +
    '.pl-chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 10px}.pl-h{font-weight:800;margin:16px 0 6px}.pl-hint{font-size:12.5px;color:var(--mut);margin:2px 0 8px}';
  document.head.appendChild(s);
}

PL.init = function (c) { cfg = c; css(); };
const find = id => cfg.data().customers.find(x => x.id === id);
const badges = c => (c.active === false ? '<span class="badge v">Nonaktif</span> ' : '') + (grpOf(c) ? '<span class="badge">Grup ' + esc(grpOf(c).name) + '</span> ' : '') +
  (+c.discPct > 0 ? '<span class="badge g">Diskon ' + fq(c.discPct) + '%</span> ' : '') +
  (Object.keys(c.sp || {}).length ? '<span class="badge k">Harga khusus ' + Object.keys(c.sp).length + '</span>' : '');
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* =================== DAFTAR PELANGGAN =================== */
PL.mount = function (id) {
  root = id || root; const el = $(root); if (!el || !cfg) return;
  const d = cfg.data(), by = index(d), rg = cfg.range ? cfg.range() : [0, Infinity];
  const all = d.customers.map(c => summ(by[c.id] || [], rg[0], rg[1]));
  el.innerHTML = '<div class="pl-kpis"><div class="kc"><small>Jumlah pelanggan</small><b>' + d.customers.length + '</b></div>' +
    '<div class="kc"><small>Belanja di periode ini</small><b>' + all.filter(s => s.n > 0).length + '</b></div>' +
    '<div class="kc"><small>Total belanja pelanggan</small><b>' + rp(sum(all, s => s.total)) + '</b></div></div>' +
    (cfg.periodLabel ? '<div class="mut" style="font-size:13px;margin-bottom:8px">Periode: ' + esc(cfg.periodLabel()) + '</div>' : '') +
    '<div class="pl-tool"><input id="pl_q" placeholder="Cari nama, no. WA, alamat…" value="' + esc(ST.q) + '" oninput="PL.setQ(this.value)" autocomplete="off">' +
    '<select onchange="PL.setF(this.value)">' + [['all', 'Semua'], ['on', 'Aktif'], ['off', 'Nonaktif'], ['sp', 'Punya harga khusus']].concat(groups().map(g => ['g:' + g.id, 'Grup ' + g.name])).map(x => '<option value="' + x[0] + '"' + (ST.f === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select>' +
    '<button class="btn" onclick="PL.groups()">Grup</button><button class="btn" onclick="PL.exp()">CSV</button><button class="btn pri" onclick="PL.edit()">+ Pelanggan</button></div><div id="pl_list"></div>';
  rows();
};
PL.setQ = v => { ST.q = v; rows(); };
PL.setF = v => { ST.f = v; rows(); };
function filtered() {
  const d = cfg.data(), by = index(d), rg = cfg.range ? cfg.range() : [0, Infinity], q = ST.q.trim().toLowerCase();
  return d.customers.map(c => ({c, s: summ(by[c.id] || [], rg[0], rg[1])})).filter(x =>
    (ST.f === 'all' || (ST.f === 'on' && x.c.active !== false) || (ST.f === 'off' && x.c.active === false) || (ST.f === 'sp' && (+x.c.discPct > 0 || Object.keys(x.c.sp || {}).length)) || (ST.f.startsWith('g:') && x.c.groupId === ST.f.slice(2))) &&
    (!q || (x.c.name + ' ' + (x.c.wa || '') + ' ' + (x.c.address || '')).toLowerCase().includes(q))
  ).sort((x, y) => y.s.total - x.s.total || String(x.c.name).localeCompare(String(y.c.name)));
}
function rows() {
  const el = $('pl_list'); if (!el) return;
  const l = filtered();
  el.innerHTML = l.length ? l.slice(0, 200).map(x => '<div class="pl-row" onclick="PL.open(\'' + x.c.id + '\')"><div class="pl-av">' + esc(ini(x.c.name)) + '</div>' +
    '<div class="pl-mn"><b>' + esc(x.c.name) + '</b><small>' + esc(x.c.wa || 'tanpa no. WA') + (x.c.address ? ' · ' + esc(x.c.address) : '') + '</small><div style="margin-top:3px">' + badges(x.c) + '</div></div>' +
    '<div class="pl-vl">' + rp(x.s.total) + '<small>' + x.s.n + ' nota</small></div></div>').join('') + (l.length > 200 ? '<div class="pl-empty">Menampilkan 200 teratas. Persempit pencarian.</div>' : '')
    : '<div class="pl-empty">' + (cfg.data().customers.length ? 'Tidak ada pelanggan yang cocok' : 'Belum ada pelanggan. Tekan “+ Pelanggan”.') + '</div>';
}
PL.exp = function () {
  const l = filtered();
  cfg.export('Pelanggan', [['Nama', 'WhatsApp', 'Alamat', 'Catatan', 'Grup', 'Diskon %', 'Jumlah Harga Khusus', 'Jumlah Nota', 'Total Belanja', 'Terakhir Belanja', 'Status'],
    ...l.map(x => [x.c.name, x.c.wa || '', x.c.address || '', x.c.note || '', grpOf(x.c) ? grpOf(x.c).name : '', x.c.discPct || 0, Object.keys(x.c.sp || {}).length, x.s.n, Math.round(x.s.total), x.s.last ? fmtT(x.s.last) : '', x.c.active === false ? 'Nonaktif' : 'Aktif'])]);
};

/* =================== DETAIL & LAPORAN PELANGGAN =================== */
function dRange() {
  const n = new Date(), d0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return DP.p === '30d' ? [d0 - 29 * 864e5, d0 + 864e5] : DP.p === 'month' ? [new Date(n.getFullYear(), n.getMonth(), 1).getTime(), d0 + 864e5] : [0, Infinity];
}
PL.open = function (id, p) {
  DP.id = id; if (p) DP.p = p;
  const d = cfg.data(), c = find(id);
  if (!c) { cfg.back(); return; }
  const mine = index(d)[c.id] || [], rg = dRange(), s = summ(mine, rg[0], rg[1]);
  const prod = Object.entries(s.items).sort((x, y) => y[1].rev - x[1].rev);
  const spl = Object.entries(c.sp || {}).map(([pid, pr]) => { const pp = d.products.find(x => x.id === pid); return pp ? [pp, pr] : null; }).filter(Boolean);
  const per = [['all', 'Semua'], ['30d', '30 hari'], ['month', 'Bulan ini']];
  cfg.openDlg('<h3 style="margin:0">' + esc(c.name) + '</h3><div style="margin:4px 0 6px">' + badges(c) + '</div>' +
    '<div class="mut" style="font-size:13.5px;line-height:1.5">' + esc(c.wa || 'Belum ada no. WA') + (c.address ? '<br>' + esc(c.address) : '') + (c.note ? '<br><i>' + esc(c.note) + '</i>' : '') + '</div>' +
    '<div class="pl-chips">' + per.map(x => '<button class="btn sm ' + (DP.p === x[0] ? 'on' : '') + '" onclick="PL.open(\'' + id + '\',\'' + x[0] + '\')">' + x[1] + '</button>').join('') + '</div>' +
    '<div class="pl-kpis"><div class="kc"><small>Total belanja</small><b>' + rp(s.total) + '</b></div><div class="kc"><small>Jumlah nota</small><b>' + s.n + '</b></div>' +
    '<div class="kc"><small>Rata-rata per nota</small><b>' + rp(s.avg) + '</b></div><div class="kc"><small>Terakhir belanja</small><b style="font-size:15px">' + (s.last ? fmtT(s.last) : '—') + '</b></div>' +
    (s.kasbon ? '<div class="kc"><small>Kasbon tercatat</small><b style="color:var(--warn)">' + rp(s.kasbon) + '</b></div>' : '') + '</div>' +
    ((spl.length || +c.discPct > 0 || grpOf(c)) ? '<div class="pl-h">Harga spesial</div>' + (grpOf(c) ? '<div class="pl-hint">Grup <b>' + esc(grpOf(c).name) + '</b>: ' + (+grpOf(c).discPct > 0 ? 'diskon ' + fq(grpOf(c).discPct) + '%' : 'tanpa diskon %') + ', ' + Object.keys(grpOf(c).sp || {}).length + ' harga khusus. Dipakai untuk produk yang tidak punya harga sendiri di bawah.</div>' : '') + (+c.discPct > 0 ? '<div class="pl-hint">Diskon otomatis ' + fq(c.discPct) + '% untuk semua produk (kecuali yang punya harga khusus di bawah).</div>' : '') +
      (spl.length ? '<table class="pl-t"><tr><th>Produk</th><th class="r">Normal</th><th class="r">Pelanggan ini</th></tr>' + spl.map(x => '<tr><td>' + esc(x[0].name) + '</td><td class="r">' + rp(x[0].price) + '</td><td class="r"><b>' + rp(x[1]) + '</b></td></tr>').join('') + '</table>' : '') : '') +
    '<div class="pl-h">Produk yang dibeli</div>' + (prod.length ? '<div style="overflow-x:auto"><table class="pl-t"><tr><th>Produk</th><th class="r">Jumlah</th><th class="r">Nilai</th></tr>' + prod.map(x => '<tr><td>' + esc(x[0]) + '</td><td class="r">' + fq(x[1].q) + ' ' + esc(x[1].unit) + '</td><td class="r">' + rp(x[1].rev) + '</td></tr>').join('') + '</table></div>' : '<div class="pl-empty">Belum ada pembelian pada periode ini</div>') +
    '<div class="pl-h">Riwayat nota</div>' + (s.r.length ? '<div style="overflow-x:auto"><table class="pl-t"><tr><th>Nota</th><th>Waktu</th><th class="r">Total</th></tr>' + [...s.r].sort((x, y) => y.ts - x.ts).slice(0, 40).map(t =>
      '<tr class="' + (cfg.openTx ? 'cl' : '') + '"' + (cfg.openTx ? ' onclick="PL.tx(\'' + t.id + '\')"' : '') + '><td><b>' + esc(t.no) + '</b>' + (t.status && t.status !== 'ok' ? ' <span class="badge k">refund</span>' : '') + '</td><td>' + fmtT(t.ts) + '</td><td class="r">' + rp(t.total) + '</td></tr>').join('') + '</table></div>' : '<div class="pl-empty">Belum ada nota</div>') +
    '<div class="pl-act"><button class="btn" onclick="PL.wa(\'' + id + '\')">WhatsApp</button><button class="btn" onclick="PL.expP()">CSV Produk</button><button class="btn" onclick="PL.edit(\'' + id + '\')">Ubah</button><button class="btn pri" onclick="PL.close()">Tutup</button></div>', true);
};
PL.close = () => cfg.back();
PL.tx = id => { if (cfg.openTx) cfg.openTx(id); };
PL.wa = function (id) {
  const c = find(id); if (!c) return;
  if (!c.wa) { alert('Pelanggan ini belum punya nomor WhatsApp. Tekan Ubah untuk mengisinya.'); return; }
  window.open('https://wa.me/' + normWA(c.wa), '_blank');
};
PL.expP = function () {
  const c = find(DP.id); if (!c) return;
  const rg = dRange(), s = summ(index(cfg.data())[c.id] || [], rg[0], rg[1]);
  cfg.export('Produk-' + String(c.name).replace(/[^\w]+/g, '-'), [['Produk', 'Satuan', 'Jumlah', 'Nilai'], ...Object.entries(s.items).sort((x, y) => y[1].rev - x[1].rev).map(x => [x[0], x[1].unit, +x[1].q.toFixed(3), Math.round(x[1].rev)])]);
};

/* =================== FORM TAMBAH / UBAH =================== */
function spHTML() {
  const d = cfg.data(), used = F.sp;
  const list = Object.keys(used).map(pid => {
    const p = d.products.find(x => x.id === pid);
    return '<div class="pl-sp"><span><b>' + esc(p ? p.name : '(produk dihapus)') + '</b><br><small class="mut">normal ' + rp(p ? p.price : 0) + '</small></span>' +
      '<input type="number" inputmode="decimal" min="0" value="' + esc(used[pid]) + '" onchange="PL.spSet(\'' + pid + '\',this.value)"><button class="btn sm" onclick="PL.spDel(\'' + pid + '\')">✕</button></div>';
  }).join('');
  const opts = d.products.filter(p => !(p.id in used)).sort((a, b) => String(a.name).localeCompare(String(b.name))).map(p => '<option value="' + p.id + '">' + esc(p.name) + ' — ' + rp(p.price) + '</option>').join('');
  return list + (opts ? '<div class="pl-add"><select id="pl_sp_p">' + opts + '</select><input id="pl_sp_v" type="number" inputmode="decimal" min="0" placeholder="Harga"><button class="btn" onclick="PL.spAdd()">Tambah</button></div>' : '');
}
function spRender() { const e = $('pl_spw'); if (e) e.innerHTML = spHTML(); }
PL.spAdd = function () {
  const pid = val('pl_sp_p'), v = val('pl_sp_v');
  if (!pid || v === '' || isNaN(+v) || +v < 0) { err('Pilih produk dan isi harga khusus (angka)'); return; }
  err(''); F.sp[pid] = Math.round(+v); spRender();
};
PL.spSet = (pid, v) => { F.sp[pid] = isNaN(+v) || v === '' ? 0 : Math.round(+v); };
PL.spDel = pid => { delete F.sp[pid]; spRender(); };
function err(m) { const e = $('pl_err'); if (e) e.textContent = m || ''; }

PL.edit = function (id, opts) {
  opts = opts || {};
  const c = (id && find(id)) || {active: true, sp: {}, discPct: 0};
  F = {id: id || '', sp: Object.assign({}, c.sp || {}), opts, old: c};
  F.canP = !opts.quick && (!cfg.canPrice || cfg.canPrice());
  if (!opts.back) opts.back = id ? () => PL.open(id) : () => cfg.back();
  cfg.openDlg('<h3>' + (id ? 'Ubah' : 'Tambah') + ' Pelanggan</h3>' +
    '<label>Nama *</label><input id="pl_n" value="' + esc(c.name) + '" autocomplete="off">' +
    '<label>No. WhatsApp</label><input id="pl_w" type="tel" inputmode="tel" value="' + esc(c.wa) + '" placeholder="08xxxxxxxxxx" autocomplete="off">' +
    '<div class="pl-hint">Dipakai untuk mengirim struk lewat WhatsApp.</div>' +
    '<label>Alamat</label><input id="pl_a" value="' + esc(c.address) + '" placeholder="mis. Jl. Raya Karawang No. 10" autocomplete="off">' +
    (opts.quick ? '' : '<label>Catatan (opsional)</label><input id="pl_c" value="' + esc(c.note) + '" placeholder="mis. Honda Vario B 1234 XYZ, ukuran ban 90/90-14" autocomplete="off"><label>Status</label><select id="pl_s"><option value="1"' + (c.active !== false ? ' selected' : '') + '>Aktif</option><option value="0"' + (c.active === false ? ' selected' : '') + '>Nonaktif</option></select>') +
    (opts.quick ? '' : F.canP ? '<div class="pl-h">Harga spesial</div><div class="pl-hint">Urutan: harga khusus pelanggan, diskon pelanggan, lalu harga grup. Kosongkan yang tidak dipakai.</div>' +
      '<label>Grup pelanggan</label><select id="pl_g"><option value="">Tanpa grup</option>' + groups().map(g => '<option value="' + g.id + '"' + (c.groupId === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('') + '</select>' +
      '<label>Diskon otomatis pelanggan ini (%)</label><input id="pl_d" type="number" inputmode="decimal" step="any" min="0" max="100" value="' + esc(c.discPct || '') + '" placeholder="0">' +
      '<label>Harga khusus per produk</label><div id="pl_spw">' + spHTML() + '</div>'
      : '<div class="pl-hint" style="margin-top:12px">Harga spesial hanya bisa diubah oleh Supervisor / Owner.</div>') +
    '<div class="pl-err" id="pl_err"></div>' +
    '<div class="pl-act"><button class="btn" onclick="PL.cancel()">Batal</button>' + (id && !opts.quick ? '<button class="btn" style="color:var(--bad)" onclick="PL.del(\'' + id + '\')">Hapus</button>' : '') + '<button class="btn pri" id="pl_sv" onclick="PL.save()">Simpan</button></div>');
  setTimeout(() => { const e = $('pl_n'); if (e && !id) e.focus(); }, 60);
};
PL.cancel = () => F.opts.back();
PL.save = async function () {
  const d = cfg.data(), o = F.old, name = val('pl_n').trim(), wa = val('pl_w').trim();
  if (!name) { err('Isi nama pelanggan'); return; }
  if (wa && !PL.validWA(wa)) { err('Nomor WhatsApp tidak valid (contoh: 081234567890)'); return; }
  if (wa) {
    const dup = d.customers.find(x => x.id !== F.id && x.wa && normWA(x.wa) === normWA(wa));
    if (dup) { err('Nomor ini sudah terdaftar atas nama “' + dup.name + '”.'); return; }
  }
  const c = {
    id: F.id || uid(), name, wa: digits(wa), address: val('pl_a').trim(), note: F.opts.quick ? (o.note || '') : val('pl_c').trim(),
    active: F.opts.quick ? o.active !== false : val('pl_s') !== '0',
    groupId: F.canP ? val('pl_g') : (o.groupId || ''),
    discPct: F.canP ? Math.min(100, Math.max(0, +val('pl_d') || 0)) : (o.discPct || 0),
    sp: F.canP ? Object.fromEntries(Object.entries(F.sp).filter(x => !isNaN(+x[1]) && +x[1] >= 0)) : (o.sp || {}),
    ts: o.ts || Date.now(), upd: Date.now()
  };
  const b = $('pl_sv'); if (b) b.disabled = true;
  try { await cfg.save(c); } catch (e) { err('Gagal menyimpan: ' + (e && e.message || e)); if (b) b.disabled = false; return; }
  if (F.opts.onSaved) F.opts.onSaved(c); else if (F.id) PL.open(c.id); else cfg.back();
};
PL.del = function (id) {
  const c = find(id); if (!c) return;
  if (!confirm('Hapus pelanggan “' + c.name + '”? Riwayat nota tetap tersimpan, tetapi tidak lagi terhubung ke pelanggan ini. (Untuk menyembunyikan saja, ubah status jadi Nonaktif.)')) return;
  const go = async () => { try { await cfg.del(id); } catch (e) { alert('Gagal menghapus: ' + (e && e.message || e)); } cfg.back(); };
  cfg.guardDel ? cfg.guardDel(go, () => PL.edit(id)) : go();
};

/* =================== GRUP PELANGGAN =================== */
PL.groups = function () {
  const d = cfg.data(), gs = groups().slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const canP = !cfg.canPrice || cfg.canPrice();
  cfg.openDlg('<h3>Grup Pelanggan</h3><div class="pl-hint">Atur diskon dan harga khusus sekali untuk satu grup (mis. Bengkel Langganan, Reseller Ban). Pelanggan di grup itu otomatis memakai harga grup, kecuali punya harga sendiri.</div>' +
    (gs.length ? gs.map(g => {
      const n = d.customers.filter(c => c.groupId === g.id).length;
      return '<div class="pl-row"' + (canP ? ' onclick="PL.gEdit(\'' + g.id + '\')"' : '') + '><div class="pl-av">' + esc(ini(g.name)) + '</div><div class="pl-mn"><b>' + esc(g.name) + '</b><small>' + n + ' pelanggan · ' + Object.keys(g.sp || {}).length + ' harga khusus</small></div><div class="pl-vl">' + (+g.discPct > 0 ? fq(g.discPct) + '%' : '—') + '<small>diskon</small></div></div>';
    }).join('') : '<div class="pl-empty">Belum ada grup.</div>') +
    (canP ? '' : '<div class="pl-hint" style="margin-top:10px">Grup hanya bisa diubah oleh Supervisor / Owner.</div>') +
    '<div class="pl-act"><button class="btn" onclick="PL.close()">Tutup</button>' + (canP ? '<button class="btn pri" onclick="PL.gEdit()">+ Grup</button>' : '') + '</div>');
};
PL.gEdit = function (id) {
  const g = (id && groups().find(x => x.id === id)) || {sp: {}, discPct: 0};
  F = {id: id || '', sp: Object.assign({}, g.sp || {}), old: g, canP: true, group: true, opts: {back: () => PL.groups()}};
  cfg.openDlg('<h3>' + (id ? 'Ubah' : 'Tambah') + ' Grup</h3><label>Nama grup *</label><input id="pl_gn" value="' + esc(g.name) + '" placeholder="mis. Bengkel Langganan" autocomplete="off">' +
    '<label>Diskon otomatis (%)</label><input id="pl_d" type="number" inputmode="decimal" step="any" min="0" max="100" value="' + esc(g.discPct || '') + '" placeholder="0">' +
    '<label>Harga khusus per produk</label><div id="pl_spw">' + spHTML() + '</div><div class="pl-err" id="pl_err"></div>' +
    '<div class="pl-act"><button class="btn" onclick="PL.groups()">Batal</button>' + (id ? '<button class="btn" style="color:var(--bad)" onclick="PL.gDel(\'' + id + '\')">Hapus</button>' : '') + '<button class="btn pri" id="pl_sv" onclick="PL.gSave()">Simpan</button></div>');
  setTimeout(() => { const e = $('pl_gn'); if (e && !id) e.focus(); }, 60);
};
PL.gSave = async function () {
  const name = val('pl_gn').trim(), o = F.old;
  if (!name) { err('Isi nama grup'); return; }
  if (groups().some(x => x.id !== F.id && String(x.name).toLowerCase() === name.toLowerCase())) { err('Nama grup sudah dipakai'); return; }
  const g = {id: F.id || 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name,
    discPct: Math.min(100, Math.max(0, +val('pl_d') || 0)),
    sp: Object.fromEntries(Object.entries(F.sp).filter(x => !isNaN(+x[1]) && +x[1] >= 0)), ts: o.ts || Date.now(), upd: Date.now()};
  const b = $('pl_sv'); if (b) b.disabled = true;
  try { await cfg.saveGroup(g); } catch (e) { err('Gagal menyimpan: ' + (e && e.message || e)); if (b) b.disabled = false; return; }
  PL.groups();
};
PL.gDel = async function (id) {
  const g = groups().find(x => x.id === id); if (!g) return;
  const n = cfg.data().customers.filter(c => c.groupId === id).length;
  if (!confirm('Hapus grup “' + g.name + '”?' + (n ? '\n' + n + ' pelanggan di grup ini akan kembali ke harga normal (kecuali punya harga sendiri).' : ''))) return;
  try { await cfg.delGroup(id); } catch (e) { alert('Gagal menghapus: ' + (e && e.message || e)); }
  PL.groups();
};

/* =================== PEMILIH PELANGGAN (dipakai kasir) =================== */
PL.openPicker = function (o) {
  PK = o;
  cfg.openDlg('<h3>' + esc(o.title || 'Pilih Pelanggan') + '</h3><input id="pl_pq" placeholder="Cari nama / no. WA…" oninput="PL.pq(this.value)" autocomplete="off"><div id="pl_pl" style="margin-top:8px;max-height:46vh;overflow:auto"></div>' +
    '<div class="pl-act"><button class="btn" onclick="PK_cancel()">Batal</button>' + (o.allowClear ? '<button class="btn" onclick="PL.pick(\'\')">Tanpa pelanggan</button>' : '') + '<button class="btn pri" onclick="PL.pnew()">+ Pelanggan Baru</button></div>');
  PL.pq('');
  setTimeout(() => { const e = $('pl_pq'); if (e) e.focus(); }, 60);
};
window.PK_cancel = () => { if (PK && PK.onCancel) PK.onCancel(); };
PL.pq = function (q) {
  const el = $('pl_pl'); if (!el) return;
  q = String(q || '').trim().toLowerCase();
  const l = cfg.data().customers.filter(c => c.active !== false && (!q || (c.name + ' ' + (c.wa || '') + ' ' + (c.address || '')).toLowerCase().includes(q)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name))).slice(0, 40);
  el.innerHTML = l.length ? l.map(c => '<div class="pl-row" onclick="PL.pick(\'' + c.id + '\')"><div class="pl-av">' + esc(ini(c.name)) + '</div><div class="pl-mn"><b>' + esc(c.name) + '</b><small>' + esc(c.wa || 'tanpa no. WA') + (c.address ? ' · ' + esc(c.address) : '') + '</small><div style="margin-top:3px">' + badges(c) + '</div></div></div>').join('')
    : '<div class="pl-empty">' + (q ? 'Tidak ditemukan. Tekan “+ Pelanggan Baru”.' : 'Belum ada pelanggan.') + '</div>';
};
PL.pick = id => { if (PK && PK.onPick) PK.onPick(id); };
PL.pnew = function () {
  const o = PK;
  PL.edit('', {quick: true, back: () => PL.openPicker(o), onSaved: c => o.onPick(c.id)});
};
})();
