// A stand-in for the engine API, for building and testing the page before launch.
//   node tools/fake-engine.mjs [port=5393] [citizens=40]
// Serves /api/town, /api/status and /api/stream with sample citizens, and lets you poke it:
//   curl -X POST localhost:5393/fake/round   a full engine round (burn, top 10 share, treasury)
//   curl -X POST localhost:5393/fake/buy     a new citizen moves in
//   curl -X POST localhost:5393/fake/sell    a random citizen sells and leaves
//   curl -X POST 'localhost:5393/fake/add?addr=0x…&balance=500000'   make a test wallet a citizen
import http from "http";
const PORT = +(process.argv[2] || 5393), N = +(process.argv[3] || 40);
const now = () => Math.floor(Date.now() / 1000);
const hex = () => "0x" + [...Array(40)].map(() => "0123456789abcdef"[(Math.random() * 16) | 0]).join("");
const cits = [];
for (let i = 0; i < N; i++) cits.push({ addr: hex(), balance: Math.round(100000 + Math.pow(Math.random(), 3) * 30e6), firstIn: now() - Math.round(Math.random() * 5 * 3600) });
const sold = [], rounds = [];
const totals = { feesClaimedETH: "0", burnETH: "0", tokensBurned: "0", tokensShared: "0", keeperETH: "0" };
let supply = 1e9, burned = 0, shared = 0, keeper = 0, n = 0;
const streams = new Set();
const push = () => { for (const r of streams) r.write("event: town\ndata: {}\n\n"); };
const ranked = () => cits.slice().sort((a, b) => b.balance - a.balance).map((c, i) => ({ ...c, balance: String(c.balance), rank: i < 10 ? i + 1 : 0, received: String(c.received || 0), nick: "", look: null }));
function status() {
  return { online: true, townName: "Test Town", ticker: "$TEST", status: "idle", walletAddress: "0x0000000000000000000000000000000000000001", tokenAddress: "0x00000000000000000000000000000000000000aa", curveAddress: "", treasuryAddress: "0x0000000000000000000000000000000000000002", escrowETH: "0.0", price: { tokenUSD: 0.00002, ethUSD: 3000, source: "fake", at: now() }, round: { thresholdETH: "0.02", burnPct: 30, rewardPct: 35, treasuryPct: 35, topN: 10, minHoldMinutes: 10 }, rules: { minBalance: "100000", minHoldMinutes: 10 }, supply: String(supply), counts: { citizens: cits.length, out: sold.length }, totals: { ...totals, tokensBurned: String(burned), tokensShared: String(shared), keeperETH: String(keeper) }, rounds: rounds.length, lastIndexedBlock: 1 };
}
function round() {
  n++;
  const bought = 2e6 + Math.random() * 4e6, burn = bought * 30 / 65, share = bought - burn;
  const top = ranked().slice(0, 10).filter((c) => now() - c.firstIn >= 600);
  const sum = top.reduce((a, c) => a + +c.balance, 0) || 1;
  const drops = top.map((c) => ({ addr: c.addr, amount: String(Math.round(share * +c.balance / sum)), tx: "0x" + n.toString(16).padStart(64, "0") }));
  for (const d of drops) { const c = cits.find((x) => x.addr === d.addr); c.balance += +d.amount; c.received = (c.received || 0) + +d.amount; }
  burned += top.length ? burn : bought; shared += top.length ? share : 0; keeper += 0.007; supply -= top.length ? burn : bought;
  rounds.unshift({ n, kind: "town", at: now(), stage: "done", claimTx: "0x1", claimedETH: "0.02", spentETH: "0.013", buyTx: "0x2", tokensBought: String(bought), tokensBurned: String(top.length ? burn : bought), burnTx: "0x3", tokensShared: String(top.length ? share : 0), drops, treasuryETH: "0.007", treasuryTx: "0x4", tx: "0x3", doneAt: now() });
}
const send = (res, code, j) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(j)); };
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), p = u.pathname;
  if (p === "/api/stream") { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" }); res.write("retry: 2000\n\n"); streams.add(res); req.on("close", () => streams.delete(res)); return; }
  if (p === "/api/status") return send(res, 200, { success: true, data: { ...status(), logs: [] } });
  if (p === "/api/town") return send(res, 200, { success: true, data: { now: now(), status: status(), citizens: ranked(), sold: sold.filter((s) => now() - s.at < 900), rounds: rounds.slice(0, 12) } });
  if (p.startsWith("/api/wallet/")) { const a = p.split("/").pop().toLowerCase(), c = cits.find((x) => x.addr === a); return send(res, 200, { success: true, data: { addr: a, status: c ? "citizen" : sold.find((s) => s.addr === a) ? "out" : "none", balance: String(c ? c.balance : 0), firstIn: c ? c.firstIn : 0 } }); }
  if (req.method === "POST" && p === "/fake/round") { round(); push(); return send(res, 200, { ok: true, n }); }
  if (req.method === "POST" && p === "/fake/buy") { const c = { addr: hex(), balance: Math.round(150000 + Math.random() * 3e6), firstIn: now() }; cits.push(c); push(); return send(res, 200, { ok: true, addr: c.addr }); }
  if (req.method === "POST" && p === "/fake/sell") { const i = (Math.random() * cits.length) | 0, c = cits.splice(i, 1)[0]; if (c) sold.push({ addr: c.addr, at: now(), tx: "0x5" }); push(); return send(res, 200, { ok: true, addr: c && c.addr }); }
  if (req.method === "POST" && p === "/fake/add") { const a = (u.searchParams.get("addr") || "").toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(a)) return send(res, 400, { ok: false }); const c = cits.find((x) => x.addr === a) || (cits.push({ addr: a, balance: 0, firstIn: now() - 3600 }), cits[cits.length - 1]); c.balance = +(u.searchParams.get("balance") || 500000); push(); return send(res, 200, { ok: true }); }
  send(res, 404, { success: false });
}).listen(PORT, "127.0.0.1", () => console.log(`fake engine on 127.0.0.1:${PORT} with ${N} sample citizens`));
