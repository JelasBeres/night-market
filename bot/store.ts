/**
 * Persistent config + state for a holder-town engine (name and ticker come from TOWN_NAME / TICKER).
 * bot-config.json holds operator settings (incl. the private key, never served by the API).
 * bot-state.json holds the indexer, holder book, rounds and totals.
 */
import fs from "fs";
import path from "path";

const CONFIG_FILE = path.resolve(process.cwd(), "bot-config.json");
const STATE_FILE = path.resolve(process.cwd(), "bot-state.json");
const LOGS_FILE = path.resolve(process.cwd(), "bot-logs.json");

// Native .env parser, same as the other engines (no dotenv dependency).
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {}

export interface Config {
  /** Shown in logs and texts, e.g. "Red Dome" and "$DOME". */
  townName: string;
  ticker: string;
  rpcUrl: string;
  privateKey: string;
  tokenAddress: string;
  curveAddress: string;
  treasuryAddress: string;
  /** Extra addresses that count as "selling" when the token is sent to them (DEX pool / PoolManager). */
  sellSinks: string[];
  /** Any transfer of the token into a contract counts as a sell (except excluded addresses). */
  contractsAreSells: boolean;
  /** Escrow size (ETH) that triggers a round. Every round does all three: burn, council reward, treasury. */
  roundETH: string;
  /** How a round is split, in percent (must add up to 100). */
  burnPct: number;
  rewardPct: number;
  treasuryPct: number;
  /** The council: how many of the biggest citizens share the reward. */
  rewardTopN: number;
  /** Minutes a wallet must have held before it can take part in a reward. */
  minHoldMinutes: number;
  /** Minimum balance (whole tokens) to live in town. */
  minBalance: string;
  pollIntervalSeconds: number;
  port: number;
  /** Block the token was deployed in; auto-detected when 0. */
  startBlock: number;
}

const env = process.env;

export const config: Config = {
  townName: env.TOWN_NAME || "Holder Town",
  ticker: env.TICKER || "$TOKEN",
  rpcUrl: env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  privateKey: env.CREATOR_PRIVATE_KEY || env.PRIVATE_KEY || "",
  tokenAddress: env.TOKEN_ADDRESS || "",
  curveAddress: env.CURVE_ADDRESS || "",
  treasuryAddress: env.TREASURY_ADDRESS || "",
  sellSinks: (env.SELL_SINKS || "").split(",").map((s) => s.trim()).filter(Boolean),
  contractsAreSells: env.CONTRACTS_ARE_SELLS !== "0",
  roundETH: env.ROUND_ETH || "0.02",
  burnPct: parseFloat(env.BURN_PCT || "30"),
  rewardPct: parseFloat(env.REWARD_PCT || "35"),
  treasuryPct: parseFloat(env.TREASURY_PCT || "35"),
  rewardTopN: parseInt(env.REWARD_TOP_N || "10", 10),
  minHoldMinutes: parseFloat(env.MIN_HOLD_MINUTES || "10"),
  minBalance: env.MIN_BALANCE || "100000",
  pollIntervalSeconds: parseInt(env.POLL_INTERVAL_SECONDS || "3", 10),
  port: parseInt(env.PORT || "5293", 10),
  startBlock: parseInt(env.START_BLOCK || "0", 10),
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    for (const key of Object.keys(config) as (keyof Config)[]) {
      if (saved[key] !== undefined && saved[key] !== "") (config as any)[key] = saved[key];
    }
  } catch (e: any) {
    console.error("bot-config.json unreadable, using env defaults:", e.message);
  }
}

export function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export interface Holder {
  /** Raw token units, as a decimal string. */
  balance: string;
  /** Unix seconds of the first incoming transfer: the house grows from here. */
  firstIn: number;
  /** Sold once: out of town for good. */
  hopped: boolean;
  hoppedAt: number;
  hoppedTx: string;
  /** Tx of the latest incoming transfer (spots routers that pass tokens straight through). */
  lastInTx?: string;
  /** A contract that only relays the token within one transaction (router, aggregator). Never a citizen. */
  relay?: boolean;
  /** Raw the token received as council rewards. */
  tokensReceived?: string;
}

if (Math.abs(config.burnPct + config.rewardPct + config.treasuryPct - 100) > 0.001) throw new Error("BURN_PCT + REWARD_PCT + TREASURY_PCT must add up to 100");

/** One council reward transfer. */
export interface Drop {
  addr: string;
  /** Raw balance when the split was made. */
  balance: string;
  amount: string;
  tx: string;
  counted?: boolean;
}

/**
 * One engine run: claim the escrow, then in one go buy the token once with the burn and reward
 * parts, burn the burn part, share the reward part with the council, and send the rest to the treasury.
 */
export interface Round {
  n: number;
  kind: "town";
  at: number;
  stage: "claiming" | "claimed" | "done" | "failed";
  claimTx: string;
  claimedWei: string;
  /** ETH this round spends (claimed, capped by what the wallet can spare after gas). */
  payWei: string;
  /** The part of payWei that buys the token (burn + reward), and the part for the treasury. */
  buyWei?: string;
  keepWei?: string;
  /** The buy, what the wallet held just before it (never touched), and what it bought. */
  buyTx?: string;
  heldBefore?: string;
  tokensBought?: string;
  /** Of what was bought: the amount burned and the burn transfer. */
  burnAmount?: string;
  burnTx?: string;
  /** Of what was bought: the council's share, one transfer per wallet. */
  drops?: Drop[];
  treasuryTx: string;
  doneAt: number;
  /** Which confirmed steps are already in the totals. */
  counted?: { claim?: boolean; keeper?: boolean; buy?: boolean; burn?: boolean };
}

export interface State {
  lastIndexedBlock: number;
  holders: Record<string, Holder>;
  /** Cache: address -> has contract code. */
  isContract: Record<string, boolean>;
  rounds: Round[];
  /** Raw total supply, read from the token. */
  supply: string;
  totals: {
    feesClaimedWei: string;
    /** ETH spent on buys (burn + reward parts). */
    burnWei: string;
    tokensBurned: string;
    tokensShared: string;
    keeperWei: string;
  };
}

const freshTotals = () => ({ feesClaimedWei: "0", burnWei: "0", tokensBurned: "0", tokensShared: "0", keeperWei: "0" });

export const state: State = {
  lastIndexedBlock: 0,
  holders: {},
  isContract: {},
  rounds: [],
  supply: "0",
  totals: freshTotals(),
};

if (fs.existsSync(STATE_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    Object.assign(state, saved);
    state.rounds ||= [];
    state.supply ||= "0";
    state.totals = { ...freshTotals(), ...saved.totals };
  } catch (e: any) {
    console.error("bot-state.json unreadable, starting fresh:", e.message);
  }
}

let saveTimer: NodeJS.Timeout | null = null;
/** Write state now (sync), used around every on-chain send so a crash never double-sends. */
export function saveStateNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state), "utf-8");
  fs.renameSync(tmp, STATE_FILE);
}
export function saveStateSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveStateNow, 1500);
}

export function resetStateForToken() {
  state.lastIndexedBlock = 0;
  state.holders = {};
  state.isContract = {};
  state.rounds = [];
  state.supply = "0";
  state.totals = freshTotals();
  saveStateNow();
}

export interface LogLine {
  t: number;
  type: "info" | "success" | "warn" | "error";
  msg: string;
}

export const logs: LogLine[] = (() => {
  try {
    const saved = JSON.parse(fs.readFileSync(LOGS_FILE, "utf-8"));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
})();

export function log(type: LogLine["type"], msg: string) {
  const line = { t: Math.floor(Date.now() / 1000), type, msg };
  logs.unshift(line);
  if (logs.length > 120) logs.length = 120;
  console.log(`[${new Date().toISOString()}] [${type.toUpperCase()}] ${msg}`);
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs), "utf-8");
  } catch {}
}
