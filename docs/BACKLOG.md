# Maniphest — Issue Backlog

Derived from `DESIGN.md`. Milestones are strictly ordered. **M0 is executable top-to-bottom with no
renderer work.** Each issue is scoped to one Claude Code session.

Nothing in this backlog is started until the backlog itself is approved.

---

## M0 — Slice 0

Goal: answer the one question that decides whether this project is worth building. Fuel-limited
travel, one good, two markets, cargo-loss risk, stranding fail state, bot verdict. No procgen, no
vessel classes, no renderer.

### [M0-01] Monorepo scaffold: sim and harness packages
**Type:** chore | **Depends on:** —
**Description:** Create the two-package workspace with TypeScript in strict mode and a test runner, so
that every later issue has somewhere to land. `sim` must have no dependency capable of touching the
DOM or the filesystem.
**Acceptance criteria:**
- [ ] `packages/sim` and `packages/harness` exist; `packages/app` does not
- [ ] TypeScript strict mode on, build passes with zero errors
- [ ] `harness` imports `sim`; `sim` imports nothing from `harness`
- [ ] A trivial test runs and passes in both packages
**Design principle served:** Architecture requirements (sim/harness separation)
**Note:** Requires approval for the dependency set (TS, test runner, workspace tool) before starting.

### [M0-02] Seeded PRNG: stateless world hash and stateful event stream
**Type:** feature | **Depends on:** M0-01
**Description:** Implement the two randomness mechanisms the design mandates: a stateless
`worldRng(seed, domain, ...coords)` hash whose output depends only on its arguments, and a stateful
`{ seed, counter }` stream used for event resolution. Add the enforcement that keeps them from
rotting.
**Acceptance criteria:**
- [ ] `worldRng` returns identical values for identical arguments regardless of call order
- [ ] Different domain tags with identical coordinates produce uncorrelated values
- [ ] The event stream is serializable and resumable mid-sequence
- [ ] A test fails if `Math.random` appears anywhere in `packages/sim` source or build output
- [ ] Lint rule banning `Math.random` in `packages/sim`
**Design principle served:** Architecture requirements (all randomness through seeded PRNG)

### [M0-03] Core state shape and reducer
**Type:** feature | **Depends on:** M0-02
**Description:** Define the sim's state object and the `reduce(state, action) => state` entry point,
including the tick clock and action durations. Actions are plain serializable objects; the reducer
never mutates its input.
**Acceptance criteria:**
- [ ] `reduce` returns a new state and leaves the input unmodified
- [ ] An unknown action returns the input state unchanged rather than throwing
- [ ] Every action advances `tick` by its declared duration
- [ ] State is round-trippable through `JSON.stringify`/`parse` with no loss
**Design principle served:** Architecture requirements (reducer-shaped deterministic API)

### [M0-04] Two-system map and the JUMP action
**Type:** feature | **Depends on:** M0-03
**Description:** A hardcoded two-system map with a distance between them, plus `JUMP`, `DOCK`, and
`UNDOCK`. No procgen yet — Slice 0 is testing the loop, not the galaxy.
**Acceptance criteria:**
- [ ] `JUMP` moves the player and advances the tick by a distance-derived duration
- [ ] `JUMP` to the current system is rejected
- [ ] Trading actions are rejected while undocked
**Design principle served:** Slice 0 scope

### [M0-05] Fuel consumption, refuelling, and stranding detection
**Type:** feature | **Depends on:** M0-04
**Description:** Jumps consume fuel proportional to distance and hull efficiency. One of the two
systems has a fuel depot. When the player can afford no legal jump and is not at a depot, they are
stranded.
**Acceptance criteria:**
- [ ] A jump with insufficient fuel is rejected, not silently clamped
- [ ] `REFUEL` succeeds only at a depot system and costs credits per unit
- [ ] `isStranded(state)` is true exactly when no legal jump exists and the player is not at a depot
- [ ] Stranding is reachable from a legal action sequence in a test
**Design principle served:** #5 (loss must be possible)

### [M0-06] Rescue resolution
**Type:** feature | **Depends on:** M0-05
**Description:** A stranded player is towed to the nearest depot system, forfeiting all cargo and a
percentage of credits. Hull damage persists. The run continues.
**Acceptance criteria:**
- [ ] Rescue empties cargo and deducts the configured credit percentage
- [ ] Credits floor at zero and never go negative
- [ ] The player ends at a depot system with enough fuel for at least one jump
- [ ] Hull damage is unchanged by rescue
**Design principle served:** #5 (loss must be possible), Q3 (costly rescue, no permadeath)

### [M0-07] One good, two markets, static prices
**Type:** feature | **Depends on:** M0-04
**Description:** A single tradeable good with a different fixed buy and sell price at each of the two
markets, plus `BUY` and `SELL` bounded by credits and cargo capacity. Static pricing is a
deliberate Slice 0 scoping choice; dynamics arrive in M1-01.
**Acceptance criteria:**
- [ ] `BUY` is rejected when credits or free cargo space are insufficient
- [ ] `SELL` is rejected when the player does not hold the quantity
- [ ] A profitable circuit exists between the two markets
- [ ] Cargo mass counts against capacity
**Design principle served:** Slice 0 scope

### [M0-08] Cargo-loss risk on jump
**Type:** feature | **Depends on:** M0-05, M0-07
**Description:** Each jump carries a fixed probability of a pirate attrition event that removes a
percentage of cargo, damages hull, and siphons fuel. Resolution is a single roll off the event
stream — no minigame, per the design.
**Acceptance criteria:**
- [ ] Encounter outcomes are drawn from `state.rng`, never from `worldRng`
- [ ] The same seed and action sequence always produce the same encounters
- [ ] An encounter can leave the player with too little fuel to continue, triggering stranding
- [ ] Hull damage accumulates across encounters and is not field-repairable
**Design principle served:** #4b (attrition, not a minigame), #5 (loss must be possible)

### [M0-09] Replay determinism test
**Type:** test | **Depends on:** M0-08
**Description:** Prove the property everything else leans on: a seed plus an ordered action log
reproduces an identical final state. This is the bug-reproduction mechanism and the save format's
backstop.
**Acceptance criteria:**
- [ ] Replaying a recorded 500-action log yields a state deep-equal to the original
- [ ] Replay is verified on at least 20 distinct seeds
- [ ] A deliberately injected nondeterminism makes the test fail
**Design principle served:** Architecture requirements (replayability)

### [M0-10] Save and load as seed plus deltas
**Type:** feature | **Depends on:** M0-09
**Description:** Serialize `{ version, worldSeed, tick, rng, deltas }` and restore it. No generated
content is written. The action log, if present, is a separate debug artifact and never on the load
path.
**Acceptance criteria:**
- [ ] Save then load yields a state deep-equal to the original
- [ ] The save file contains no generated world content
- [ ] Load time does not grow with the number of actions taken
- [ ] A save carrying an unknown `version` is rejected with a clear error
**Design principle served:** Persistence (seed + player deltas)

### [M0-11] Bot harness runner and three policies
**Type:** feature | **Depends on:** M0-08
**Description:** A runner that drives the sim with a scripted policy for N actions across M seeds,
plus the `greedy`, `cautious`, and `randomWalk` policies the verdict depends on. Policies see only
what a player could see.
**Acceptance criteria:**
- [ ] The runner completes 1000 actions × 200 seeds without error
- [ ] Policies read state exclusively through sim selectors
- [ ] Each run emits a structured result record, not console text
- [ ] Runs are reproducible from their seed
**Design principle served:** Architecture requirements (bot harness is a first-class deliverable)

### [M0-12] Balance report: wealth curves, stranding rates, policy dominance
**Type:** feature | **Depends on:** M0-11
**Description:** Aggregate harness runs into the three measurements that decide Slice 0: per-policy
median wealth over time, stranding rate, and the win-share of each policy across seeds.
**Acceptance criteria:**
- [ ] Reports median and interquartile wealth per policy per time bucket
- [ ] Reports stranding rate per policy
- [ ] Reports the percentage of seeds each policy wins
- [ ] Output is machine-readable and diffable between runs
**Design principle served:** §12 (the Slice 0 verdict, made testable)

### [M0-13] Slice 0 verdict
**Type:** docs | **Depends on:** M0-12
**Description:** Run the report and record the verdict against the three pass conditions in
`DESIGN.md` §12. If it fails, the response is to change numbers or stop — not to start M1.
**Acceptance criteria:**
- [ ] Each of the three conditions is recorded as pass or fail with its measured number
- [ ] A verdict of go or no-go is stated explicitly
- [ ] If failed, the specific numbers to tune are named
**Design principle served:** §12; development philosophy (provably fun before a renderer)

---

## M1 — Economy Depth

Goal: make the market unsolvable and give the home region a reason to exist. Gated on an M0-13 go.

### [M1-01] Market stock model and elastic pricing
**Type:** feature | **Depends on:** M0-13
**Description:** Replace static prices with stock-driven elastic pricing, so selling into a market
depresses its price and buying raises it.
**Acceptance criteria:**
- [ ] Repeated selling of one good into one market monotonically lowers its price
- [ ] Price is clamped to configured floor and ceiling multipliers
- [ ] Prices are a pure function of stock, base price, and elasticity
**Design principle served:** #3 (prices must not be static)

### [M1-02] Lazy stock relaxation over elapsed time
**Type:** feature | **Depends on:** M1-01
**Description:** Stock relaxes exponentially toward its target using elapsed ticks, computed in closed
form when the market is next touched. Nothing iterates per tick.
**Acceptance criteria:**
- [ ] Advancing 1000 ticks in one step equals advancing 1000 ticks one at a time
- [ ] An untouched market costs no computation as the clock advances
- [ ] Each market records a `lastTouched` tick
**Design principle served:** #3 (recovery over time); §3 (lazy time evaluation)

### [M1-03] Multiple goods and per-market demand profiles
**Type:** feature | **Depends on:** M1-02
**Description:** Several goods with distinct base prices and masses, and per-market targets and
elasticities so shortages are a property of place rather than a random event.
**Acceptance criteria:**
- [ ] Different markets favour different goods
- [ ] Cargo capacity is consumed by mass, not unit count
- [ ] No single good is optimal at every market
**Design principle served:** #3 (local shortages), #2 (axes orthogonal to distance)

### [M1-04] Refining recipes
**Type:** feature | **Depends on:** M1-03
**Description:** Raw goods convert into higher-value refined goods at defined input ratios and
durations.
**Acceptance criteria:**
- [ ] Recipes declare inputs, outputs, ratio, and time
- [ ] Refined output value exceeds input value net of time and upkeep
- [ ] No recipe cycle can produce value from nothing
**Design principle served:** #7 (home region relevance)

### [M1-05] Refinery investment on planets
**Type:** feature | **Depends on:** M1-04
**Description:** The player spends credits and materials to build and upgrade a refinery on a planet
without owning it. Build cost scales with tier.
**Acceptance criteria:**
- [ ] `BUILD_REFINERY` deducts cost and advances the clock by its duration
- [ ] Built refineries persist in save deltas
- [ ] Upgrading raises throughput at increasing cost
- [ ] No ownership, upkeep, or raid exposure is introduced
**Design principle served:** #7 (home region relevance), Q6 (investable, not ownable)

### [M1-06] Lazy refinery production
**Type:** feature | **Depends on:** M1-05
**Description:** Refineries consume stockpiled input and produce output based on elapsed ticks,
evaluated when next visited. Production halts when input runs out rather than going negative.
**Acceptance criteria:**
- [ ] Production over elapsed time equals stepwise production
- [ ] Output stops exactly when input is exhausted
- [ ] Input and output stockpiles are never negative
- [ ] Each refinery records a `lastTouched` tick
**Design principle served:** #7; §3 (lazy time evaluation)

### [M1-07] Docked waiting and upkeep
**Type:** feature | **Depends on:** M1-06
**Description:** `WAIT(n)` advances the clock, and upkeep is charged against elapsed ticks, so waiting
for prices to recover is a real cost rather than a free reset.
**Acceptance criteria:**
- [ ] Upkeep is deducted proportionally to elapsed ticks
- [ ] Waiting long enough to fully recover a market costs more than the recovery is worth in the
      common case
- [ ] Upkeep cannot drive credits below zero
**Design principle served:** Q8 (idling must cost something)

### [M1-08] Insurance policy
**Type:** feature | **Depends on:** M1-07
**Description:** A purchasable recurring policy that reduces the credit share forfeited on rescue,
making risk tolerance an explicit purchase.
**Acceptance criteria:**
- [ ] An active policy measurably lowers rescue cost
- [ ] The premium is charged against elapsed ticks like upkeep
- [ ] A lapsed policy provides no benefit
**Design principle served:** #5; Q3 (rescue/insurance)

### [M1-09] Harness: route dominance analysis
**Type:** feature | **Depends on:** M1-08
**Description:** Detect whether one circuit dominates the economy — the failure mode principle #3
exists to prevent.
**Acceptance criteria:**
- [ ] Reports profit per tick for the top circuits found by a bot
- [ ] Flags any circuit exceeding a configured share of total earnings
- [ ] Runs across ≥100 seeds
**Design principle served:** #3 (the game must not be solvable)

### [M1-10] Harness: wait-farming exploit detector
**Type:** feature | **Depends on:** M1-09
**Description:** A dedicated policy that abuses `WAIT` to farm price recovery, proving upkeep and
relaxation rates make it unprofitable.
**Acceptance criteria:**
- [ ] A wait-farming policy earns less per tick than an active trading policy
- [ ] The report states the margin, so regressions are visible
**Design principle served:** Q8; #3

---

## M2 — Procgen Variance

Goal: replace the hardcoded map with the lumpy, unbounded galaxy, and prove statistically that it is
not radial.

### [M2-01] Sector lattice and unbounded system placement
**Type:** feature | **Depends on:** M1-10
**Description:** Systems derived from sector-cell hashes over unbounded integer coordinates. Existence
is computed, never stored.
**Acceptance criteria:**
- [ ] The same seed and coordinates always yield the same systems
- [ ] Systems generate correctly at coordinates far from origin
- [ ] No boundary check exists anywhere
- [ ] Memory grows only with systems the player has discovered
**Design principle served:** Q5 (effectively unbounded); §4 (stateless world randomness)

### [M2-02] Star and planet types driving resource composition
**Type:** feature | **Depends on:** M2-01
**Description:** Star class and planet types are hash-derived and determine resource profiles
independently of distance.
**Acceptance criteria:**
- [ ] Resource profiles are reproducible from seed and coordinates
- [ ] Systems at equal distance vary widely in richness
- [ ] Every good has at least one source archetype
**Design principle served:** #2 (axes orthogonal to distance)

### [M2-03] Pirate pressure field
**Type:** feature | **Depends on:** M2-01
**Description:** Multi-octave value noise thresholded into clear space, corridors, and nests, with the
deliberately weak distance term from the design.
**Acceptance criteria:**
- [ ] Pressure is spatially clustered, not radial
- [ ] Correlation between pressure and distance from origin is below a configured ceiling
- [ ] Dangerous regions exist near origin and safe regions exist far out
**Design principle served:** #1 (the danger map must be lumpy)

### [M2-04] Route risk sampling and encounter probability
**Type:** feature | **Depends on:** M2-03
**Description:** Encounter probability derives from pressure sampled along the jump path, modulated by
sensor range and jump speed, so the short dangerous hop and the long safe detour become a real
choice.
**Acceptance criteria:**
- [ ] Probability is computed from samples along the route, not from the endpoints alone
- [ ] A multi-jump detour around a corridor measurably lowers total risk
- [ ] Higher sensor range measurably lowers encounter probability
**Design principle served:** #1, #4b

### [M2-05] Hazards
**Type:** feature | **Depends on:** M2-01
**Description:** Nebulae, radiation belts, and gravity wells as blob-noise regions costing sensors,
hull, and time respectively — independent of both richness and pirate pressure.
**Acceptance criteria:**
- [ ] Each hazard type alters at least one action's cost or outcome
- [ ] Hazard placement is uncorrelated with pressure and with distance
- [ ] A rich system can sit behind a hazard rather than behind a distance
**Design principle served:** #2 (axes orthogonal to distance)

### [M2-06] Scanning and sensor reveal
**Type:** feature | **Depends on:** M2-05
**Description:** `SCAN` reveals nearby systems within sensor range, including whether they have a fuel
depot, making information itself something the player invests in.
**Acceptance criteria:**
- [ ] `SCAN` costs time and reveals systems within sensor range
- [ ] Nebulae reduce effective scan range
- [ ] Revealed systems persist in save deltas
- [ ] Unscanned, unvisited systems expose no contents through any selector
**Design principle served:** #2 (scouting must have value)

### [M2-07] Derelicts and anomalies
**Type:** feature | **Depends on:** M2-06
**Description:** Hash-keyed single-use finds that reward exploration rather than hauling, consumed
once claimed.
**Acceptance criteria:**
- [ ] A find is claimable exactly once and recorded in `consumedFinds`
- [ ] Finds survive save and load
- [ ] Rewards use `worldRng`, not the event stream, so a find's contents do not depend on visit order
**Design principle served:** #2 (one-off finds)

### [M2-08] Fuel depot distribution
**Type:** feature | **Depends on:** M2-07
**Description:** Depots are hash-derived per system at roughly the configured share, replacing M0's
hardcoded depot and making stranding a genuine spatial risk.
**Acceptance criteria:**
- [ ] Depot share across a large sample is within tolerance of the configured rate
- [ ] Depot presence is only visible after visiting or scanning
- [ ] Depot-free pockets large enough to strand a full tank exist
**Design principle served:** #5; Q9 (fuel is not universally available)

### [M2-09] Harness: prove richness is not distance-correlated
**Type:** test | **Depends on:** M2-08
**Description:** Statistical check that the failure mode principle #1 was written against has not crept
back in.
**Acceptance criteria:**
- [ ] Reports correlation between distance from origin and system richness
- [ ] Fails if the absolute correlation exceeds the configured ceiling
- [ ] Sampled over ≥10,000 systems across multiple seeds
**Design principle served:** #1, #2

### [M2-10] Harness: prove route choice matters
**Type:** test | **Depends on:** M2-09
**Description:** Show that a risk-averse routing policy and a shortest-path policy reach materially
different outcomes — otherwise the pressure field is decoration.
**Acceptance criteria:**
- [ ] Shortest-path and risk-averse policies differ measurably in cargo lost and profit per tick
- [ ] Neither policy wins on more than a configured share of seeds
**Design principle served:** #1 (a route must be a real choice)

---

## M3 — Vessels and Modules

Goal: progression by changing hull rather than perfecting one, with the tradeoff rules enforced by
tests rather than intentions.

### [M3-01] Vessel class definitions
**Type:** feature | **Depends on:** M2-10
**Description:** The nautical class ladder as stat profiles — cargo, fuel, efficiency, hull, shield,
weapon, sensor, jump speed, slots, upkeep.
**Acceptance criteria:**
- [ ] At least five classes defined as data, not code
- [ ] Every attribute in the design is present on every class
- [ ] The starting vessel is the weakest by total capability
**Design principle served:** #6 (tradeoffs, not a ladder)

### [M3-02] Non-dominance test across classes
**Type:** test | **Depends on:** M3-01
**Description:** Enumerate all class pairs and fail if any class beats a cheaper class on every
attribute. This is the mechanism that keeps principle #6 true as classes get tuned.
**Acceptance criteria:**
- [ ] All pairs are checked
- [ ] Each class is strictly worse than at least one cheaper class on ≥2 attributes
- [ ] The test names the offending pair and attributes on failure
**Design principle served:** #6

### [M3-03] Attribute load-bearing test
**Type:** test | **Depends on:** M3-01
**Description:** Every attribute must influence at least one decision formula. An attribute that
affects nothing is a lie told to the player.
**Acceptance criteria:**
- [ ] Each attribute is traced to at least one formula
- [ ] The test fails, naming the attribute, if any is unreferenced
**Design principle served:** Brief requirement (every attribute must be load-bearing)

### [M3-04] Upgrade curve with diminishing returns
**Type:** feature | **Depends on:** M3-03
**Description:** Per-attribute upgrades with sublinear gain and superlinear cost, producing a soft cap
that makes changing hull more attractive than perfecting one.
**Acceptance criteria:**
- [ ] Marginal gain per credit strictly decreases with level
- [ ] A crossover level exists beyond which buying the next class beats upgrading
- [ ] A harness report states that crossover level per class
**Design principle served:** #6 (diminishing returns)

### [M3-05] Module slots, types, and levels
**Type:** feature | **Depends on:** M3-04
**Description:** Higher classes have more slots; modules of a type and level boost attributes and can
be installed and removed.
**Acceptance criteria:**
- [ ] Installing beyond the slot count is rejected
- [ ] Module bonuses apply to the same formulas as base attributes
- [ ] Removal restores base values exactly
- [ ] No module combination can exceed a configured attribute ceiling
**Design principle served:** #6

### [M3-06] Exotic material requirements
**Type:** feature | **Depends on:** M3-05
**Description:** High-tier vessels and modules need exotic materials plus bulk common ones, giving the
frontier a purpose beyond price arbitrage.
**Acceptance criteria:**
- [ ] Exotic materials are only obtainable from a minority of system archetypes
- [ ] The highest tier is unreachable without them
- [ ] Availability is weakly, not strictly, tied to distance
**Design principle served:** #2; brief requirement on high-tier costs

### [M3-07] Vessel purchase and swap
**Type:** feature | **Depends on:** M3-06
**Description:** Buying a new hull, transferring cargo and modules, and trading in the old one, with
the constraints that make the choice consequential.
**Acceptance criteria:**
- [ ] Purchase is rejected without sufficient credits and materials
- [ ] Cargo exceeding the new hull's capacity must be resolved, never silently deleted
- [ ] Modules incompatible with the new slot count are returned to the player
**Design principle served:** #6

### [M3-08] Planet ownership, upkeep, and raid exposure
**Type:** feature | **Depends on:** M3-07
**Description:** The deferred half of Q6: claiming a planet grants exclusive use, ongoing upkeep, and
exposure to pirate raids scaled by local pressure.
**Acceptance criteria:**
- [ ] Claiming requires credits and grants exclusive refinery use
- [ ] Upkeep is charged against elapsed ticks
- [ ] Raid probability scales with local pirate pressure
- [ ] An unpaid claim lapses rather than accruing debt
**Design principle served:** #7; Q6 (ownership at M3+)

### [M3-09] Harness: time to afford each vessel class
**Type:** feature | **Depends on:** M3-08
**Description:** Report how long each policy takes to afford each class — the primary pacing
instrument for a multi-hour campaign.
**Acceptance criteria:**
- [ ] Reports median ticks to afford each class per policy
- [ ] Flags any class that is never affordable or is affordable immediately
- [ ] Runs across ≥100 seeds
**Design principle served:** Architecture requirements (harness reports pacing); Q4 (multi-hour)

---

## M4 — Renderer

Goal: put a face on a simulation that is already proven. Nothing here may add game rules.

### [M4-01] App package scaffold
**Type:** chore | **Depends on:** M3-09
**Description:** Create `packages/app` with Vue and PixiJS, depending on `sim` and adding no rules of
its own.
**Acceptance criteria:**
- [ ] `packages/app` builds and imports `sim`
- [ ] `sim` has no dependency on `app`
- [ ] No game logic lives in `app`
**Design principle served:** Architecture requirements (renderer swappability)
**Note:** Requires dependency approval before starting.

### [M4-02] Star map rendering
**Type:** feature | **Depends on:** M4-01
**Description:** A 2D top-down Pixi map of discovered systems with the ship gliding between points on
jump. Reads exclusively through sim selectors.
**Acceptance criteria:**
- [ ] Only discovered systems render
- [ ] Hazards and known pirate pressure are visually distinguishable
- [ ] The map reads state only through selectors
**Design principle served:** Presentation (2D top-down star map)

### [M4-03] Management screens
**Type:** feature | **Depends on:** M4-02
**Description:** Vue screens for market, cargo, vessel and modules, and refineries — the ~70% of the
game that is DOM-shaped.
**Acceptance criteria:**
- [ ] Every player action available in the sim is reachable from the UI
- [ ] Actions dispatch through the reducer, never mutating state directly
- [ ] Rejected actions surface the rejection reason
**Design principle served:** UI decision (Vue for management screens)

### [M4-04] Encounter and rescue reporting
**Type:** feature | **Depends on:** M4-03
**Description:** Present attrition outcomes and rescue consequences clearly enough that the player
learns which routes hurt — the information that makes pre-jump decisions meaningful.
**Acceptance criteria:**
- [ ] Cargo, hull, and fuel losses are itemised per encounter
- [ ] Rescue shows exactly what was forfeited
- [ ] No decision prompt appears; resolution stays non-interactive
**Design principle served:** #4b (attrition, not a minigame)

### [M4-05] Save and load UI
**Type:** feature | **Depends on:** M4-04
**Description:** Player-facing save slots over the existing delta format, adding no new persistence
rules.
**Acceptance criteria:**
- [ ] Save and load round-trip through the UI
- [ ] Loading an incompatible version fails with a readable message
- [ ] The save format is unchanged from M0-10 apart from additive fields
**Design principle served:** Persistence (seed + player deltas)
