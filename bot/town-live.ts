/**
 * Holder-town live server: ONE shared world for every screen.
 *
 * A separate process from the engine (town-engine.ts): it never touches keys or funds. It reads who
 * lives in town (balance, rank, first buy) from the engine's /api/town and runs the town itself:
 *  - every citizen is an entity with a position the SERVER owns. A citizen who is not connected is
 *    an "offline" bot that the server walks around the town's path graph (bot/world.json), greets
 *    and pokes the others, and reacts when a player punches or hugs it;
 *  - a connected wallet takes over its own citizen right away (no signature) and sends its walk;
 *    a wallet that is not a citizen walks in as a visitor;
 *  - chat and speeches speak in a wallet's name, so they need one free signature, once;
 *  - every house gets a fixed plot number (in move-in order), the same on every screen;
 *  - the server clock, so effects line up.
 * If this process stops, the page keeps working on its own (each screen walks its own citizens).
 */
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { ethers } from "ethers";

try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch {}

const PORT = parseInt(process.env.LIVE_PORT || "5296", 10);
const ENGINE = process.env.ENGINE_URL || `http://127.0.0.1:${process.env.PORT || 5293}`;
const TOWN = process.env.TOWN_NAME || "Holder Town";
const TICKER = process.env.TICKER || "$TOKEN";
const MIN_BAL = Number(process.env.MIN_BALANCE || 100000);
const SESS_FILE = path.resolve(process.cwd(), "bot-live-sessions.json");
const SLOT_FILE = path.resolve(process.cwd(), "bot-live-slots.json");
const WORLD_FILE = path.resolve(process.cwd(), process.env.WORLD_FILE || "bot/world.json");

const MAX_SOCKETS = 600;
const MAX_PER_IP = 6;
const SESSION_DAYS = 14;
const SIM_MS = 100; // bots think 10 times a second
const NET_MS = 150; // positions go out ~7 times a second
const MAX_SPEED = 12; // players walk at ~5.4 u/s; room for lag bursts, plus a big jump now and then
const JUMP_EVERY = 4;
const EMOTES = new Set(["wave", "bow", "dance", "sit", "flip", "punch", "hug", "hi5", "rankemote", "jump", "spin"]);
const BAD = /(fuck|shit|bitch|cunt|nigg|fag|rape|anjing|bangsat|kontol|memek|babi|goblok|tolol|ngentot|scam|\brug\b|https?:|www\.|\.com|t\.me|0x[0-9a-f]{8})/i;
const BOT_LINES = {
  greet: ["gm", "hey neighbour", "nice place", "gm gm", "holding strong", "see you at the next round", "love this town"],
  hit: ["hey!", "ouch", "rude!", "what was that for?", "you asked for it", "I'm telling the boss"],
  hug: ["aww", "group hug!", "welcome!", "ok ok"],
};

const lc = (a: string) => a.toLowerCase();
const now = () => Date.now();
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
const h32 = (s: string) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};
const pick = <T>(a: T[]) => a[(Math.random() * a.length) | 0];
const r2 = (v: number) => Math.round(v * 100) / 100;

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}
function writeJson(file: string, data: unknown) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data), "utf-8");
  fs.renameSync(tmp, file);
}

/* ───────── the world: the path graph the bots walk, the plots, the square ───────── */

type XZ = [number, number];
interface World {
  /** Walkable points and the straight walks between them (no wall in between). */
  nodes: XZ[];
  edges: [number, number][];
  /** Door of plot number k (k = move-in order). */
  plots: XZ[];
  /** Doors of the top 10's special homes, by rank ("1".."10"); a rank without one uses its plot. */
  ranks?: Record<string, XZ>;
  /** Where newcomers appear (the gate, the landing pad, the beach). */
  spawn: XZ;
  /** Where speeches happen: the podium, and the crowd area in front of it. */
  podium?: XZ;
  crowd?: { x: number; z: number; w: number; d: number };
  bounds: { x0: number; x1: number; z0: number; z1: number };
}
const world: World = readJson<World>(WORLD_FILE, { nodes: [[0, 0]], edges: [], plots: [], spawn: [0, 0], bounds: { x0: -300, x1: 300, z0: -300, z1: 300 } });
const adj: { to: number; w: number }[][] = world.nodes.map(() => []);
for (const [a, b] of world.edges) {
  const w = Math.hypot(world.nodes[a][0] - world.nodes[b][0], world.nodes[a][1] - world.nodes[b][1]);
  adj[a].push({ to: b, w });
  adj[b].push({ to: a, w });
}
log(`world: ${world.nodes.length} path points, ${world.edges.length} walks, ${world.plots.length} plots`);

function nearest(x: number, z: number) {
  let best = 0, bd = 1e18;
  for (let i = 0; i < world.nodes.length; i++) {
    const d = (world.nodes[i][0] - x) ** 2 + (world.nodes[i][1] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
/** Shortest walk on the graph, as points, ending at the exact target. */
function route(fx: number, fz: number, tx: number, tz: number): XZ[] {
  const s = nearest(fx, fz), t = nearest(tx, tz);
  if (s === t || !world.edges.length) return [[tx, tz]];
  const n = world.nodes.length, dist = new Float64Array(n).fill(1e18), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  dist[s] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < 1e18 && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === t) break;
    done[u] = 1;
    for (const e of adj[u]) if (dist[u] + e.w < dist[e.to]) { dist[e.to] = dist[u] + e.w; prev[e.to] = u; }
  }
  if (prev[t] < 0) return [[tx, tz]];
  const out: XZ[] = [[tx, tz]];
  for (let k = t; k >= 0 && k !== s; k = prev[k]) out.unshift(world.nodes[k]);
  out.unshift(world.nodes[s]);
  return out;
}

/* ───────── who lives in town, from the engine ───────── */

interface Cit { addr: string; rank: number; firstIn: number; balance: number }
let town = new Map<string, Cit>();
let token = "";
let townOk = false;
let firstRead = true;

async function readTown() {
  try {
    const r = await fetch(`${ENGINE}/api/town`, { signal: AbortSignal.timeout(8000) });
    const j: any = await r.json();
    if (!j.success) throw new Error("engine said no");
    const next = new Map<string, Cit>();
    for (const c of j.data.citizens) next.set(lc(c.addr), { addr: lc(c.addr), rank: c.rank || 0, firstIn: c.firstIn || 0, balance: parseFloat(c.balance) || 0 });
    const tok = lc(j.data.status.tokenAddress || "");
    if (tok !== token) {
      if (token) resetSlots();
      token = tok;
    }
    const sold = new Set<string>((j.data.sold || []).map((s: any) => lc(s.addr)));
    town = next;
    townOk = true;
    syncSlots();
    syncEntities(sold);
    checkSpeaker();
  } catch (e: any) {
    if (townOk) log(`engine read failed: ${e.message}`);
    townOk = false;
  }
}
const rankOf = (a: string) => town.get(a)?.rank || 0;

/* ───────── plots: a fixed number per house, the same on every screen ───────── */

interface Slots { token: string; of: Record<string, number>; freed: Record<string, number> }
let slots: Slots = readJson<Slots>(SLOT_FILE, { token: "", of: {}, freed: {} });
let slotsVer = 0;
function resetSlots() {
  slots = { token, of: {}, freed: {} };
  writeJson(SLOT_FILE, slots);
  slotsVer++;
}
/** New citizens take the lowest free number, oldest first. A house that left keeps its number 20 s (the sell moment). */
function syncSlots() {
  if (slots.token !== token) { slots = { token, of: {}, freed: {} }; slotsVer++; }
  let changed = false;
  const t = now();
  for (const a of Object.keys(slots.of)) {
    if (town.has(a)) { delete slots.freed[a]; continue; }
    if (!slots.freed[a]) { slots.freed[a] = t; changed = true; }
    else if (t - slots.freed[a] > 20_000) { delete slots.of[a]; delete slots.freed[a]; changed = true; }
  }
  const taken = new Set(Object.values(slots.of));
  const fresh = [...town.values()].filter((c) => slots.of[c.addr] === undefined).sort((a, b) => a.firstIn - b.firstIn || (a.addr < b.addr ? -1 : 1));
  let k = 0;
  for (const c of fresh) {
    while (taken.has(k)) k++;
    slots.of[c.addr] = k;
    taken.add(k);
    changed = true;
  }
  if (changed) { writeJson(SLOT_FILE, slots); slotsVer++; }
}
const slotMap = () => Object.fromEntries(Object.entries(slots.of).filter(([a]) => town.has(a)));
/** Where a citizen lives: the rank home for the top 10 if the world has one, else its plot door. */
function homeOf(a: string): XZ {
  const r = rankOf(a);
  if (r && world.ranks && world.ranks[String(r)]) return world.ranks[String(r)];
  const k = slots.of[a];
  if (k !== undefined && world.plots[k]) return world.plots[k];
  return world.spawn;
}

/* ───────── entities: every citizen (bot or player) and every online visitor ───────── */

interface Ent {
  id: number;
  addr: string;
  x: number;
  z: number;
  yaw: number;
  /** A connected wallet drives it; otherwise the server does. */
  online: P | null;
  visitor: boolean;
  path: XZ[];
  wait: number;
  speed: number;
  mode: "walk" | "idle" | "arrive" | "crowd" | "flee";
  busyT: number;
  dirty: boolean;
  last: string;
  greetT: number;
}
const ents = new Map<string, Ent>();
let nextEnt = 1;
const entMsg = (e: Ent) => ({ id: e.id, a: e.addr, x: r2(e.x), z: r2(e.z), y: r2(e.yaw), on: e.online ? 1 : 0, v: e.visitor ? 1 : 0 });

function addEnt(addr: string, x: number, z: number, visitor = false, mode: Ent["mode"] = "idle") {
  const e: Ent = { id: nextEnt++, addr, x, z, yaw: 0, online: null, visitor, path: [], wait: 1 + Math.random() * 4, speed: 2.4 + (h32(addr) % 120) / 100, mode, busyT: 0, dirty: true, last: "", greetT: 0 };
  ents.set(addr, e);
  return e;
}
function dropEnt(e: Ent, why: string) {
  ents.delete(e.addr);
  all({ t: "gone", id: e.id, a: e.addr, why });
}
/** Keep one entity per citizen: newcomers walk in from the spawn, sellers leave. */
function syncEntities(sold: Set<string>) {
  for (const c of town.values()) {
    const e = ents.get(c.addr);
    if (e) {
      if (e.visitor) { e.visitor = false; all({ t: "st", id: e.id, a: e.addr, on: e.online ? 1 : 0, v: 0 }); }
      continue;
    }
    const home = homeOf(c.addr);
    if (firstRead) { // the town as it stands: everyone starts near home
      const n = addEnt(c.addr, home[0] + (Math.random() - 0.5) * 2, home[1] + (Math.random() - 0.5) * 2);
      all({ t: "join", ...entMsg(n) });
      continue;
    }
    const n = addEnt(c.addr, world.spawn[0], world.spawn[1], false, "arrive");
    n.path = route(n.x, n.z, home[0], home[1]);
    all({ t: "join", ...entMsg(n), arrive: 1 });
  }
  firstRead = false;
  for (const e of [...ents.values()]) {
    if (town.has(e.addr)) continue;
    if (e.online) {
      if (!e.visitor) { e.visitor = true; all({ t: "st", id: e.id, a: e.addr, on: 1, v: 1 }); }
      continue;
    }
    dropEnt(e, sold.has(e.addr) ? "sold" : "left");
  }
}

/* the bots: walk the graph between home, the streets and the square; greet and poke each other */
function botThink(e: Ent, dt: number) {
  if (e.busyT > 0) { e.busyT -= dt; return; }
  if (e.path.length) {
    const [tx, tz] = e.path[0], dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
    const sp = e.speed * (e.mode === "flee" ? 2 : e.mode === "crowd" ? 1.4 : 1) * dt;
    if (d > 0.01) e.yaw = Math.atan2(dx, dz);
    if (sp >= d) { e.x = tx; e.z = tz; e.path.shift(); } else { e.x += (dx / d) * sp; e.z += (dz / d) * sp; }
    e.dirty = true;
    if (!e.path.length) {
      e.mode = speech.on ? "crowd" : "idle";
      e.wait = 2 + Math.random() * 7;
      if (speech.on && world.podium) e.yaw = Math.atan2(world.podium[0] - e.x, world.podium[1] - e.z);
    }
    return;
  }
  if (speech.on && world.crowd && e.mode !== "crowd") { goCrowd(e); return; }
  if (speech.on) return;
  e.wait -= dt;
  if (e.wait > 0) return;
  e.mode = "walk";
  const home = homeOf(e.addr), r = Math.random();
  let tx: number, tz: number;
  if (r < 0.3) { tx = home[0]; tz = home[1]; }
  else if (r < 0.45 && world.crowd) { tx = world.crowd.x + (Math.random() - 0.5) * world.crowd.w; tz = world.crowd.z + (Math.random() - 0.5) * world.crowd.d; }
  else {
    // a walk around the neighbourhood: a random path point not too far from home
    let n = world.nodes[(Math.random() * world.nodes.length) | 0];
    for (let i = 0; i < 12; i++) {
      const c = world.nodes[(Math.random() * world.nodes.length) | 0];
      if (Math.hypot(c[0] - home[0], c[1] - home[1]) < 70) { n = c; break; }
    }
    tx = n[0] + (Math.random() - 0.5) * 3;
    tz = n[1] + (Math.random() - 0.5) * 3;
  }
  e.path = route(e.x, e.z, tx, tz);
}
function goCrowd(e: Ent) {
  const c = world.crowd!, h = h32(e.addr);
  const tx = c.x + ((h % 1000) / 1000 - 0.5) * c.w, tz = c.z + (((h >>> 10) % 1000) / 1000 - 0.5) * c.d;
  e.mode = "crowd";
  e.path = route(e.x, e.z, tx, tz);
}
/** Now and then two idle bots who bump into each other wave, hug, high-five or punch (just for fun). */
function botSocial(t: number) {
  if (speech.on) return;
  const idle = [...ents.values()].filter((e) => !e.online && !e.path.length && e.busyT <= 0);
  for (const a of idle) {
    if (t - a.greetT < 12_000 || Math.random() > 0.08) continue;
    const b = idle.find((o) => o !== a && Math.hypot(o.x - a.x, o.z - a.z) < 2.6 && t - o.greetT > 6000);
    if (!b) continue;
    a.greetT = b.greetT = t;
    a.yaw = Math.atan2(b.x - a.x, b.z - a.z);
    b.yaw = Math.atan2(a.x - b.x, a.z - b.z);
    a.dirty = b.dirty = true;
    a.busyT = b.busyT = 2.5;
    const k = pick(["wave", "hi5", "hi5", "hug", "bow", "punch"]);
    all({ t: "e", id: a.id, k, to: b.addr });
    if (Math.random() < 0.5) all({ t: "bub", id: pick([a, b]).id, text: pick(k === "punch" ? BOT_LINES.hit : k === "hug" ? BOT_LINES.hug : BOT_LINES.greet) });
  }
}
/** A player punched, hugged or high-fived a bot: the bot answers (punches back, runs off, or hugs back). */
function botReact(bot: Ent, from: Ent, k: string) {
  if (bot.online) return;
  bot.path = [];
  bot.busyT = 2.2;
  bot.yaw = Math.atan2(from.x - bot.x, from.z - bot.z);
  bot.dirty = true;
  const still = () => ents.get(bot.addr) === bot && !bot.online;
  if (k === "punch") {
    const r = Math.random();
    if (r < 0.4) setTimeout(() => { if (still()) { all({ t: "e", id: bot.id, k: "punch", to: from.addr }); all({ t: "bub", id: bot.id, text: pick(BOT_LINES.hit) }); } }, 650);
    else if (r < 0.75) {
      const dx = bot.x - from.x, dz = bot.z - from.z, d = Math.hypot(dx, dz) || 1;
      bot.busyT = 0.4;
      bot.mode = "flee";
      bot.path = route(bot.x, bot.z, bot.x + (dx / d) * 14, bot.z + (dz / d) * 14);
      all({ t: "bub", id: bot.id, text: "aaah!" });
    } else all({ t: "bub", id: bot.id, text: pick(BOT_LINES.hit) });
  } else if (k === "hug" || k === "hi5") {
    if (Math.random() < 0.8) setTimeout(() => { if (still()) all({ t: "e", id: bot.id, k, to: from.addr }); }, 250);
    if (Math.random() < 0.4) all({ t: "bub", id: bot.id, text: pick(BOT_LINES.hug) });
  } else if (k === "wave" && Math.random() < 0.6) setTimeout(() => { if (still()) all({ t: "e", id: bot.id, k: "wave" }); }, 500);
}

/* ───────── sessions (only for chat and speeches) ───────── */

const sessions: Record<string, { addr: string; exp: number }> = readJson(SESS_FILE, {});
let sessTimer: NodeJS.Timeout | null = null;
const saveSessions = () => {
  if (sessTimer) return;
  sessTimer = setTimeout(() => {
    sessTimer = null;
    const t = now();
    for (const [k, s] of Object.entries(sessions)) if (s.exp < t) delete sessions[k];
    writeJson(SESS_FILE, sessions);
  }, 1000);
};
const hashTok = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const loginText = (addr: string, nonce: string) =>
  [`${TOWN}: this is my wallet`, `Wallet: ${ethers.getAddress(addr)}`, `Nonce: ${nonce}`, "This signature is free and moves no funds."].join("\n");

/* ───────── sockets ───────── */

interface P {
  ws: WebSocket;
  ip: string;
  addr: string;
  signed: boolean;
  nonce: string;
  nonceAddr: string;
  ent: Ent | null;
  moveT: number;
  jumpT: number;
  rate: number[];
  chatT: number;
  emoT: number;
  sayT: number;
}
const socks = new Set<P>();
const perIp = new Map<string, number>();
const speech = { on: false, addr: "", lastT: 0, lines: [] as { text: string; at: number }[], goneT: 0 };

function send(p: P, m: unknown) {
  if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(m));
}
function all(m: unknown, except?: P) {
  const s = JSON.stringify(m);
  for (const p of socks) if (p !== except && p.ws.readyState === WebSocket.OPEN) p.ws.send(s);
}
const onlineCount = () => [...ents.values()].filter((e) => e.online).length;

function hello(p: P) {
  send(p, { t: "hi", now: now(), token, town: TOWN, slots: slotMap(), speech: speech.on ? { a: speech.addr, lines: speech.lines.slice(-3) } : null, ents: [...ents.values()].map(entMsg) });
}
/** Take over a wallet's citizen (or walk in as a visitor). A signed wallet can't be pushed out by an unsigned claim. */
function signIn(p: P, addr: string, signed: boolean, tokenOut?: string) {
  let e = ents.get(addr);
  const other = e && e.online && e.online !== p ? e.online : null;
  if (other) {
    if (other.signed && !signed) return send(p, { t: "auth", ok: false, a: addr, taken: true, error: "This wallet is already walking in town on another screen." });
    send(other, { t: "bye", why: "This wallet opened the town in another tab." });
    other.ent = null;
    other.addr = "";
    other.ws.close(4001, "opened elsewhere");
  }
  if (p.ent && p.ent.addr !== addr) release(p);
  if (!e) {
    const h = town.has(addr) ? homeOf(addr) : world.spawn;
    e = addEnt(addr, h[0], h[1], !town.has(addr));
    all({ t: "join", ...entMsg(e) });
  }
  p.signed = p.signed && p.ent === e ? true : signed;
  p.addr = addr;
  p.ent = e;
  e.online = p;
  e.path = [];
  e.busyT = 0;
  e.mode = "idle";
  all({ t: "st", id: e.id, a: addr, on: 1, v: e.visitor ? 1 : 0 });
  send(p, { t: "auth", ok: true, a: addr, id: e.id, signed: p.signed, token: tokenOut, citizen: town.has(addr), x: r2(e.x), z: r2(e.z) });
  log(`in  ${addr.slice(0, 8)}… (${onlineCount()} online)`);
}
/** The wallet left: a citizen goes back to being a bot from where it stands; a visitor leaves town. */
function release(p: P) {
  const e = p.ent;
  p.ent = null;
  if (!e || e.online !== p) return;
  e.online = null;
  if (e.visitor) dropEnt(e, "left");
  else {
    e.wait = 1;
    e.mode = "idle";
    all({ t: "st", id: e.id, a: e.addr, on: 0, v: 0 });
  }
  if (speech.on && speech.addr === e.addr) speech.goneT = now();
  log(`out ${e.addr.slice(0, 8)}… (${onlineCount()} online)`);
}

function endSpeech(why: string) {
  if (!speech.on) return;
  speech.on = false;
  for (const e of ents.values()) if (!e.online && e.mode === "crowd") { e.mode = "idle"; e.wait = 1 + Math.random() * 3; }
  all({ t: "speech", on: false, a: speech.addr, why });
  log(`speech ended (${why})`);
}
/** The speaker must still be No.1 (or No.2), online, and talking. */
function checkSpeaker() {
  if (!speech.on) return;
  const r = rankOf(speech.addr);
  if (!r || r > 2) return endSpeech("rank");
  const online = !!ents.get(speech.addr)?.online;
  if (!online && speech.goneT && now() - speech.goneT > 20_000) return endSpeech("left");
  if (online) speech.goneT = 0;
  if (now() - speech.lastT > 120_000) endSpeech("quiet");
}

function onMsg(p: P, raw: string) {
  if (raw.length > 1200) return;
  const t = now();
  p.rate = p.rate.filter((x) => t - x < 1000);
  p.rate.push(t);
  if (p.rate.length > 30) return; // more than 30 a second is not a browser
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  if (!m || typeof m.t !== "string") return;

  if (m.t === "ping") return send(p, { t: "pong", c: +m.c || 0, now: now() });
  if (m.t === "claim") {
    if (typeof m.a !== "string" || !ethers.isAddress(m.a)) return;
    return signIn(p, lc(m.a), false);
  }
  if (m.t === "resume") {
    if (typeof m.a !== "string" || !ethers.isAddress(m.a) || typeof m.token !== "string") return;
    const s = sessions[hashTok(m.token)];
    if (!s || s.addr !== lc(m.a) || s.exp < t) return send(p, { t: "auth", ok: false, a: lc(m.a) });
    return signIn(p, s.addr, true);
  }
  if (m.t === "nonce") {
    if (typeof m.a !== "string" || !ethers.isAddress(m.a)) return;
    p.nonce = crypto.randomBytes(8).toString("hex");
    p.nonceAddr = lc(m.a);
    return send(p, { t: "nonce", a: p.nonceAddr, msg: loginText(p.nonceAddr, p.nonce) });
  }
  if (m.t === "login") {
    if (!p.nonce || typeof m.sig !== "string" || lc(String(m.a || "")) !== p.nonceAddr) return send(p, { t: "auth", ok: false, a: p.nonceAddr, error: "Try again." });
    let signer = "";
    try {
      signer = lc(ethers.verifyMessage(loginText(p.nonceAddr, p.nonce), m.sig));
    } catch {}
    const addr = p.nonceAddr;
    p.nonce = "";
    if (signer !== addr) return send(p, { t: "auth", ok: false, a: addr, error: "That signature isn't from this wallet." });
    const tok = crypto.randomBytes(24).toString("hex");
    sessions[hashTok(tok)] = { addr, exp: t + SESSION_DAYS * 86400_000 };
    saveSessions();
    return signIn(p, addr, true, tok);
  }
  if (m.t === "logout") {
    release(p);
    p.addr = "";
    p.signed = false;
    return;
  }

  const e = p.ent;
  if (!e || e.online !== p) return; // everything below needs your citizen

  if (m.t === "p") {
    const x = +m.x, z = +m.z, yaw = +m.y;
    if (![x, z, yaw].every(Number.isFinite)) return;
    const B = world.bounds;
    if (x < B.x0 - 5 || x > B.x1 + 5 || z < B.z0 - 5 || z > B.z1 + 5) return;
    const d = Math.hypot(x - e.x, z - e.z), dt = Math.max(0.05, (t - p.moveT) / 1000);
    if (p.moveT && d > MAX_SPEED * dt + 1.5) {
      if (t - p.jumpT < JUMP_EVERY * 1000) return; // too fast, and the last jump was just now
      p.jumpT = t;
    }
    e.x = x;
    e.z = z;
    e.yaw = yaw;
    e.dirty = true;
    p.moveT = t;
    return;
  }
  if (m.t === "e") {
    if (!EMOTES.has(m.k) || t - p.emoT < 500) return;
    p.emoT = t;
    const to = typeof m.to === "string" && /^0x[0-9a-f]{40}$/.test(m.to) ? m.to : undefined;
    all({ t: "e", id: e.id, k: m.k, to }, p);
    const target = to ? ents.get(to) : undefined;
    if (target && !target.online && Math.hypot(target.x - e.x, target.z - e.z) < 6) botReact(target, e, m.k);
    return;
  }
  if (m.t === "chat") {
    if (!town.has(p.addr)) return send(p, { t: "note", text: `Chat is for citizens (${MIN_BAL.toLocaleString("en-US")} ${TICKER} or more).` });
    if (!p.signed) return send(p, { t: "needsign", what: "chat" });
    const text = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!text) return;
    if (t - p.chatT < 1500) return send(p, { t: "note", text: "Slow down a little." });
    if (BAD.test(text)) return send(p, { t: "note", text: "That message isn't allowed (no links or bad words)." });
    p.chatT = t;
    return all({ t: "chat", id: e.id, a: p.addr, text }, p);
  }
  if (m.t === "speech") {
    const r = rankOf(p.addr);
    if (m.on && !p.signed) return send(p, { t: "needsign", what: "speech" });
    if (m.on) {
      if (speech.on) return send(p, { t: "note", text: "A speech is already on." });
      if (!r || r > 2) return send(p, { t: "note", text: "Only No.1 (or No.2) gives speeches." });
      Object.assign(speech, { on: true, addr: p.addr, lastT: t, lines: [], goneT: 0 });
      if (world.crowd) for (const b of ents.values()) if (!b.online) goCrowd(b);
      log(`speech by ${p.addr.slice(0, 8)}… (No.${r})`);
      return all({ t: "speech", on: true, a: p.addr }, p);
    }
    if (speech.on && speech.addr === p.addr) endSpeech("done");
    return;
  }
  if (m.t === "say") {
    if (!speech.on || speech.addr !== p.addr || !p.signed || t - p.sayT < 1200) return;
    const text = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!text) return;
    if (BAD.test(text)) return send(p, { t: "note", text: "That line isn't allowed (no links or bad words)." });
    p.sayT = t;
    speech.lastT = t;
    speech.lines.push({ text, at: t });
    if (speech.lines.length > 6) speech.lines.shift();
    return all({ t: "say", a: p.addr, text }, p);
  }
}

/* ───────── server ───────── */

const server = http.createServer((req, res) => {
  if ((req.url || "").startsWith("/ws/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, online: onlineCount(), bots: [...ents.values()].filter((e) => !e.online).length, sockets: socks.size, town: town.size, engine: townOk, world: world.nodes.length }));
  }
  res.writeHead(426);
  res.end();
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });

server.on("upgrade", (req, sock, head) => {
  if ((req.url || "").split("?")[0] !== "/ws") return sock.destroy();
  const fwd = req.headers["x-real-ip"];
  const ip = String((Array.isArray(fwd) ? fwd[0] : fwd) || req.socket.remoteAddress || "");
  if (socks.size >= MAX_SOCKETS || (perIp.get(ip) || 0) >= MAX_PER_IP) return sock.destroy();
  wss.handleUpgrade(req, sock, head, (ws) => {
    const p: P = { ws, ip, addr: "", signed: false, nonce: "", nonceAddr: "", ent: null, moveT: 0, jumpT: 0, rate: [], chatT: 0, emoT: 0, sayT: 0 };
    socks.add(p);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    let alive = true;
    ws.on("pong", () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 25_000);
    ws.on("message", (d) => onMsg(p, d.toString()));
    ws.on("close", () => {
      clearInterval(ping);
      release(p);
      socks.delete(p);
      const n = (perIp.get(ip) || 1) - 1;
      if (n <= 0) perIp.delete(ip);
      else perIp.set(ip, n);
    });
    ws.on("error", () => {});
    hello(p);
  });
});

let lastSlotsVer = slotsVer, simT = now();
setInterval(() => {
  const t = now(), dt = Math.min(0.5, (t - simT) / 1000);
  simT = t;
  for (const e of ents.values()) if (!e.online) botThink(e, dt);
}, SIM_MS);
setInterval(() => botSocial(now()), 1000);
/** Positions go out in one batch, only for what moved. */
setInterval(() => {
  const l: number[][] = [];
  for (const e of ents.values()) {
    if (!e.dirty) continue;
    e.dirty = false;
    const k = `${r2(e.x)},${r2(e.z)},${r2(e.yaw)}`;
    if (k === e.last) continue;
    e.last = k;
    l.push([e.id, r2(e.x), r2(e.z), r2(e.yaw)]);
  }
  if (l.length) all({ t: "p", l });
  if (slotsVer !== lastSlotsVer) { lastSlotsVer = slotsVer; all({ t: "slots", slots: slotMap() }); }
}, NET_MS);
setInterval(() => all({ t: "clock", now: now() }), 30_000);
setInterval(readTown, 4000);
setInterval(checkSpeaker, 5000);
readTown();

server.listen(PORT, "127.0.0.1", () => log(`${TOWN} live on 127.0.0.1:${PORT} · engine ${ENGINE}`));
