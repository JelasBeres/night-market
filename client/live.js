// Holder-town client kit: the link to the live server (bot/town-live.ts) and the engine API.
// Framework-free: the page keeps its own 3D scene and asks this module where everyone is.
//
//   import { createLive, createTown, connectWallet, levelOf } from "./live.js";
//   const live = createLive({ onJoin, onGone, onStatus, onEmote, onBubble, onChat, onSpeech, onSay, onAuth, onNote, getMe });
//   const town = createTown({ onTown });             // balances, ranks, rounds from /api/town (+ live pushes)
//   const addr = await connectWallet(); live.claim(addr);   // online right away, no signature
//   every frame: live.tick(dt); then read live.ents (id -> { a, rx, rz, ry, moving, on, v })
//
// Entities: every citizen is one, and the SERVER moves it while its wallet is offline (a bot).
// on = 1 while its wallet is connected; v = 1 for a visitor (connected but not a holder).

export const CHAIN = { hex: "0x1237", name: "Robinhood Chain", rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://explorer.mainnet.chain.robinhood.com" };
export const buyUrl = (ca) => `https://ponsfamily.com/launchpad/${ca}`;
/** A home grows one level per 10 minutes held: 1..8. */
export const levelOf = (firstIn, nowSec, lvlSec = 600) => (firstIn ? Math.min(8, 1 + Math.floor(Math.max(0, nowSec - firstIn) / lvlSec)) : 1);
export const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");

const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };
const utf8hex = (t) => "0x" + [...new TextEncoder().encode(t)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Asks the browser wallet for an account and switches it to Robinhood Chain. Returns the lowercase address. */
export async function connectWallet() {
  const eth = window.ethereum;
  if (!eth) throw new Error("Open this page in a wallet app (MetaMask, Rabby, Coinbase Wallet)");
  const [a] = await eth.request({ method: "eth_requestAccounts" });
  try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.hex }] }); }
  catch (e) { if (e && e.code === 4902) await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: CHAIN.hex, chainName: CHAIN.name, rpcUrls: [CHAIN.rpc], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [CHAIN.explorer] }] }); }
  return (a || "").toLowerCase();
}
/** A wallet this site was already allowed to see (no popup), or "". */
export async function knownWallet() {
  try { const a = await window.ethereum?.request({ method: "eth_accounts" }); return (a && a[0] ? a[0] : "").toLowerCase(); } catch (e) { return ""; }
}

export function createLive(o = {}) {
  const cb = (k, ...a) => { try { o[k] && o[k](...a); } catch (e) { console.error("live", k, e); } };
  const S = { open: false, auth: false, signed: false, addr: "", id: 0, want: "", off: 0, rtt: 1e9, pend: null, tries: 0, lastSent: "", sentT: 0, chatT: 0 };
  const ents = new Map(), byAddr = new Map();
  let ws = null;

  const send = (m) => { if (ws && S.open) ws.send(JSON.stringify(m)); };
  const sessKey = (a) => "holder-live-" + location.host + "-" + a;
  const put = (m) => {
    let e = ents.get(m.id);
    if (!e) { e = { id: m.id, a: m.a, x: m.x, z: m.z, y: m.y || 0, rx: m.x, rz: m.z, ry: m.y || 0, on: m.on, v: m.v, moving: false }; ents.set(m.id, e); byAddr.set(m.a, e); return [e, true]; }
    Object.assign(e, { a: m.a, x: m.x ?? e.x, z: m.z ?? e.z, y: m.y ?? e.y, on: m.on ?? e.on, v: m.v ?? e.v });
    return [e, false];
  };
  const drop = (id) => { const e = ents.get(id); if (!e) return null; ents.delete(id); if (byAddr.get(e.a) === e) byAddr.delete(e.a); return e; };

  function open() {
    if (ws) return;
    try { ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + (o.url || "/ws")); } catch (e) { return; }
    ws.onopen = () => { S.open = true; S.tries = 0; if (S.want) claim(S.want); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } m.rx = performance.timeOrigin + ev.timeStamp; on(m); };
    ws.onclose = () => {
      const was = S.auth; ws = null; S.open = false; S.auth = false; S.signed = false; S.id = 0;
      for (const id of [...ents.keys()]) { const e = drop(id); if (e) cb("onGone", e, "link"); }
      cb("onAuth", { ...S, lost: was });
      setTimeout(open, Math.min(30000, 1500 * 2 ** S.tries++));
    };
    ws.onerror = () => {};
  }
  function on(m) {
    if (m.t === "hi") {
      S.off = m.now - m.rx; S.rtt = 1e9;
      for (let i = 0; i < 4; i++) setTimeout(() => send({ t: "ping", c: Date.now() }), 300 + i * 900);
      for (const x of m.ents || []) { const [e] = put(x); cb("onJoin", e, false); }
      cb("onSlots", m.slots || {});
      if (m.speech) cb("onSpeech", true, m.speech.a, m.speech.lines);
      cb("onHello", m);
      return;
    }
    if (m.t === "pong") { const rtt = m.rx - m.c; if (rtt >= 0 && rtt < S.rtt) { S.rtt = rtt; S.off = m.now - (m.c + rtt / 2); } return; }
    if (m.t === "clock") { send({ t: "ping", c: Date.now() }); S.rtt *= 1.5; return; }
    if (m.t === "p") { for (const [id, x, z, y] of m.l) { const e = ents.get(id); if (e && id !== S.id) { e.x = x; e.z = z; e.y = y; } } return; }
    if (m.t === "join") { const [e, fresh] = put(m); if (fresh) cb("onJoin", e, !!m.arrive); return; }
    if (m.t === "gone") { const e = drop(m.id); if (e) cb("onGone", e, m.why); return; }
    if (m.t === "st") { const [e] = put(m); cb("onStatus", e); return; }
    if (m.t === "slots") { cb("onSlots", m.slots || {}); return; }
    if (m.t === "e") { const e = ents.get(m.id); if (e) cb("onEmote", e, m.k, m.to); return; }
    if (m.t === "bub") { const e = ents.get(m.id); if (e) cb("onBubble", e, m.text); return; }
    if (m.t === "chat") { const e = ents.get(m.id) || byAddr.get(m.a); if (e) cb("onChat", e, m.text); return; }
    if (m.t === "speech") { cb("onSpeech", !!m.on, m.a); return; }
    if (m.t === "say") { cb("onSay", m.a, m.text); return; }
    if (m.t === "note") { cb("onNote", m.text); return; }
    if (m.t === "needsign") { verify(); return; }
    if (m.t === "nonce") { sign(m.a, m.msg); return; }
    if (m.t === "bye") { S.want = ""; S.auth = false; S.signed = false; S.id = 0; cb("onNote", m.why); cb("onAuth", { ...S }); return; }
    if (m.t === "auth") {
      if (m.ok) {
        const first = !S.auth;
        if (m.token) lsSet(sessKey(m.a), m.token);
        Object.assign(S, { auth: true, signed: !!m.signed, addr: m.a, id: m.id, lastSent: "" });
        cb("onAuth", { ...S, first, x: m.x, z: m.z, citizen: m.citizen });
        if (m.signed) flush();
        return;
      }
      if (m.taken) { cb("onNote", m.error); return; }
      lsDel(sessKey(m.a)); if (m.error) cb("onNote", m.error);
      if (S.want === m.a && S.open) send({ t: "claim", a: m.a }); // a stale session: walk in without it
    }
  }
  /** Online right away: your citizen (or a visitor) is yours to walk. A saved signature is reused for chat. */
  function claim(addr) {
    S.want = (addr || "").toLowerCase(); if (!S.want || !S.open) return;
    const tok = lsGet(sessKey(S.want));
    send(tok ? { t: "resume", a: S.want, token: tok } : { t: "claim", a: S.want });
  }
  function logout() { send({ t: "logout" }); S.want = ""; S.auth = false; S.signed = false; S.id = 0; cb("onAuth", { ...S }); }
  function verify(then) { if (then) S.pend = then; if (S.signed) return flush(); if (S.addr) send({ t: "nonce", a: S.addr }); }
  async function sign(addr, msg) {
    const eth = window.ethereum; if (!eth || addr !== S.addr) return;
    cb("onNote", "Sign once so the town knows it is really you · free, moves no funds");
    try { const sig = await eth.request({ method: "personal_sign", params: [utf8hex(msg), addr] }); send({ t: "login", a: addr, sig }); }
    catch (e) { S.pend = null; cb("onNote", e && e.code === 4001 ? "Not signed · you can still walk, wave and punch · chat needs the signature" : "The wallet did not sign"); }
  }
  function flush() { const p = S.pend; S.pend = null; if (!p) return; if (p.chat) chat(p.chat); if (p.speech !== undefined) speech(p.speech); }
  /** Chat as yourself: the first time asks for one free signature, then the line goes out. Returns false if it is still waiting. */
  function chat(text) {
    text = String(text || "").trim().slice(0, 80); if (!text || !S.auth) return false;
    if (!S.signed) { verify({ chat: text }); return false; }
    const t = performance.now(); if (t - S.chatT < 1600) { cb("onNote", "Slow down a little"); return false; }
    S.chatT = t; send({ t: "chat", text }); return true;
  }
  function speech(onoff) { if (!S.signed && onoff) { verify({ speech: onoff }); return false; } send({ t: "speech", on: !!onoff }); return true; }
  const say = (text) => send({ t: "say", text: String(text || "").slice(0, 120) });
  const emote = (k, to) => send({ t: "e", k, to: to || undefined });
  /** Smooth everyone toward the server's positions; your own citizen is yours (send it with getMe). */
  function tick(dt) {
    const k = Math.min(1, dt * 8);
    for (const e of ents.values()) {
      if (e.id === S.id) continue;
      const dx = e.x - e.rx, dz = e.z - e.rz, d = Math.hypot(dx, dz);
      if (d > 16) { e.rx = e.x; e.rz = e.z; } else { e.rx += dx * k; e.rz += dz * k; }
      e.moving = d > 0.05;
      let dy = (e.moving && d > 0.25 ? Math.atan2(dx, dz) : e.y) - e.ry; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); e.ry += dy * Math.min(1, dt * 10);
    }
  }
  // your own walk goes out ~7 times a second while you move
  setInterval(() => {
    if (!S.auth || !o.getMe) return; const me = o.getMe(); if (!me) return;
    const x = +(+me.x).toFixed(2), z = +(+me.z).toFixed(2), y = +(+me.yaw || 0).toFixed(2), s = `${x},${z},${y}`, t = performance.now();
    if (s === S.lastSent && t - S.sentT < 2000) return; S.lastSent = s; S.sentT = t; send({ t: "p", x, z, y });
  }, 140);
  open();
  return { S, ents, byAddr, claim, logout, chat, speech, say, emote, tick, now: () => (Date.now() + S.off) / 1000, me: () => ents.get(S.id) || null, isOnline: (a) => !!(byAddr.get(a) && byAddr.get(a).on) };
}

/** The engine's view of the town: /api/town on load, every 15 s, and whenever the engine pushes. */
export function createTown(o = {}) {
  const T = { data: null, busy: false, again: false };
  async function refresh() {
    if (T.busy) { T.again = true; return; }
    T.busy = true;
    try { const j = await (await fetch("/api/town", { cache: "no-store" })).json(); if (j.success) { T.data = j.data; o.onTown && o.onTown(j.data); } }
    catch (e) { o.onError && o.onError(e); }
    finally { T.busy = false; if (T.again) { T.again = false; setTimeout(refresh, 300); } }
  }
  refresh(); setInterval(refresh, 15000);
  try { const es = new EventSource("/api/stream"); es.addEventListener("town", () => refresh()); } catch (e) {}
  return { T, refresh };
}
