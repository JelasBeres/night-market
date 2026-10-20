/**
 * Profiles: a holder signs a plain message to set their citizen's nickname and look
 * (species, fur, crown, cape, pet, trail …). No transaction, no gas. Kept in its own file so a
 * token change never wipes them; the burn and treasury logic never reads this module.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ethers } from "ethers";
import { config } from "./store";

const FILE = path.resolve(process.cwd(), "bot-profiles.json");

export interface Profile {
  name?: string;
  nameAt?: number;
  look?: Record<string, string | number>;
  at?: number;
}

const book: Record<string, Profile> = (() => {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
})();

function save() {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(book), "utf-8");
  fs.renameSync(tmp, FILE);
}

export const profileOf = (addr: string) => book[addr.toLowerCase()] || null;

const NONCE_TTL = 10 * 60;
const NAME_COOLDOWN = 24 * 3600;
const nonces = new Map<string, { nonce: string; exp: number }>();

/** Words a nickname may not contain: impersonation of staff, and the obvious abuse. */
const BANNED = [
  "admin", "official", ...config.townName.toLowerCase().split(/\s+/).filter((w) => w.length > 3), "support", "moderator", "team", "staff", "dev", "owner", "pons", "airdrop", "claim", "giveaway",
  "fuck", "shit", "cunt", "nigg", "fag", "rape", "nazi", "hitler", "porn", "whore", "bitch", "retard", "kontol", "memek", "ngentot", "anjing", "babi",
];

/**
 * The looks the town knows, each with the best rank allowed to wear it (1 = only the Mayor,
 * 10 = the whole top 10). Must match LOOK and SPECIES_DEF in index.html.
 */
const RULES: Record<string, [string | number, number][]> = {
  species: [["human", 10], ["monkey", 10], ["rabbit", 10], ["cat", 10], ["bear", 10], ["fox", 10], ["frog", 10], ["penguin", 10], ["panda", 3], ["robot", 5], ["dragon", 1]],
  fur: [[0, 10], [1, 10], [2, 10], [3, 10]],
  crown: [["classic", 3], ["jeweled", 3], ["laurel", 3], ["flower", 1], ["imperial", 1]],
  cape: [["#b8232f", 3], ["#6b3fb0", 3], ["#2f5fd0", 3], ["#1f7a4a", 3], ["#1d1a16", 3], ["#f2f0ea", 1]],
  scepter: [["scepter", 1], ["staff", 1], ["none", 1]],
  hat: [["top", 5], ["bowler", 5], ["fedora", 5], ["feather", 5], ["beret", 10], ["wizard", 10], ["cowboy", 10], ["cap", 10], ["beanie", 10], ["flowerhat", 10]],
  shirt: [["#e8434f", 10], ["#2f7cf6", 10], ["#1fb36b", 10], ["#ffd75e", 10], ["#9a63ff", 10], ["#ff7a1a", 10], ["#f2f6f7", 10], ["#2a2724", 10]],
  pet: [["none", 5], ["dog", 5], ["cat", 5], ["duck", 5], ["pig", 5], ["peacock", 1]],
  trail: [["none", 10], ["confetti", 5], ["silver", 3], ["gold", 1]],
};

/** Checks a nickname and look against a rank (0 = not in the top 10). Returns an error or null. */
export function rankAllows(rank: number, name: string | undefined, look: Record<string, string | number> | undefined) {
  if (!rank) return name || (look && Object.keys(look).length) ? "Nicknames and looks are for the top 10. Climb in and they unlock." : null;
  for (const [k, v] of Object.entries(look || {})) {
    const it = RULES[k].find((x) => x[0] === v);
    if (!it || rank > it[1]) return `Your rank (No.${rank}) can't wear that ${k} yet.`;
  }
  return null;
}

export function cleanName(raw: unknown): { name?: string; error?: string } {
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw !== "string") return { error: "Type a nickname." };
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 3 || name.length > 16) return { error: "Nicknames are 3 to 16 characters." };
  if (!/^[A-Za-z0-9 _'-]+$/.test(name)) return { error: "Letters, numbers, spaces, - ' and _ only." };
  if (/^0x/i.test(name)) return { error: "A nickname can't look like a wallet address." };
  const flat = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (BANNED.some((w) => flat.includes(w))) return { error: "That nickname isn't allowed. Pick another." };
  return { name };
}

export function cleanLook(raw: unknown): { look?: Record<string, string | number>; error?: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "Bad look." };
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const rule = RULES[k];
    if (!rule) return { error: `Unknown look "${k}".` };
    if (!rule.some((x) => x[0] === v)) return { error: `Bad ${k}.` };
    out[k] = v as string | number;
  }
  return { look: out };
}

/** The exact text the wallet signs. The server rebuilds it, so the client cannot change a word. */
export function profileMessage(addr: string, name: string, look: string, nonce: string) {
  return [
    `${config.townName}: dress my citizen`,
    `Wallet: ${ethers.getAddress(addr)}`,
    `Nickname: ${name || "(none)"}`,
    `Look: ${look}`,
    `Nonce: ${nonce}`,
    "This signature is free and moves no funds.",
  ].join("\n");
}

/** Stable text for a look: keys sorted, so the signer and the server build the same line. */
export const lookText = (look: Record<string, string | number> | undefined) =>
  look ? Object.keys(look).sort().map((k) => `${k}=${look[k]}`).join(",") : "";

export function issueNonce(addr: string) {
  const nonce = crypto.randomBytes(8).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + NONCE_TTL;
  nonces.set(addr.toLowerCase(), { nonce, exp });
  return { nonce, expiresAt: exp };
}

const hits = new Map<string, number[]>();
/** At most 8 profile requests per IP per minute. */
export function rateLimited(ip: string) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 8;
}

function spendNonce(addr: string, nonce: unknown, signature: unknown, text: (nonce: string) => string): string | null {
  const pending = nonces.get(addr);
  const now = Math.floor(Date.now() / 1000);
  if (!pending || pending.nonce !== nonce || pending.exp < now) return "The signing request expired. Try again.";
  let signer = "";
  try {
    signer = ethers.verifyMessage(text(pending.nonce), String(signature)).toLowerCase();
  } catch {
    return "The signature couldn't be read.";
  }
  if (signer !== addr) return "That signature isn't from this wallet.";
  nonces.delete(addr); // one use only
  return null;
}

/**
 * Saves a signed profile. Who may wear what (top 10 only, crowns for No.1 …) is the town's rule
 * and is checked by `allowed`, against the ranks as they stand right now.
 */
export function claimProfile(
  input: { addr?: unknown; name?: unknown; look?: unknown; nonce?: unknown; signature?: unknown },
  isCitizen: (addr: string) => boolean,
  allowed: (addr: string, name: string | undefined, look: Record<string, string | number> | undefined) => string | null,
) {
  if (typeof input.addr !== "string" || !ethers.isAddress(input.addr)) return { error: "That isn't a wallet address." };
  const addr = input.addr.toLowerCase();
  const n = cleanName(input.name);
  if (n.error) return { error: n.error };
  const l = cleanLook(input.look);
  if (l.error) return { error: l.error };
  const bad = spendNonce(addr, input.nonce, input.signature, (nonce) => profileMessage(addr, n.name || "", lookText(l.look), nonce));
  if (bad) return { error: bad };
  if (!isCitizen(addr)) return { error: `Only citizens of ${config.townName} (${Number(config.minBalance).toLocaleString("en-US")} ${config.ticker} or more) can dress up.` };
  const no = allowed(addr, n.name, l.look);
  if (no) return { error: no };
  const now = Math.floor(Date.now() / 1000);
  const prev = book[addr] || {};
  const next: Profile = { ...prev, at: now };
  if (n.name !== undefined && n.name !== prev.name) {
    if (prev.nameAt && now - prev.nameAt < NAME_COOLDOWN) return { error: "You can change your nickname once a day." };
    const taken = Object.entries(book).find(([a, b]) => a !== addr && b.name?.toLowerCase() === n.name!.toLowerCase());
    if (taken) return { error: "Another wallet already uses that nickname." };
    next.name = n.name;
    next.nameAt = now;
  }
  if (l.look) next.look = l.look;
  book[addr] = next;
  save();
  return { profile: next };
}

export function removeProfile(addr: string) {
  const had = !!book[addr.toLowerCase()];
  delete book[addr.toLowerCase()];
  if (had) save();
  return had;
}
