# Holder-town kit

The shared base for every holder-town project. The rules match Sprout Town's live engine.

## What's in it

- **`bot/town-engine.ts`** (with `store.ts`, `profile.ts`, `uniswap-v4.ts`): the engine. Do not change its logic. It reads `TOWN_NAME` and `TICKER` from `.env`. On Robinhood Chain via Pons it:
  - indexes holders; a wallet that sells once is out for good;
  - runs one round every `ROUND_ETH` (0.02) of fees:
    - claim the fees;
    - buy the token back once;
    - burn 30%;
    - share 35% with the top 10 by balance who have held 10 min or more;
    - send 35% as ETH to the treasury.
- **`bot/town-live.ts`**: the live server (one shared world). It reads citizens from the engine's `/api/town` and `bot/world.json` (the path graph):
  - The server owns every citizen's position. Offline citizens are bots it walks around, and they greet and poke each other. When a player punches, hugs or high-fives a bot, the bot reacts.
  - A connected wallet goes online right away, with no signature, and takes over its own citizen. A wallet that is not a holder walks in as a visitor.
  - Chat and speeches ask for one free signature the first time.
  - Plot numbers are handed out in move-in order and are the same on every screen.
  - It also provides the server clock.
- **`client/live.js`**: a framework-free browser module.
  - `createLive({...callbacks, getMe})` is the WebSocket link. It holds `live.ents` (id → `{a, rx, rz, ry, moving, on, v}`), and `tick(dt)` interpolates them. Calls: `claim(addr)`, `emote(k, toAddr)`, `chat(text)`, `speech(on)`, `say(text)`, `logout()`.
  - `createTown({onTown})` reads `/api/town` on load, every 15 s, and on each SSE push. It gives balances, ranks, rounds and recent sells.
  - Helpers: `connectWallet()`, `knownWallet()`, `levelOf(firstIn, nowSec)` (home level 1..8, one level per 10 min), `buyUrl(ca)`, `short(addr)`, `CHAIN`.
- **`memex.html`**: the admin page (token, treasury, operator key, ADMIN_SECRET).
- **`scripts/install-server.sh`**: installs on the VPS: nginx with `/api` and `/ws`, plus two pm2 processes.
- **`tools/fake-engine.mjs`**: a stand-in engine with sample citizens, for building and testing before launch. Use `POST /fake/round`, `/fake/buy`, `/fake/sell`, and `/fake/add?addr=&balance=`.

## Live server messages (server → page)

| Message | Meaning |
|---|---|
| `hi` | Every entity, the plot map, and any running speech. |
| `join {id,a,x,z,y,on,v,arrive?}` | A new entity. `arrive: 1` means a newcomer walking in from the spawn. |
| `gone {id,a,why}` | An entity left. `why` is `sold`, `left` or `link`. |
| `st {id,a,on,v}` | Online or visitor status changed. |
| `p {l:[[id,x,z,yaw],...]}` | Positions, about 7 times a second. |
| `e {id,k,to?}` | An emote. Partner moves (`punch`, `hug`, `hi5`) carry the target's address. |
| `bub {id,text}` | A bot's speech bubble. |
| `chat {id,a,text}` | A chat line. |
| `speech {on,a}` | A speech starts or ends. |
| `say {a,text}` | A line of the speech. |
| `slots {slots:{addr:k}}` | Plot numbers changed. |
| `note {text}` | A message to show the user (a toast). |

## How a page uses it (the rules every project follows)

1. **One world for everyone.** In the live page, NEVER simulate citizens locally: every visible citizen comes from `live.ents`. Each frame, place each entity's character at `(rx, rz)` with rotation `ry`, and play the walk animation when `moving` is set.
2. **Labels.** Each citizen's label shows the short address and the rank badge for the top 10. It also shows a status tag:
   - green dot plus "online" while `on`;
   - grey dot plus "offline" otherwise. Offline citizens still walk, because the server moves them as bots.
   - Visitors show "visitor".
3. **Your citizen.** After `live.claim(addr)`, the `onAuth` callback gives your `id` and the start position `x, z` (where your bot stood). The page drives your citizen locally with keyboard, joystick and click-to-walk, does collisions on its own map, and returns `{x, z, yaw}` from `getMe()`. Hide your own entity in the ents loop (`e.id === live.S.id`), since you draw it yourself.
4. **Interactions.**
   - On a key or button press, play the move locally, then call `live.emote(kind, targetAddr)`. Target the nearest entity within about 2.8 units.
   - On `onEmote(e, k, to)`:
     - play the pose on `e`;
     - if `to` is your address, play the hit or hug on your own citizen and knock it back on a punch;
     - if `to` is another entity, play the reaction on that entity.
   - On `onBubble` and `onChat`, show a speech bubble over the entity.
5. **Homes.**
   - Every holder has a home on plot number `slots[addr]`. Plot k is `world.json` `plots[k]`, and its door is where bots go home.
   - Level = `levelOf(firstIn, now)` from `createTown` data (8 levels, one per 10 min held).
   - The top 10 may have special homes (`world.json` `ranks`).
   - Sold homes play the lore's sell moment, then empty the plot 20 s later.
6. **Engine rounds.** On each new round in `onTown` data (`rounds[].n` greater than the last seen), play the three effects:
   - burn: `tokensBurned`;
   - share: `drops[]` → each `{addr, amount}` lands on that citizen's home;
   - treasury: `treasuryETH`.
   - Treasury milestones come from `status.totals.keeperETH`: 0.25 / 0.5 / 1 / 2 / 3 ETH. Each one visibly builds the world.
   - Recent sells come from `sold[]`.
7. **Pre-launch.** If `status.tokenAddress` is empty, show a "coming soon" panel. The world still renders, with no citizens.
8. **Demo mode.** `?demo` keeps the preview's sample town and local simulation, for content capture. Everything else is live.
9. **Wording.** Never write "yield", "APY", "passive income", price promises, "honeypot" or "bank". No emoji in UI text (use small inline SVG icons). Original art only.

## `bot/world.json`

The page builds its world, then exports the walkable path graph from it. Use a small script with Playwright: `window.__world()` returns the JSON, and you save it to `bot/world.json`.

```json
{
  "nodes": [[x, z], ...],
  "edges": [[i, j], ...],
  "plots": [[doorX, doorZ], ...],
  "ranks": {"1": [x, z], ...},
  "spawn": [x, z],
  "podium": [x, z],
  "crowd": {"x": 0, "z": 0, "w": 20, "d": 10},
  "bounds": {"x0": -250, "x1": 250, "z0": -250, "z1": 250}
}
```

- **`nodes` / `edges`**: points on roads and paths, and the straight walks between them that do not cross a building.
- **`plots`**: the doors in move-in order. The order must match the page's own plot order: plot k in the page is `plots[k]`.
- **`ranks`**: the doors of the top 10's special homes, by rank.

## Dev

Run each piece in its own terminal (background):

```bash
npm ci
node tools/fake-engine.mjs 5393 40                                  # engine stand-in
ENGINE_URL=http://127.0.0.1:5393 LIVE_PORT=5296 npx tsx bot/town-live.ts
ENGINE_PORT=5393 LIVE_PORT=5296 npx vite --port 5292                # page at http://localhost:5292/
```

For real-speed tests on this Mac, use headless Chromium with `--use-gl=angle --use-angle=metal`. Mock `window.ethereum` with an ethers wallet: `eth_requestAccounts` returns the test address, and `personal_sign` uses `wallet.signMessage(getBytes(hex))`.
