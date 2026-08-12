# Maniphest — Locked Design

Status: **locked** as of 2026-08-13. Supersedes the open questions in `DESIGN_BRIEF.md`.
Design principles #1–#7 in the brief remain normative and are referenced by number throughout.

---

## 1. What this game is

Single-player, headless-first space trade and economy simulation. The player commands one vessel,
explores outward from a home system, hauls goods between markets, invests in refining
infrastructure, and risks pirate attrition on every jump. 2D top-down map and management UI come
last; the simulation must be proven interesting before a renderer exists.

The spine of the game is a single tension: **fuel is finite, the good routes are dangerous, and the
profitable cargo is somewhere you have not scouted yet.**

---

## 2. Locked decisions

Carried forward from the brief:

| Decision | Choice |
|---|---|
| Language | TypeScript, strict mode |
| Sim core | Pure headless module, zero renderer imports |
| Renderer (later) | PixiJS, star map only |
| UI (later) | Vue for management screens |
| Persistence | Seed + player deltas as JSON |
| Database | None |
| Desktop shell | Deferred |

Resolved this session:

| # | Question | Answer |
|---|---|---|
| 1 | Time model | **Action-based discrete clock.** Each action advances a tick counter by a variable duration. |
| 2 | Holdings | **One vessel.** No fleet, no automated routes, through M3. |
| 3 | Fail state | **Costly rescue / insurance.** No permadeath. |
| 4 | Session length | **Multi-hour.** ~100+ actions per session; a vessel-class upgrade is roughly one session's work. |
| 5 | Galaxy scale | **Effectively unbounded.** Infinite outward generation, nothing stored until visited. |
| 6 | Planets | **Investable now** (refineries without ownership); ownership deferred to M3+. |
| 7 | Combat | **Option (b).** Pirates are an attrition risk. No combat minigame. |
| 8 | Idling | Waiting is a legal action, advances the clock, and costs upkeep per time unit. |
| 9 | Fuel | Sold only at systems with a fuel depot (~40%, hash-derived, revealed by visit or scan). |
| 10 | Money | Single currency. No debt, no credit. |

---

## 3. Time model

The clock is an integer `tick` in state. Every action declares a duration:

| Action | Duration |
|---|---|
| `JUMP(target)` | `ceil(distance / jumpSpeed)`, hazard-modified |
| `DOCK` / `UNDOCK` | 1 |
| `BUY` / `SELL` | 0 |
| `REFUEL` / `REPAIR` | 1 |
| `SCAN` | 2 |
| `WAIT(n)` | `n` |
| `BUILD_REFINERY` | 24 |

Time-driven processes are **evaluated lazily, never simulated globally.** Each market and each
refinery stores the tick at which it was last touched; when the player interacts with it, the sim
advances that entity forward by `now - lastTouched` in closed form. Nothing iterates over the
galaxy per tick, so an unbounded galaxy costs nothing to leave running.

Upkeep (life support, docking fees) is charged the same way: against elapsed ticks, at the moment
credits are next read or spent.

---

## 4. Determinism model

Two distinct randomness mechanisms. Conflating them is the single most likely way to break this
codebase.

**World randomness — stateless, position-keyed.**

```
worldRng(worldSeed, domain: string, ...coords: number[]) => Rng
```

Implemented as a hash (splitmix64-style avalanche) over the seed, a domain tag, and the
coordinates. No stream, no state, no ordering dependency. Domains: `'sector'`, `'system'`,
`'planets'`, `'pirates'`, `'hazard'`, `'depot'`, `'find'`. Because it is stateless, system
`(12, -4)` has identical contents whether it is the first or the four-hundredth system visited.
This is what makes "the same seed always yields the same galaxy" true.

**Event randomness — stateful stream.**

`state.rng = { seed, counter }`, advanced only during action resolution (encounter rolls, cargo
loss, loot). Serialized with the save. This is what makes the action log replayable.

**Enforcement:**

- `Math.random` is banned in `packages/sim`. Enforced by a lint rule *and* a test that greps the
  built output, so the ban survives a lint config regression.
- A replay test asserts that `seed + ordered action log` reproduces a byte-identical state
  snapshot.

---

## 5. Persistence

Two artifacts with different jobs, resolving the brief's contradiction:

- **Save file** = `{ version, worldSeed, tick, rng, deltas }`. Deltas only: discovered system ids,
  market stock overrides, built refineries, consumed one-off finds, vessel and cargo state,
  credits. Generated content is never written. O(1) to load regardless of playtime.
- **Action log** = a debug and bug-reproduction artifact, written alongside but never required to
  load a save. Replay-equivalence between the two is enforced by a test, not relied upon at runtime.

Rationale: an action log as the primary format makes load time grow with playtime, which is
unacceptable for multi-hour sessions. A snapshot alone cannot reproduce a bug. Keeping both, with
only one on the load path, gets both properties.

---

## 6. Space, and why it is lumpy (principles #1, #2)

Systems live on a sparse lattice. Space is divided into 16×16 sector cells; for each cell,
`worldRng(seed, 'sector', sx, sy)` derives 0–3 system positions with jitter. Existence is derived,
never stored. Coordinates are unbounded integers; there is no boundary check.

Four generation axes, only the last of which touches distance:

- **Axis A — composition.** Star class and planet types are hash-derived per system and drive
  resource profiles. A dull star two jumps out and a dull star forty jumps out are equally dull;
  a rich one is equally rich. **Resource richness is not correlated with distance at all.**
- **Axis B — pirate pressure.** A multi-octave value-noise field over the lattice, thresholded into
  clear space, corridors, and nests. Distance contributes a deliberately weak additive term:
  `pressure = 0.85 * noise(x, y) + 0.15 * min(1, dist / 400)`. A route through a corridor is short
  and dangerous; going around is three jumps of fuel you may not have. That is the choice
  principle #1 exists to create.
- **Axis C — hazards.** Blob-noise regions: nebulae (blind sensors, +fuel), radiation belts (hull
  damage per tick), gravity wells (+time). Independent of both A and B, so a rich system can sit
  behind a hazard rather than behind a distance.
- **Axis D — one-off finds.** Derelicts and anomalies, hash-keyed per system, single-use, recorded
  in `consumedFinds`. Rewards scouting specifically, as opposed to hauling.

Distance's *only* systemic effect is a weak availability threshold on exotic materials. "Far" and
"rich" are not synonyms, which is the entire point of principle #2.

---

## 7. Economy (principle #3)

**M0 uses static prices deliberately** — two markets, one good, fixed spread. Slice 0 is testing
whether fuel scarcity and cargo risk are tense, not whether the market is deep. Static prices there
are a scoping decision, not an oversight.

**M1 replaces them with one formula** covering price decay, recovery, and local shortages:

```
price(good, market) = base(good) * clamp((target / stock) ^ elasticity, floorMul, ceilMul)
```

Selling raises `stock` and pushes price down; buying lowers it and pushes price up. Stock relaxes
toward `target` over elapsed time:

```
stock += (target - stock) * (1 - exp(-k * dt))
```

Evaluated lazily per §3. `target` and `elasticity` vary per market from Axis A, so shortages are a
property of place, not a random event. One formula satisfies the "better" tier of principle #3
rather than the minimum viable one.

**Refining and the home region (principle #7).** Raw goods refine into higher-value goods at
player-built refineries. Refined goods are only absorbed in volume by populated core markets, and
refineries need a steady input feed. The intended loop is therefore: **scout far, haul raw inward,
refine, sell refined near home.** Value flows toward origo instead of away from it, so the home
region stays load-bearing rather than becoming a commute.

---

## 8. Fuel, stranding, and rescue (principle #5)

```
fuelCost(jump) = distance * hull.fuelPerUnit / efficiency * hazardMultiplier
```

Fuel is sold only at depot systems. Whether a system has a depot is hash-derived and revealed by
visiting or scanning it — so knowing where you can refuel is itself scouting knowledge.

**Stranded** = docked or adrift with insufficient fuel for any legal jump, and not at a depot.
Resolution: a rescue tow, which costs **all cargo plus a percentage of credits** and delivers the
player to the nearest depot system. Hull damage is *not* cleared, and hull can only be fully
repaired in core systems — so the real cost of a bad run is a forced journey home, not a number on
a ledger.

An insurance policy (M1) can be bought in advance to reduce the credit share. It is a recurring
cost, so carrying it is itself an economic decision.

---

## 9. Pirates as attrition (principle #4b)

No combat minigame. On each jump, encounter probability is sampled from the pressure field along
the route and modulated by sensor range and jump speed. If an encounter fires, one roll produces an
outcome bundle: cargo percentage lost, hull damage, fuel siphoned. Severity scales with local
pressure and inversely with weapon, shield, and hull.

All player agency sits *before* the roll: which route, how much cargo to expose, whether to carry
insurance, which hull to fly, whether to spend two extra jumps avoiding a corridor. This is the
honest version of principle #4 — rather than dressing a stat check in three rounds of buttons, the
decision is moved to where the player actually has information.

---

## 10. Vessels and modules (principle #6) — M3

Classes use nautical naming: shuttle, courier, corvette, freighter, frigate, hauler, cruiser.
Each class is a **profile, not a rung**: cargo, fuel capacity, efficiency, hull, shield, weapon,
sensor range, jump speed, module slots, upkeep.

Two rules, both enforced by tests rather than by good intentions:

- **Non-dominance.** No class may be better than a cheaper class on every attribute. Each class
  must be strictly worse on at least two. A test enumerates all pairs and fails on any dominating
  pair. This is how principle #6 stops being a wish.
- **Load-bearing attributes.** Every attribute must be referenced by at least one decision formula
  (fuel cost, encounter probability, severity, capacity, time). A test enumerates the attribute
  list against formula references and fails on any attribute that affects nothing.

Upgrades have diminishing returns — gain `~ n^0.6`, cost `~ n^1.8` — so there is a soft cap that
pushes the player toward changing hull rather than perfecting one. High tiers require exotic
materials *and* bulk common ones.

---

## 11. Architecture

```
packages/
  sim/        Pure TypeScript. No DOM, no Pixi, no Vue, no I/O, no Math.random.
  harness/    Bot runner + balance analysis. Depends on sim.
  app/        (M4 — does not exist yet) Vue + Pixi. Depends on sim.
```

`sim` exposes `reduce(state, action) => state` plus pure selectors for read models. Actions are
plain serializable objects. The harness is a first-class deliverable: it runs thousands of actions
of scripted policies and reports wealth curves, route dominance, stranding rates, and time-to-afford
per vessel class.

---

## 12. The Slice 0 verdict, made testable

The brief's success test — "is *do I jump one more system out?* tense?" — is a subjective judgement,
which cannot coexist with "validated by bots, not playtesting." Operationalised:

Run policies `greedy` (always take the best visible margin), `cautious` (never drop below a fuel
reserve), and `randomWalk` across ≥200 seeds. Slice 0 **passes** if all three hold:

1. **No dominant policy.** Neither greedy nor cautious wins median wealth on more than ~65% of
   seeds. If one always wins, the decision has a correct answer and is therefore not a decision.
2. **Stranding is live but not fatal.** Greedy strands on 15–40% of seeds. Below 15%, fuel is
   set dressing; above 40%, it is a tax rather than a gamble.
3. **Caution has a price.** Cautious strands rarely but earns materially less than surviving greedy
   runs — otherwise safety is free and there is nothing to weigh.

If Slice 0 fails, the answer is to change the numbers or kill the project — **not** to add ship
classes, modules, or procedural variety on top.

---

## 13. Non-goals

Explicitly out of scope: fleets, automated trade routes, combat minigame, permadeath, multiple
factions, diplomacy, reputation, planet ownership before M3, SQLite or any database, Electron or
Tauri, 3D, multiplayer, animation beyond a sprite gliding between points.

---

## 14. Tracked risks

- **Rescue severity decays with wealth.** A percentage haircut stings at hour one and is trivial at
  hour twenty. Partially mitigated by non-field-repairable hull damage. Needs a harness metric on
  late-game rescue cost as a share of income, and possibly an escalating insurance premium.
- **No permadeath + unbounded galaxy + multi-hour sessions is a grind risk.** Nothing forces a run
  to end, so vessel classes carry the entire progression spine. If the harness shows wealth growing
  monotonically without meaningful decisions, this needs a real answer.
- **An unbounded galaxy has no completion goal.** Acceptable for a management game, but it means
  goals must come from the economy, not the map.
- **Lazy time evaluation is subtle.** Any entity that gains time-driven behaviour must also gain a
  `lastTouched` tick, or it silently freezes. Needs a test per time-driven entity type.
