# Yomi — Scalability & Rate-Limiting Audit

**Date:** 2026-07-03
**Author:** SRE (site reliability review)
**Scope:** `api/index.js`, `api/geo.js`, `api/firestore.js`, `vercel.json`, `package.json`
**Method:** Static analysis of the deployed request path, no load test performed (see "What this audit is not," below)
**Verdict framing:** This is not a pass/fail gate. It's a map of *at what load tier each mechanism stops doing its job*, so growth decisions can be made against data instead of anxiety.

---

## What this audit is not

I did not run a load test against a live deployment, so every claim below is a **structural** finding (derived from reading the control flow and config), not a **measured** one (derived from an SLI under load). Treat the scale tiers as reasoning aids, not calibrated thresholds — before spending engineering time on any Critical item, put a real number on it (request logs, Vercel function invocation counts, memory/duration graphs) rather than acting on the structural read alone. That said, several of these findings don't need a load test to be actionable — an in-memory rate limiter and an unbounded cache are provably wrong shapes for a multi-instance serverless deployment regardless of what the graph says today.

Scale tiers used throughout, relative to whatever "current load" is today:
- **1x (today):** low enough that a single warm instance likely absorbs most traffic.
- **10x:** the point where Vercel is routinely running multiple concurrent warm instances.
- **100x:** the point where per-instance assumptions (memory, in-process queues) are load-bearing across a fleet, and third-party API ceilings start to bind before Yomi's own code does.

---

## 1. Rate limiting

### The app's own limiter

`api/index.js:27-28` — `express-rate-limit`, `windowMs: 60000, max: 30`, mounted globally on `/api/*`, keyed by `x-forwarded-for` (trust proxy configured correctly at `:22` for Vercel's single hop). This is an **IP-level global budget**, not a per-route or per-user one: 30 requests/minute covers scanning, admin stats, reports, and OCR saves all sharing the same bucket.

**Where it holds:** At 1x, with a small number of warm instances, this is a real (if generous) per-IP ceiling. It stops a single abusive client or runaway retry loop from doing much damage against any *one* warm instance.

**Where it silently stops working:** The store is the library's default **in-memory `Map`**, scoped to the Node process. Vercel does not guarantee a client's requests land on the same warm instance twice — it round-robins across however many instances are currently warm. That means the *effective* per-IP ceiling isn't 30/min, it's `30 × (warm instance count for that region)/min`, and that count is Vercel's autoscaling decision, not Yomi's. This isn't a future risk — it is already true today whenever Vercel happens to have more than one warm instance serving a region, which happens under perfectly ordinary traffic patterns, not just at scale. At 10x traffic, more concurrent instances are the *norm*, so the real ceiling is already multiples of the configured one, silently, with no metric telling anyone it happened. At 100x, the nominal "max: 30" is decoration — the real budget is whatever the instance fleet size happens to be that minute, which is exactly backwards (rate limits should get *stricter* under load, and this one gets *looser*).

**No per-route limiting** means a single client can spend its entire 30/min budget hammering `/api/product/:barcode` — the most expensive path in the app (see §2) — with the same weight as hitting a cheap static-ish endpoint. There's no way today to give the AI-identification fallback path a tighter budget than, say, a cache-hit lookup.

### Third-party API rate limits

Every external dependency (OFF ×3 hosts, USDA, UPCItemDb trial tier, GTINHub, Groq, OpenRouter, Gemini, ipquery.io) has its own ceiling that Yomi doesn't control and mostly doesn't observe. Handling is uniformly **try/catch → fall back to the next source**, with the sole exception of the AI callers, which specifically detect HTTP 429 and throw (`callGroq:179`, `callGroqVision:198`, `callOpenRouter:215`, `callGemini:228`) — but "throw" here just means "this source is excluded from `Promise.allSettled` this one time," not backoff, not circuit-breaking, not any signal that propagates beyond the current request.

The one deliberate throttle — `groqQueue`/`GROQ_DELAY_MS=2500` (`index.js:30-71`) — is a serial per-instance queue that spaces Groq calls 2.5s apart *within a process*. This is real engineering against a real constraint (Groq's per-key rate limit), and it works correctly today. Its failure mode is entirely about scale-out, covered in §4.

**UPCItemDb trial tier** is worth flagging on its own: trial tiers on lookup APIs are typically capped in the low hundreds to low thousands of requests/day, tighter than any of Yomi's own limits. At 10x traffic this is plausibly the *first* external ceiling hit, and today a UPCItemDb rate-limit response is indistinguishable from "product not found" in the fallback chain (`index.js:626-630` treats non-ok and error identically) — meaning degraded coverage from a quota exhaustion would show up as silently worse product-identification quality, not as an alertable error.

**Assessment:** the in-memory global limiter is the right shape for a single Express server; it is the wrong shape for Vercel's scale-out model, and it's already slightly wrong today, not just projected to be wrong later.

---

## 2. In-memory caches

Four module-level caches, all living only for the lifetime of one warm Vercel instance:

| Cache | Location | TTL | Eviction | Growth bound |
|---|---|---|---|---|
| `memoryCache` (product responses) | `index.js:76` | 24h | Lazy, on-access only (`:86`) | **Unbounded** — comment at `:78` already flags this |
| `memoryAiCache` (AI analyses) | `index.js:77` | 24h | Lazy, on-access only (`:112`) | **Unbounded** |
| `geoCache` (IP→geo) | `geo.js:1` | 1h | **None at all** | **Unbounded**, no access-time check either |
| `statsCache` (admin stats) | `index.js:1254` | 5min | Single object, self-replacing | Bounded (one entry) |

The first three share the same shape of risk: **lazy eviction only fires on a cache hit for that exact key.** An entry for a barcode or IP that's never looked up again just sits in memory forever accumulating with every new distinct key seen. This is a function of *cardinality*, not request volume — a low-traffic app with high product/IP diversity (e.g., an aggregator client hitting many distinct barcodes, or organic growth across many distinct visitor IPs) grows these caches just as fast as a high-traffic app with the same diversity.

`geoCache` is the sharpest case: no TTL check gates re-storage, no expiry sweep, no bound of any kind — under current(1x)-scale traffic this is a slow leak measured in KB/day; at 10x-100x, with enough distinct visitor IPs, it becomes the dominant driver of a warm instance's growing RSS over its lifetime, and it does so for an amount of data (IP → country/region/city strings) that has essentially zero business value once queried once.

**What happens under memory pressure:** Vercel Node functions run with a fixed memory ceiling (currently defaulted, see §5). When these object literals grow large enough, the instance either (a) gets OOM-killed and Vercel spins up a fresh one — invisible cold-start-shaped latency spike, no error surfaced to the caller beyond a slow request — or (b) V8's GC pressure degrades latency broadly for every concurrent request on that instance before OOM is reached. Neither failure mode produces a clean error; both look like "the app got slower for no reason," which is the worst kind of incident to diagnose because there's no stack trace pointing at the cache.

**Concurrency hazard layered on top:** the cache-hit enrichment path does a read-modify-write on `memoryCache[cachedBarcode]` (`index.js:326-334, 346, 353`) — spread the entry, mutate `.response` or `.cachedAt`, write it back. Node's single-threaded event loop means no two statements interleave *mid-expression*, but `await addOcrDataIfAvailable(...)` at `:332` yields control before the write-back at `:334`. Two concurrent requests for the same popular barcode landing on the same instance can race: both read the pre-enrichment entry, both await, both write back — the second write clobbers the first, and depending on timing either could win. Low blast radius (worst case: one enrichment gets dropped and re-computed on the next hit) but it's a real TOCTOU gap, and it gets more probable, not less, exactly as a barcode gets more popular — i.e., worse at exactly the scale where you'd want it to be fine.

**Not a new risk in the settled L1/L2 design** (`docs/superpowers/specs/2026-06-30-unified-cache-admin-design.md`) — that spec accepted per-instance non-persistence deliberately. What it doesn't appear to have scoped is unbounded *growth within* an instance's lifetime as a function of key cardinality — that's a distinct concern from "does L1 survive a cold start," and worth a follow-up note against that spec rather than a re-litigation of its TTL choice.

---

## 3. Firestore access pattern

`api/firestore.js` is REST-API-only: no connection pooling (each call is a fresh `fetch`), an access token is cached module-level with expiry and reused correctly (`:4-9,44` — this part scales fine). Every data *operation* (`fireGetCache`, `fireSetCache`, `fireGetAiCache`, etc.) is a single-document GET/PATCH/DELETE. There is no `runQuery`, no batch-get, no aggregation query anywhere in the module.

**The concentration of risk is `/api/admin/stats`** (`index.js:1257-1279`). On every 5-minute cache miss it does, serially:
- `fireListAll('scan_logs')` — paginated 50/page, up to `maxPages=100` (`firestore.js:286-296`), i.e. up to **5,000 documents fetched across up to 100 sequential REST round-trips**, each incurring its own network RTT to the Firestore REST endpoint.
- `fireListAll` again for `reports`, `products_ocr`, `products_nutrition` (three more potential 100-page scans).
- `fireListDocs('ai_cache', null)` — one page, but still a full-collection page fetch.
- A `barcodeNameMap()` full scan of `product_cache` for the barcode→name index (referenced in findings, not re-verified line-by-line here — same shape of risk).

At **1x**, if `scan_logs` is under a few hundred docs, this is one or two round-trips and is genuinely fine — the code comment at `firestore.js:285,299` already names the exact threshold to worry about (~5,000 docs) and the exact fix direction (counter-based aggregation). That comment is doing its job; the risk isn't unknown, it's **timed**, and the audit's job is to say when the timer runs out.

**At 10x** scan volume, `scan_logs` crosses into the thousands-of-documents range on an ordinary timescale (weeks to a couple of months depending on scan rate), and `fireListAll` silently truncates at `maxPages=100` × 50/page = 5,000 — past that point, `/api/admin/stats` isn't slow, it's **wrong**: it returns a computed stats object over a truncated dataset with no signal to the caller that truncation happened. That's a worse failure mode than slowness — a stale-but-plausible-looking dashboard.

**At 100x**, even before hitting the 5,000-doc wall, the *latency* of a 100-sequential-round-trip scan (each REST call carries its own connection setup + auth header overhead, no batching) risks exceeding Vercel's function timeout budget outright (see §5) — meaning the stats endpoint doesn't return truncated data, it returns a 504, on every 5-minute cache miss, for every admin who looks at the dashboard during a busy window.

**Single-document-op overhead** elsewhere (product cache reads/writes, AI cache, scan log writes) is fine at all three tiers examined here — those are O(1) per request regardless of collection size, the risk is specifically the full-collection-scan endpoints (`stats`, and by extension anything reusing `fireListAll`/`fireListDocs` on `ADMIN_COLLECTIONS`).

---

## 4. Cross-instance concurrency

This is the throughline connecting §1 and §2: **every mechanism in this codebase that "handles" concurrency does so by relying on Node's single-threaded event loop within one process** — which is a correct and cheap solution for concurrent requests *on the same instance*, and provides **zero** coordination the moment Vercel routes two requests to two different warm instances.

Concretely, two mechanisms degrade from "correct" to "partially correct" purely as a function of instance count, with no code change and no traffic-pattern change required to trigger it:

- **`groqQueue`** (`index.js:31-71`): `shift`/`push` plus a `groqProcessing` boolean is a textbook single-process mutex. It guarantees "2.5s between Groq calls" *per instance*. With N warm instances each running their own queue, the actual call rate against Groq's API key is up to N× the intended 1-call-per-2.5s, because Groq's rate limit is enforced against the shared API key, not against any one instance. At 1x with typically one or two warm instances this under-shoots the real Groq ceiling by enough margin to not matter in practice. At 10x-100x, with routine multi-instance scale-out, the queue's central promise — protecting a shared API key's rate limit — degrades proportionally to instance count, and the only signal of that happening is Groq starting to return 429s that get correctly caught (`:179`) but then just silently drop that provider for the current request rather than indicating "the queue's guarantee no longer holds."

- **The rate limiter itself** (§1): same shape of failure, applied to the app's own client-facing budget instead of an outbound one.

Both of these are **provably** wrong for a multi-instance deployment — this doesn't require a load test to establish, only reading how `express-rate-limit`'s default store and a `let`-scoped array behave across separate Node processes. What a load test *would* tell you is the actual instance-count distribution under real traffic, which is the missing number needed to size the actual overshoot (e.g., "at typical concurrency we run 3 warm instances, so the real Groq call rate is ~3× intended" — worth measuring via Vercel's function invocation metrics before choosing a fix, per the "measure before optimizing" principle).

No other shared-mutable-state hazard beyond the ones already covered in §1/§2 was found — `statsCache`, `memoryCache`, `memoryAiCache`, `geoCache` are all per-instance by design and accepted as such in the settled specs; the *only* place per-instance state is supposed to provide a *cross-request coordination guarantee* (rather than just a local optimization) is the Groq queue and the rate limiter, and those are exactly the two that break.

---

## 5. Vercel-specific configuration

`vercel.json` uses the legacy `builds`/`routes` schema (`@vercel/node` for `api/index.js`, `@vercel/static` for everything else) with **no `functions` block whatsoever**. That means memory allocation, `maxDuration`, and region pinning are all left at Vercel's platform defaults rather than being deliberately chosen for this workload. Two consequences:

1. **Timeout budget vs. worst-case scan path.** §2 of the verified findings lays out the worst-case `/api/product/:barcode` path: geo lookup (3s, fire-and-forget so it doesn't count against the response), optional freshness check (5s), three serial OFF host queries (8s each = up to 24s), USDA search (8s), USDA enrich (6s), UPCItemDb (8s), GTINHub (8s), three-way parallel AI call (bounded by the slowest at 9s for OpenRouter, but only after the Groq queue's own serialization delay is added on top — an already-busy queue can push effective AI latency well past the 9s cap), a second USDA enrich (6s), two Firestore reads. Summed serially in the true worst case (all sources miss, all fall through) this is comfortably in the **60-90+ second range** — which exceeds Vercel's default serverless function timeout (10s Hobby / 60s configurable ceiling depending on plan) before any explicit `maxDuration` override. Without a `functions` block setting `maxDuration` explicitly, this path is one deep cache-miss away from a hard platform-enforced timeout, and the caller gets a bare 504 with none of the partial-progress information the function had already gathered.

   At **1x**, cache hits absorb the overwhelming majority of requests (per the TTL tiers at `:138-140`), so the worst-case path is rare. At **10x**, more distinct barcodes means more cache misses in absolute terms even at the same hit *rate*, so the worst-case path fires more often in wall-clock terms. At **100x**, if product diversity grows with traffic (plausible for a barcode scanner with an expanding user base), the miss rate itself may not stay flat — this is exactly the shape of risk that deserves a real measurement (miss rate vs. traffic growth) rather than an assumption in either direction.

2. **Cold starts.** No memory/region tuning also means no lever has been pulled to reduce cold-start frequency or latency (e.g., no minimum-instance guarantee, no region affinity to reduce Firestore REST RTT). Every cold start also means a fresh, empty `memoryCache`/`memoryAiCache`/`geoCache`/Groq queue — consistent with the accepted trade-off in the ipquery.io spec, but worth naming as a multiplier on §2/§4: **the more instances that cycle (whether from scale-out or from idling out and restarting), the more often the "warm" assumptions in caches and the Groq queue are reset to zero**, which increases both cache-miss load on Firestore/third parties and the number of independent Groq queues running concurrently.

`package.json` pins `express ^4.19.2` and `express-rate-limit ^8.5.2` — both current, no version-related scaling concern found.

---

## 6. Prioritized risk list

Ordered within each tier by blast radius. Each entry names a mitigation *direction* only — no implementation is proposed or should be inferred from this document.

### Critical — must fix before meaningful growth (10x tier and beyond turns these from theoretical into routine)

1. **Cross-instance rate limiter is not a real limiter once >1 instance is warm** (§1, §4). The configured "30 req/min/IP" is already approximate today and becomes proportionally meaningless as instance count grows — with no metric surfacing the gap. *Direction: externalize the limiter's store to something shared across instances (the standard fix is a shared key-value store queried per request instead of in-process memory), or explicitly accept and document the per-instance nature and size the `max` accordingly with real headroom.*

2. **`fireListAll` truncates silently past 5,000 docs, feeding `/api/admin/stats` with wrong-not-slow data** (§3). The existing code comment already flags the threshold and the fix direction; the audit's contribution is confirming this crosses from "documented future work" to "will bite in production" specifically once `scan_logs` growth crosses that line, which at current logging volume is a matter of weeks-to-months, not years. *Direction: the comment's own suggestion — counter-based aggregation instead of full-collection scan — plus, independent of that, surface truncation as a visible flag in the stats response rather than a silent cutoff.*

3. **No `maxDuration` set, worst-case scan path plausibly exceeds Vercel's default function timeout** (§5). This produces a bare 504 on the single most expensive, most user-facing endpoint in the app, precisely on the request that already did the most work (and burned the most third-party API quota) before failing. *Direction: measure actual worst-case latency in production first (this is the one number in this whole audit most worth instrumenting immediately — a histogram of `/api/product/:barcode` latency broken out by cache-hit vs. full-miss path), then set `maxDuration` deliberately in a `functions` block, and consider short-circuiting the serial external-call chain (parallelizing independent lookups, or returning a partial/best-effort result under a time budget) rather than only extending the timeout.*

### Important — fine until you're much bigger, but the fuse is already lit

4. **Unbounded in-memory caches under high key cardinality** (§2: `memoryCache`, `memoryAiCache`, `geoCache`). Growth is driven by distinct-key count, not request volume, so this can bite even a moderate-traffic, high-diversity deployment before raw QPS looks alarming on any dashboard. `geoCache` is the most exposed (no eviction logic at all). *Direction: bound each cache by entry count (simple LRU cap) independent of the existing TTL logic — TTL controls staleness, not size, and this app currently has only the former.*

5. **Groq queue's per-instance mutex gives a false sense of a global rate guarantee** (§4). Distinct from #1 in effect (protects an *outbound* budget with a third party, not an inbound one) but identical in root cause. Under 10x-100x scale-out this proportionally overshoots Groq's real per-key ceiling with no alerting on the overshoot. *Direction: same family of fix as #1 — coordinate the delay across instances via shared state, or accept the per-instance limitation explicitly and set `GROQ_DELAY_MS` with enough margin for the expected instance-count range.*

6. **Read-modify-write race on `memoryCache[cachedBarcode]` during cache-hit enrichment** (§2, `index.js:326-334`). Low blast radius per occurrence (worst case, one enrichment computation is dropped and redone), but probability scales with exactly the traffic pattern (popular barcodes, concurrent hits) that indicates the app succeeding. *Direction: make the read-modify-write atomic within the async boundary — compute the enrichment before touching the shared object, or guard with a per-key in-flight promise so concurrent requests for the same barcode share one enrichment instead of racing.*

7. **Third-party quota exhaustion is indistinguishable from "not found"** (§1 — specifically UPCItemDb's trial tier, the tightest ceiling of the bunch). A quota-exhausted source silently degrades product-identification coverage with no alert. *Direction: log/metric the HTTP status distinctly from a genuine miss for each external source, so quota exhaustion shows up as a rate, not just as gradually worse product coverage that nobody notices until a user complains.*

### Minor — optional/future, not urgent

8. **No per-route rate limiting.** A single client's 30/min budget is shared between cheap and expensive endpoints. Not urgent because the global limiter's cross-instance weakness (#1) is the more binding constraint right now — fixing route-level granularity before fixing the shared-store problem wouldn't move the needle much. *Direction: once #1 is addressed with a shared store, layer per-route buckets on top (e.g., a tighter bucket for `/api/product/:barcode` than for read-only admin views).*

9. **No circuit breaker / backoff on any third-party call.** Every external dependency is try/catch-and-fallback with a fixed timeout, no exponential backoff, no breaker to stop hammering a source that's already down for the whole request. At current external-call volume this just adds latency (paying the full timeout on a dead source) rather than causing cascading failure, since failures fall through to the next source rather than retrying the same one. *Direction: worth revisiting only if a specific source's downtime starts measurably dragging worst-case latency — instrument first (which source times out most often, and how often) before adding breaker logic.*

10. **No region pinning / minimum-instance configuration.** Affects cold-start frequency and Firestore REST RTT, but this is a tuning knob, not a correctness issue, and the impact is second-order compared to #3 (timeout budget) and #4 (cache growth). *Direction: only worth tuning after instrumenting actual cold-start frequency and its user-facing latency contribution — don't guess a region/memory config without that data.*

---

## Summary table

| # | Finding | Tier | First bites at |
|---|---|---|---|
| 1 | Rate limiter not shared across instances | Critical | Already partial today; routine by 10x |
| 2 | `fireListAll` silent truncation past 5,000 docs | Critical | Weeks-to-months of current scan_logs growth |
| 3 | No `maxDuration`, worst-case path risks platform timeout | Critical | Any full-cache-miss scan, frequency grows with traffic + product diversity |
| 4 | Unbounded caches, cardinality-driven growth | Important | Function of distinct barcodes/IPs, not raw QPS |
| 5 | Groq queue is per-instance only | Important | Routine multi-instance scale-out (10x+) |
| 6 | Cache read-modify-write race | Important | Popular-barcode concurrent hits |
| 7 | Quota exhaustion looks like "not found" | Important | UPCItemDb trial ceiling, plausibly before 10x |
| 8 | No per-route rate limits | Minor | N/A — dependent on fixing #1 first |
| 9 | No backoff/circuit breaker | Minor | Only if a specific source has frequent outages |
| 10 | No region/instance tuning | Minor | Only worth measuring, not fixing blind |

**Error-budget framing:** none of these findings represent a *current* SLO breach on the evidence available — no load test was run, and the app's own code comments show the team already correctly identified and scoped several of these (the 5,000-doc Firestore threshold, the per-instance cache trade-off) as deliberate, timed decisions rather than oversights. What this audit adds is: (a) confirmation that two of those timers — the Firestore truncation and the rate-limiter/Groq-queue cross-instance gap — are the ones most likely to convert from "documented risk" to "incident" specifically in the 10x-100x range as instance counts and collection sizes grow, and (b) one finding not previously scoped in any spec — the timeout-budget-vs-worst-case-path gap (#3) — which is worth an immediate latency measurement regardless of growth plans, since it's a correctness gap (silent 504 with work already done) rather than a scale gap.
