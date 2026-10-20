/**
 * Holder-town engine (TOWN_NAME / TICKER) · Robinhood Chain (4663) · Pons Family v2
 *
 * 1. Indexer: follows every the token Transfer, keeps balances and first-buy time, and marks a
 *    wallet "out" forever once it sends the token to the curve / a DEX contract (one sale and you
 *    leave town). Every wallet holding the minimum is a citizen with a house.
 * 2. One kind of round. Each time the Pons fee escrow reaches ROUND_ETH (0.02), the engine claims
 *    it and, in the same round:
 *      buys the token once with the burn + reward parts (curve, or Uniswap v4 after graduation),
 *      burns the burn part of what it bought (30% of the round) at 0x…dEaD,
 *      shares the reward part (35%) with the council: the top 10 citizens who have held at least
 *        10 minutes, by balance (nobody eligible: that part is burned too),
 *      sends the treasury part (35%, ETH) to the treasury, which upgrades the town.
 *    The engine never sells, and whatever its wallet held before a buy is never touched.
 * Every transaction hash is saved before it is awaited, so a restart checks the chain and
 * resumes the round instead of sending twice.
 */
import http from "http";
import { ethers } from "ethers";
import { config, saveConfig, state, saveStateNow, saveStateSoon, resetStateForToken, logs, log, type Drop, type Holder, type Round } from "./store";
import { buildUniswapV4Buy, UNISWAP_V4_UNIVERSAL_ROUTER } from "./uniswap-v4";
import { claimProfile, issueNonce, lookText, profileMessage, profileOf, rankAllows, rateLimited, removeProfile } from "./profile";

const PONS_FEE_ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";
const DEAD = "0x000000000000000000000000000000000000dEaD".toLowerCase();
const ZERO = ethers.ZeroAddress.toLowerCase();
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const GAS_BUFFER = ethers.parseEther("0.0008");

const ESCROW_ABI = ["function balanceOf(address) view returns (uint256)", "function claim()"];
const CURVE_ABI = [
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)",
  "function graduated() view returns (bool)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function curve() view returns (address)",
];

let provider: ethers.JsonRpcProvider | null = null;
let wallet: ethers.Wallet | null = null;
let status: "standby" | "indexing" | "claiming" | "buying" | "burning" | "sharing" | "keeper" | "idle" | "error" = "standby";
let escrowWei = 0n;
let decimals = 18;

const lc = (a: string) => a.toLowerCase();
const isAddr = (a?: string) => !!a && ethers.isAddress(a.trim());
const big = (s: string) => BigInt(s || "0");
const add = (a: string, b: bigint) => (big(a) + b).toString();

function initWallet() {
  // No response cache: a send right after the last one confirmed must read the new nonce.
  provider = new ethers.JsonRpcProvider(config.rpcUrl, 4663, { staticNetwork: true, cacheTimeout: -1 });
  wallet = null;
  if (!config.privateKey) {
    log("warn", "STANDBY: no operator key yet. Set it in /memex.");
    return;
  }
  try {
    wallet = new ethers.Wallet(config.privateKey, provider);
    log("info", `Operator wallet: ${wallet.address}`);
  } catch (e: any) {
    log("error", `Operator key rejected: ${e.message}`);
  }
}
initWallet();

/* ───────────────────────── who lives in town ───────────────────────── */

function excluded(): Set<string> {
  const s = new Set<string>([ZERO, DEAD, lc(PONS_FEE_ESCROW), lc(UNISWAP_V4_UNIVERSAL_ROUTER)]);
  if (isAddr(config.curveAddress)) s.add(lc(config.curveAddress));
  if (isAddr(config.treasuryAddress)) s.add(lc(config.treasuryAddress));
  if (isAddr(config.tokenAddress)) s.add(lc(config.tokenAddress));
  if (wallet) s.add(lc(wallet.address));
  for (const a of config.sellSinks) s.add(lc(a));
  return s;
}

const minBalanceRaw = () => ethers.parseUnits(config.minBalance || "0", decimals);

type Standing = "citizen" | "too-small" | "out" | "excluded" | "not-holding";

function standing(addr: string, h: Holder | undefined, ex = excluded()): Standing {
  if (ex.has(addr) || h?.relay) return "excluded";
  if (!h || big(h.balance) === 0n) return h?.hopped ? "out" : "not-holding";
  if (h.hopped) return "out";
  if (big(h.balance) < minBalanceRaw()) return "too-small";
  return "citizen";
}

/** Every citizen, biggest balance first (ties: who moved in first). */
function citizens() {
  const ex = excluded();
  return Object.entries(state.holders)
    .filter(([a, h]) => standing(a, h, ex) === "citizen")
    .map(([addr, h]) => ({ addr, h }))
    .sort((a, b) => (big(b.h.balance) > big(a.h.balance) ? 1 : big(b.h.balance) < big(a.h.balance) ? -1 : a.h.firstIn - b.h.firstIn));
}
const rankOf = (addr: string) => {
  const i = citizens().findIndex((c) => c.addr === addr);
  return i >= 0 && i < 10 ? i + 1 : 0;
};

/** The council for a reward: the top N citizens that have held long enough, biggest first. */
function council(now: number) {
  const hold = config.minHoldMinutes * 60;
  return citizens().slice(0, config.rewardTopN).filter((c) => c.h.firstIn && now - c.h.firstIn >= hold);
}

/** Splits an amount by balance; the last share takes the rounding dust so nothing is left over. */
function splitByBalance(total: bigint, balances: bigint[]) {
  const sum = balances.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return balances.map(() => 0n);
  const out = balances.map((b) => (total * b) / sum);
  out[out.length - 1] += total - out.reduce((a, b) => a + b, 0n);
  return out;
}
const pctOf = (wei: bigint, pct: number) => (wei * BigInt(Math.round(pct * 100))) / 10000n;

/* ───────────────────────── indexer ───────────────────────── */

const blockTime = new Map<number, number>();
async function timeOf(n: number) {
  if (!blockTime.has(n)) {
    const b = await provider!.getBlock(n);
    blockTime.set(n, b ? b.timestamp : Math.floor(Date.now() / 1000));
    if (blockTime.size > 5000) blockTime.delete(blockTime.keys().next().value!);
  }
  return blockTime.get(n)!;
}

async function contractAt(addr: string) {
  if (state.isContract[addr] === undefined) {
    const code = await provider!.getCode(addr);
    state.isContract[addr] = code !== "0x";
  }
  return state.isContract[addr];
}

/** The block of the token's mint (Transfer from 0x0). Pons mints the whole supply once, at launch. */
async function findDeployBlock(token: string) {
  const latest = await provider!.getBlockNumber();
  const WINDOW = 9_000_000;
  const mintTopic = ethers.zeroPadValue(ethers.ZeroAddress, 32);
  for (let to = latest; to >= 0; to -= WINDOW) {
    const from = Math.max(0, to - WINDOW + 1);
    const found = await provider!.getLogs({ address: token, topics: [TRANSFER_TOPIC, mintTopic], fromBlock: from, toBlock: to });
    if (found.length) return found[0].blockNumber;
  }
  return latest;
}

const errText = (e: any) => [e?.shortMessage || e?.message || String(e), e?.info?.error?.message, e?.error?.message].filter(Boolean).join(" | ");

let span = 200_000;
async function indexTransfers() {
  if (!provider || !isAddr(config.tokenAddress)) return;
  const token = config.tokenAddress;
  if (!state.lastIndexedBlock) {
    if (!config.startBlock) {
      config.startBlock = await findDeployBlock(token);
      saveConfig();
      log("info", `Token deploy block detected: ${config.startBlock}`);
    }
    state.lastIndexedBlock = config.startBlock - 1;
  }
  const latest = await provider.getBlockNumber();
  const ex = excluded();
  const sinks = new Set(config.sellSinks.map(lc));
  if (isAddr(config.curveAddress)) sinks.add(lc(config.curveAddress));

  while (state.lastIndexedBlock < latest) {
    const from = state.lastIndexedBlock + 1;
    const to = Math.min(latest, from + span - 1);
    let found: ethers.Log[];
    try {
      found = await provider.getLogs({ address: token, topics: [TRANSFER_TOPIC], fromBlock: from, toBlock: to });
      if (found.length) moved = true;
      if (span < 2_000_000) span = Math.min(2_000_000, span * 2);
    } catch (e: any) {
      span = Math.max(1_000, Math.floor(span / 4));
      log("warn", `getLogs ${from}-${to} failed (${errText(e)}); shrinking range to ${span}`);
      return;
    }
    // A range is applied whole or not at all, on a copy of the holder book: if an RPC call fails
    // halfway (or a save lands mid-range), nothing half-done is kept, so the same transfers are
    // never counted twice.
    const book: Record<string, Holder> = JSON.parse(JSON.stringify(state.holders));
    await applyLogs(found, ex, sinks, book);
    state.holders = book;
    state.lastIndexedBlock = to;
    saveStateSoon();
  }
}

async function applyLogs(found: ethers.Log[], ex: Set<string>, sinks: Set<string>, book: Record<string, Holder>) {
  {
    for (const l of found) {
      const src = lc(ethers.getAddress("0x" + l.topics[1].slice(26)));
      const dst = lc(ethers.getAddress("0x" + l.topics[2].slice(26)));
      const value = BigInt(l.data);
      const t = await timeOf(l.blockNumber);

      if (src !== ZERO) {
        const h = (book[src] ||= { balance: "0", firstIn: 0, hopped: false, hoppedAt: 0, hoppedTx: "" });
        h.balance = (big(h.balance) - value).toString();
        // A contract forwarding what it received in this same tx is a router, not a holder.
        if (!h.relay && h.lastInTx === l.transactionHash && (await contractAt(src))) h.relay = true;
        const isSell = !ex.has(src) && (sinks.has(dst) || (config.contractsAreSells && !ex.has(dst) && dst !== DEAD && (await contractAt(dst))));
        if (!h.hopped && !h.relay && !ex.has(src) && (isSell || sinks.has(dst))) {
          h.hopped = true;
          h.hoppedAt = t;
          h.hoppedTx = l.transactionHash;
          log("info", `sold and left town: ${src.slice(0, 8)}… (tx ${l.transactionHash.slice(0, 10)}…)`);
        }
      }
      if (dst !== ZERO) {
        const h = (book[dst] ||= { balance: "0", firstIn: 0, hopped: false, hoppedAt: 0, hoppedTx: "" });
        if (big(h.balance) === 0n && !h.firstIn) h.firstIn = t;
        h.balance = (big(h.balance) + value).toString();
        h.lastInTx = l.transactionHash;
      }
    }
  }
}

/* ───────────────────────── sending, once ───────────────────────── */

async function txState(hash: string): Promise<"ok" | "reverted" | "lost"> {
  const r = await provider!.getTransactionReceipt(hash).catch(() => null);
  if (r) return r.status === 1 ? "ok" : "reverted";
  const t = await provider!.getTransaction(hash).catch(() => null);
  if (!t) return "lost";
  const w = await t.wait().catch(() => null);
  return w && w.status === 1 ? "ok" : "reverted";
}

/**
 * Sends a transaction for one slot of a round. The hash is saved before waiting, so after a
 * restart an existing hash is checked on-chain and only re-sent if it reverted or never landed.
 */
async function once(get: () => string, set: (h: string) => void, send: () => Promise<ethers.TransactionResponse>) {
  const prev = get();
  if (prev) {
    if ((await txState(prev)) === "ok") return true;
    set("");
    saveStateNow();
  }
  const tx = await send();
  set(tx.hash);
  saveStateNow();
  const r = await tx.wait();
  return r?.status === 1;
}

/* ───────────────────────── the cycle ───────────────────────── */

let lastWaitNote = "";
function note(msg: string) {
  if (msg !== lastWaitNote) log("info", msg);
  lastWaitNote = msg;
}

/** Claim the escrow for the current step once it is big enough. */
async function startRound() {
  if (escrowWei === 0n || escrowWei < ethers.parseEther(config.roundETH)) return;
  if (!isAddr(config.curveAddress)) return note("A round is due but the curve address is not known yet.");
  if (!isAddr(config.treasuryAddress)) return note("A round is due but no treasury is set. Set it in /memex.");
  const r: Round = {
    n: (state.rounds[0]?.n || 0) + 1,
    kind: "town",
    at: Math.floor(Date.now() / 1000),
    stage: "claiming",
    claimTx: "",
    claimedWei: escrowWei.toString(),
    payWei: "0",
    treasuryTx: "",
    doneAt: 0,
  };
  state.rounds.unshift(r);
  if (state.rounds.length > 500) state.rounds.length = 500;
  status = "claiming";
  log("info", `Round #${r.n}: escrow hit ${ethers.formatEther(escrowWei)} ETH. Claiming.`);
  await claimRound(r);
}

/** Adds a confirmed step to the totals exactly once. */
function count(r: Round, key: keyof NonNullable<Round["counted"]>, apply: () => void) {
  r.counted ||= {};
  if (r.counted[key]) return;
  apply();
  r.counted[key] = true;
}

async function claimRound(r: Round) {
  const escrow = new ethers.Contract(PONS_FEE_ESCROW, ESCROW_ABI, wallet!);
  const ok = await once(() => r.claimTx, (h) => (r.claimTx = h), () => escrow.claim());
  if (!ok) {
    r.stage = "failed";
    saveStateNow();
    log("error", `Round #${r.n}: claim reverted. Will try again.`);
    return;
  }
  escrowWei = 0n;
  r.stage = "claimed";
  count(r, "claim", () => (state.totals.feesClaimedWei = add(state.totals.feesClaimedWei, big(r.claimedWei))));
  // Spend what was claimed, never the gas buffer the engine needs to keep working.
  const bal = await provider!.getBalance(wallet!.address);
  const spendable = bal > GAS_BUFFER ? bal - GAS_BUFFER : 0n;
  const claimed = big(r.claimedWei);
  const pay = claimed < spendable ? claimed : spendable;
  r.payWei = pay.toString();
  r.keepWei = pctOf(pay, config.treasuryPct).toString();
  r.buyWei = (pay - big(r.keepWei)).toString();
  saveStateNow();
}

function countDrop(p: Drop) {
  if (p.counted) return;
  const h = state.holders[p.addr];
  if (h) h.tokensReceived = add(h.tokensReceived || "0", big(p.amount));
  state.totals.tokensShared = add(state.totals.tokensShared, big(p.amount));
  p.counted = true;
}

/**
 * The whole round: one buy, then the burn, the council's shares and the treasury, each sent once.
 * Whatever the wallet held before the buy (the dev's own bag) is never touched.
 */
async function town(r: Round) {
  const token = new ethers.Contract(config.tokenAddress, ERC20_ABI, wallet!);
  const buyWei = big(r.buyWei || "0");
  if (buyWei > 0n && (!r.buyTx || (await txState(r.buyTx)) !== "ok")) {
    status = "buying";
    if (!r.buyTx) {
      r.heldBefore = ((await token.balanceOf(wallet!.address)) as bigint).toString();
      saveStateNow();
    }
    const curve = new ethers.Contract(config.curveAddress, CURVE_ABI, wallet!);
    const graduated: boolean = await curve.graduated().catch(() => false);
    const ok = await once(
      () => r.buyTx || "",
      (h) => (r.buyTx = h),
      () =>
        graduated
          ? wallet!.sendTransaction({ to: UNISWAP_V4_UNIVERSAL_ROUTER, value: buyWei, data: buildUniswapV4Buy(config.tokenAddress, buyWei), gasLimit: 400000n })
          : curve.buy(buyWei, 0n, wallet!.address, { value: buyWei }),
    );
    if (!ok) throw new Error(`Round #${r.n}: buyback reverted`);
    log("info", `Round #${r.n}: bought on ${graduated ? "Uniswap v4" : "the curve"} (${r.buyTx}).`);
  }
  count(r, "buy", () => (state.totals.burnWei = add(state.totals.burnWei, buyWei)));
  // Also covers a restart between the buy landing and its amount being saved.
  if (r.tokensBought === undefined) {
    const after: bigint = buyWei > 0n ? await token.balanceOf(wallet!.address) : 0n;
    const before = big(r.heldBefore || "0");
    r.tokensBought = (after > before ? after - before : 0n).toString();
    saveStateNow();
    log("info", `Round #${r.n}: bought ${ethers.formatUnits(big(r.tokensBought), decimals)} ${config.ticker}.`);
  }
  const bought = big(r.tokensBought);

  // Split what was bought between the council and the burn, once, from a fresh balance book.
  if (bought > 0n && r.burnAmount === undefined) {
    const now = Math.floor(Date.now() / 1000);
    const cz = council(now);
    const rewardPart = cz.length ? (bought * BigInt(Math.round(config.rewardPct * 100))) / BigInt(Math.round((config.rewardPct + config.burnPct) * 100)) : 0n;
    const split = splitByBalance(rewardPart, cz.map((c) => big(c.h.balance)));
    r.drops = cz.map((c, i) => ({ addr: c.addr, balance: c.h.balance, amount: split[i].toString(), tx: "" })).filter((p) => big(p.amount) > 0n);
    const shared = r.drops.reduce((a, p) => a + big(p.amount), 0n);
    r.burnAmount = (bought - shared).toString();
    saveStateNow();
    if (!cz.length) log("info", `Round #${r.n}: nobody in the top ${config.rewardTopN} has held ${config.minHoldMinutes} min yet, so the council part is burned too.`);
  }

  const burnAmount = big(r.burnAmount || "0");
  if (burnAmount > 0n) {
    status = "burning";
    const ok = await once(() => r.burnTx || "", (h) => (r.burnTx = h), () => token.transfer(DEAD, burnAmount));
    if (!ok) throw new Error(`Round #${r.n}: the burn transfer reverted`);
    count(r, "burn", () => (state.totals.tokensBurned = add(state.totals.tokensBurned, burnAmount)));
    log("success", `Round #${r.n}: ${ethers.formatUnits(burnAmount, decimals)} ${config.ticker} burned (${r.burnTx})`);
  }

  if (r.drops?.length) {
    status = "sharing";
    for (const p of r.drops) {
      if (p.counted) continue;
      const ok = await once(() => p.tx, (h) => (p.tx = h), () => token.transfer(p.addr, big(p.amount)));
      if (!ok) throw new Error(`Round #${r.n}: the reward transfer to ${p.addr} reverted`);
      countDrop(p);
      saveStateNow();
    }
    log("success", `Round #${r.n}: ${ethers.formatUnits(r.drops.reduce((a, p) => a + big(p.amount), 0n), decimals)} ${config.ticker} shared with ${r.drops.length} council members.`);
  }

  const keepWei = big(r.keepWei || "0");
  if (keepWei > 0n) {
    status = "keeper";
    const ok = await once(() => r.treasuryTx, (h) => (r.treasuryTx = h), () => wallet!.sendTransaction({ to: config.treasuryAddress, value: keepWei }));
    if (!ok) throw new Error(`Round #${r.n}: treasury transfer reverted`);
    count(r, "keeper", () => (state.totals.keeperWei = add(state.totals.keeperWei, keepWei)));
    log("success", `Round #${r.n}: ${ethers.formatEther(keepWei)} ETH to the treasury (${r.treasuryTx})`);
  }
  return true;
}

async function runCycle() {
  if (!wallet || !provider || !isAddr(config.tokenAddress)) return;
  const escrow = new ethers.Contract(PONS_FEE_ESCROW, ESCROW_ABI, wallet);
  escrowWei = await escrow.balanceOf(wallet.address);

  let r = state.rounds[0];
  if (r?.stage === "claiming") await claimRound(r);
  if (!r || r.stage === "done" || r.stage === "failed") {
    await startRound();
    r = state.rounds[0];
  }
  if (!r || r.stage !== "claimed") return;
  // The council is picked from a fresh balance book.
  if (r.burnAmount === undefined && state.lastIndexedBlock < (await provider.getBlockNumber()) - 5) return;
  const finished = await town(r);
  if (!finished) return;
  r.stage = "done";
  r.doneAt = Math.floor(Date.now() / 1000);
  saveStateNow();
  push("town");
}

/* ───────────────────────── live push ───────────────────────── */

// Every open page keeps one event stream and refetches the moment something changes.
const streams = new Set<http.ServerResponse>();
function push(what: "town") {
  for (const r of streams) r.write(`event: ${what}\ndata: ${Date.now()}\n\n`);
}
setInterval(() => {
  for (const r of streams) r.write(": ping\n\n");
}, 20_000);
let moved = false;

/* ───────────────────────── main loop ───────────────────────── */

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (!isAddr(config.tokenAddress)) {
      status = "standby";
      return;
    }
    if (!provider) initWallet();
    const token = new ethers.Contract(config.tokenAddress, ERC20_ABI, provider!);
    if (!isAddr(config.curveAddress)) {
      const c: string = await token.curve().catch(() => "");
      if (isAddr(c) && c !== ethers.ZeroAddress) {
        config.curveAddress = c;
        saveConfig();
        log("info", `Pons curve detected: ${c}`);
      }
    }
    decimals = Number(await token.decimals().catch(() => 18));
    if (state.supply === "0") state.supply = ((await token.totalSupply().catch(() => 0n)) as bigint).toString();
    status = "indexing";
    await indexTransfers();
    await runCycle();
    if (moved) {
      moved = false;
      push("town");
    }
    status = "idle";
  } catch (e: any) {
    status = "error";
    log("error", errText(e));
  } finally {
    busy = false;
  }
}

// ethers polls for receipts in the background; a 429 there surfaces as an unhandled rejection.
// Every tx hash is saved before it is awaited, so log it and keep running.
process.on("unhandledRejection", (e: any) => log("warn", `RPC hiccup outside a tick (kept running): ${errText(e)}`));
setInterval(tick, config.pollIntervalSeconds * 1000);
tick();

/* ───────────────────────── price (for the $ over each head) ───────────────────────── */

/** USD per token and per ETH. Display only: nothing the engine does depends on it. */
const price = { tokenUSD: 0, ethUSD: 0, source: "", at: 0 };

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

async function refreshPrice() {
  try {
    const eth = await getJson("https://api.coinbase.com/v2/prices/ETH-USD/spot").catch(() => null);
    const ethUSD = parseFloat(eth?.data?.amount ?? "0") || (await getJson("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd").then((d) => d?.ethereum?.usd ?? 0).catch(() => 0));
    if (ethUSD > 0) price.ethUSD = ethUSD;
    if (!isAddr(config.tokenAddress)) return;
    const dex = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${config.tokenAddress}`).catch(() => null);
    const pair = (dex?.pairs ?? []).filter((p: any) => parseFloat(p?.priceUsd) > 0).sort((a: any, b: any) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0))[0];
    if (pair) {
      Object.assign(price, { tokenUSD: parseFloat(pair.priceUsd), source: "dexscreener", at: Date.now() });
      return;
    }
    // Still on the Pons curve: quote a tiny buy without sending it.
    if (isAddr(config.curveAddress) && price.ethUSD > 0 && provider) {
      const q = ethers.parseEther("0.0001");
      const from = wallet?.address || config.treasuryAddress || PONS_FEE_ESCROW;
      const curve = new ethers.Contract(config.curveAddress, CURVE_ABI, provider);
      const out: bigint = await curve.buy.staticCall(q, 0n, from, { value: q, from });
      const tokens = parseFloat(ethers.formatUnits(out, decimals));
      if (tokens > 0) Object.assign(price, { tokenUSD: (0.0001 / tokens) * price.ethUSD, source: "pons-curve", at: Date.now() });
    }
  } catch (e: any) {
    log("warn", `Price check failed: ${errText(e)}`);
  }
}
setInterval(refreshPrice, 60_000);
refreshPrice();

/* ───────────────────────── API ───────────────────────── */

function send(res: http.ServerResponse, code: number, data: unknown) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-secret",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

const fmt = (raw: string | bigint) => ethers.formatUnits(typeof raw === "bigint" ? raw : big(raw), decimals);
const ethOf = (raw: string | bigint) => ethers.formatEther(typeof raw === "bigint" ? raw : big(raw));

function roundRow(r: Round) {
  return {
    n: r.n,
    kind: r.kind,
    at: r.at,
    stage: r.stage,
    claimTx: r.claimTx,
    claimedETH: ethOf(r.claimedWei),
    spentETH: ethOf(r.payWei),
    buyTx: r.buyTx || "",
    tokensBought: fmt(r.tokensBought || "0"),
    tokensBurned: r.burnTx ? fmt(r.burnAmount || "0") : "0",
    burnTx: r.burnTx || "",
    tokensShared: fmt((r.drops || []).filter((d) => d.tx).reduce((a, d) => a + big(d.amount), 0n)),
    drops: (r.drops || []).filter((d) => d.tx).map((d) => ({ addr: d.addr, amount: fmt(d.amount), tx: d.tx })),
    treasuryETH: r.treasuryTx ? ethOf(r.keepWei || "0") : "0",
    treasuryTx: r.treasuryTx,
    tx: r.burnTx || r.buyTx || r.treasuryTx || "",
    doneAt: r.doneAt,
  };
}

/** nginx forwards the visitor's address in X-Real-IP; direct hits fall back to the socket. */
function clientIp(req: http.IncomingMessage) {
  const fwd = req.headers["x-real-ip"];
  return String((Array.isArray(fwd) ? fwd[0] : fwd) || req.socket.remoteAddress || "");
}

/** Reads a small JSON body (profiles are tiny; anything over 4 KB is refused). */
function readJson(req: http.IncomingMessage, res: http.ServerResponse, done: (d: any) => void) {
  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 4096) req.destroy();
  });
  req.on("end", () => {
    try {
      done(JSON.parse(body || "{}"));
    } catch {
      send(res, 400, { success: false, error: "Bad request." });
    }
  });
}

/** Every save needs the admin secret, the first one too, so nobody can lock in their own treasury before the creator. */
const isAdmin = (req: http.IncomingMessage) => !!process.env.ADMIN_SECRET && req.headers["x-admin-secret"] === process.env.ADMIN_SECRET;

function statusData() {
  const cz = citizens();
  return {
    online: true,
    townName: config.townName,
    ticker: config.ticker,
    status,
    walletAddress: wallet?.address || "",
    tokenAddress: config.tokenAddress,
    curveAddress: config.curveAddress,
    treasuryAddress: config.treasuryAddress,
    escrowETH: ethers.formatEther(escrowWei),
    price: { tokenUSD: price.tokenUSD, ethUSD: price.ethUSD, source: price.source, at: price.at },
    round: { thresholdETH: config.roundETH, burnPct: config.burnPct, rewardPct: config.rewardPct, treasuryPct: config.treasuryPct, topN: config.rewardTopN, minHoldMinutes: config.minHoldMinutes },
    rules: { minBalance: config.minBalance, minHoldMinutes: config.minHoldMinutes },
    supply: fmt(state.supply),
    counts: { citizens: cz.length, out: Object.values(state.holders).filter((h) => h.hopped).length },
    totals: {
      feesClaimedETH: ethOf(state.totals.feesClaimedWei),
      burnETH: ethOf(state.totals.burnWei),
      tokensBurned: fmt(state.totals.tokensBurned),
      tokensShared: fmt(state.totals.tokensShared),
      keeperETH: ethOf(state.totals.keeperWei),
    },
    rounds: state.rounds.filter((r) => r.stage === "done").length,
    lastIndexedBlock: state.lastIndexedBlock,
  };
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url || "/", "http://x");
  const p = url.pathname.replace(/\/$/, "");
  const now = Math.floor(Date.now() / 1000);

  if (req.method === "GET" && p === "/api/stream") {
    if (streams.size >= 2000) return send(res, 503, { success: false, error: "Too many live pages." });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 2000\n\n");
    streams.add(res);
    req.on("close", () => streams.delete(res));
    return;
  }

  if (req.method === "GET" && p === "/api/status") return send(res, 200, { success: true, data: { ...statusData(), logs: logs.slice(0, 40) } });

  /** Everything the town needs in one read: the citizens, who just left, the totals and the latest rounds. */
  if (req.method === "GET" && p === "/api/town") {
    const cz = citizens();
    return send(res, 200, {
      success: true,
      data: {
        now,
        status: statusData(),
        citizens: cz.slice(0, 600).map((c, i) => {
          const pr = profileOf(c.addr);
          // nicknames and looks are a top-10 privilege: shown only while the wallet is in the top 10
          return { addr: c.addr, balance: fmt(c.h.balance), firstIn: c.h.firstIn, rank: i < 10 ? i + 1 : 0, received: c.h.tokensReceived ? fmt(c.h.tokensReceived) : "0", nick: i < 10 ? pr?.name || "" : "", look: i < 10 ? pr?.look || null : null };
        }),
        // wallets that sold in the last 15 minutes: the town shows them riding out
        sold: Object.entries(state.holders).filter(([, h]) => h.hopped && now - h.hoppedAt < 900).map(([a, h]) => ({ addr: a, at: h.hoppedAt, tx: h.hoppedTx })),
        rounds: state.rounds.filter((r) => r.stage === "done").slice(0, 12).map(roundRow),
      },
    });
  }

  const w = p.match(/^\/api\/wallet\/(0x[0-9a-fA-F]{40})$/);
  if (req.method === "GET" && w) {
    const addr = lc(w[1]);
    const h = state.holders[addr];
    return send(res, 200, {
      success: true,
      data: { addr, status: standing(addr, h), balance: h ? fmt(h.balance) : "0", firstIn: h?.firstIn || 0, received: h?.tokensReceived ? fmt(h.tokensReceived) : "0", hoppedAt: h?.hoppedAt || 0, hoppedTx: h?.hoppedTx || "", rank: rankOf(addr), profile: profileOf(addr), lastIndexedBlock: state.lastIndexedBlock },
    });
  }

  if (req.method === "GET" && p === "/api/rounds") return send(res, 200, { success: true, data: state.rounds.slice(0, 60).map(roundRow) });

  if (req.method === "POST" && p === "/api/admin/save") {
    readJson(req, res, (d) => {
      try {
        if (!isAdmin(req)) return send(res, 403, { success: false, error: "Needs the admin secret. Paste ADMIN_SECRET from the server .env." });
        if (typeof d.tokenAddress === "string" && d.tokenAddress.trim() && lc(d.tokenAddress.trim()) !== lc(config.tokenAddress)) {
          if (!isAddr(d.tokenAddress)) throw new Error("Token address is not a valid address");
          config.tokenAddress = ethers.getAddress(d.tokenAddress.trim());
          config.curveAddress = "";
          config.startBlock = 0;
          resetStateForToken();
          log("info", `[CONFIG] Token set: ${config.tokenAddress}`);
        }
        if (typeof d.treasuryAddress === "string" && d.treasuryAddress.trim() && lc(d.treasuryAddress.trim()) !== lc(config.treasuryAddress)) {
          if (!isAddr(d.treasuryAddress)) throw new Error("Treasury address is not a valid address");
          config.treasuryAddress = ethers.getAddress(d.treasuryAddress.trim());
          log("info", `[CONFIG] Treasury set: ${config.treasuryAddress}`);
        }
        if (typeof d.privateKey === "string" && d.privateKey.trim()) {
          config.privateKey = d.privateKey.trim();
          initWallet();
          log("info", `[CONFIG] Operator key set. Wallet: ${wallet?.address || "invalid"}`);
        }
        saveConfig();
        push("town");
        return send(res, 200, { success: true, tokenAddress: config.tokenAddress, treasuryAddress: config.treasuryAddress, walletAddress: wallet?.address || "" });
      } catch (e: any) {
        return send(res, 400, { success: false, error: e.message });
      }
    });
    return;
  }

  /* ───────── profiles: a top-10 holder signs a message to set their nickname and look ───────── */

  if (req.method === "GET" && p === "/api/profile/nonce") {
    const addr = url.searchParams.get("addr") || "";
    if (!isAddr(addr)) return send(res, 400, { success: false, error: "That isn't a wallet address." });
    if (rateLimited(clientIp(req))) return send(res, 429, { success: false, error: "Too many tries. Wait a minute." });
    const { nonce, expiresAt } = issueNonce(addr);
    return send(res, 200, { success: true, data: { nonce, expiresAt } });
  }

  /** The exact text to sign for a given nickname and look (the page shows it, the wallet signs it). */
  if (req.method === "POST" && p === "/api/profile/message") {
    readJson(req, res, (d) => {
      if (typeof d.addr !== "string" || !isAddr(d.addr) || typeof d.nonce !== "string") return send(res, 400, { success: false, error: "Bad request." });
      return send(res, 200, { success: true, data: { message: profileMessage(lc(d.addr), typeof d.name === "string" ? d.name.replace(/\s+/g, " ").trim() : "", lookText(d.look || undefined), d.nonce) } });
    });
    return;
  }

  if (req.method === "POST" && p === "/api/profile") {
    if (rateLimited(clientIp(req))) return send(res, 429, { success: false, error: "Too many tries. Wait a minute." });
    readJson(req, res, (d) => {
      const out = claimProfile(
        d,
        (addr) => standing(addr, state.holders[addr]) === "citizen",
        (addr, name, look) => rankAllows(rankOf(addr), name, look),
      );
      if (out.error) return send(res, 400, { success: false, error: out.error });
      log("info", `[PROFILE] ${String(d.addr).slice(0, 8)}… dressed up${out.profile?.name ? ` as "${out.profile.name}"` : ""}`);
      push("town");
      return send(res, 200, { success: true, data: out.profile });
    });
    return;
  }

  if (req.method === "POST" && p === "/api/admin/profile/remove") {
    if (!isAdmin(req)) return send(res, 403, { success: false, error: "Admin secret required." });
    readJson(req, res, (d) => {
      if (typeof d.addr !== "string" || !isAddr(d.addr)) return send(res, 400, { success: false, error: "That isn't a wallet address." });
      const had = removeProfile(d.addr);
      log("info", `[PROFILE] removed for ${d.addr.slice(0, 8)}…`);
      push("town");
      return send(res, 200, { success: true, data: { removed: had } });
    });
    return;
  }

  return send(res, 404, { success: false, error: "Not Found" });
});

server.listen(config.port, "127.0.0.1", () => {
  log("info", `${config.ticker} engine API on 127.0.0.1:${config.port} · ${isAddr(config.tokenAddress) ? `token ${config.tokenAddress}` : "STANDBY (set the token in /memex)"}`);
});
