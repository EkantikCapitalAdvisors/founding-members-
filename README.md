# Ekantik Capital — Founding Cohort Landing Page

`founding.ekantikcapital.com`

A single-page, static site (vanilla HTML/CSS/JS, GitHub Pages) implementing the
**Founding Member Landing — Specification & Strategy Brief (FINAL, v2.0)**.

This page does a categorically different job from the public funnel
(`accelerator.` Experiment, `doubles.` Doctrine): it **qualifies an accredited
observer and routes them into a gated, private next step.** It is therefore
built as a solicitation-aware property, behind the firewall described in the
spec (§1.3).

> **History note:** this replaces the earlier "EPIG Founding Partners"
> mission/partnership page, which conflicted with the FINAL spec on several
> load-bearing points (manufactured "33 spots remaining" urgency, fee framing,
> blended performance). Those are intentionally gone.

---

## Section map (spec §2 information architecture)

| Anchor | Section | Spec |
|---|---|---|
| `header.hero` | Frame inversion — access, not pitch | HERO |
| `#who` | Who this is for (qualify by self-selection) | §01 |
| `#proof` | The proof, compressed (durability fact; historical vs. live separated) | §02 |
| `#thesis` | The founding thesis (why early is rational) | §03 |
| `#how` | How it survives — buffer → Sit-Out → Gate | §04 |
| `#receives` | What a founding member receives (described, not priced) | §05 |
| `#risk` | The risk, stated first | §06 |
| `#scarcity` | Structural scarcity (real caps, no countdowns) | §07 |
| `#alignment` | Alignment & the operator (witness: Manish Dharod) | §08 |
| `#cta` | The single CTA → qualification → accreditation → briefing | §09 |
| `footer` | Disclosures | §7 |

---

## Brand system (spec §5)

- Navy `#1B2A4A` field, Gold `#C8A951` accent/CTA, slate secondary, restrained
  green/red reserved for live P&L only.
- Playfair Display / Cormorant Garamond for headings; **JetBrains Mono** for all
  data, metrics, and labels; Inter for body.
- Dark cockpit / instrumentation aesthetic; minimal motion (only the live dot
  pulses).

---

## Independent edge dashboard & data pipeline

This page demonstrates the edge **on its own data**, with no dependency on other
properties. Four pieces:

| File | Role |
|---|---|
| `parser.js` | Pure, dependency-free parser + stats engine. Turns the Discord `#imo-futures-trades` export into structured trade records and computes the full KPI set in points, dollars, and R-multiples (see below). Shared by the admin tool, dashboard, and the `index.html` proof strip. |
| `admin.html` | **Internal** upload/review tool. Load the Discord HTML export (or paste it), parse, correct any flagged rows in an editable table, then **download `trades.json`** and commit it. The single source of truth. |
| `trades.json` | The committed dataset the public pages read. Generated from the Feb–May 2026 export. Carries the model fields `point_value` ($/point, 50 = one ES contract) and `working_unit` ($ base for drawdown %). |
| `dashboard.html` | The public, self-contained dashboard: a window filter, the KPI set, equity curve (Chart.js), the durability test, and the full trade log. |

**KPI set** (computed in `parser.js`, displayed on the dashboard, filterable by
window): win rate, profit factor, R-expectancy, annual R (extrapolated from the
realised trade rate), EV/trade ($), avg win/loss ($), best/worst trade ($), max
drawdown ($ and % of working unit), trades/month (realised rate over the active
span), recovery (trades to restore peak), max loss streak, and avg risk/trade
(1R, $). **Dollars are size-aware** — per-trade P&L = `points × $/point`, where
`$/point` comes from the size tag: ES = `point_value` × contracts, MES =
`point_value`/10 × micros, half = `point_value`/2, untagged = one ES. So a
`5mes` trade of +2 pts = +$50, while a full-ES +16 pts = +$800. Net, profit
factor, EV, avg win/loss, best/worst, drawdown and the durability test are all
computed on these size-aware dollars; R-multiples use each trade's
`|entry − stop|` as 1R (stop distances above 50 pts are treated as log typos and
skipped) and stay size-neutral. **Window filter:** 7d / 30d / 90d / MTD / YTD / All time
— filters the KPIs and the trade table; the equity curve and durability test stay
all-time as context.

**Position size is explicit, points stay as logged.** Where a trade is logged at
a non-default size — `half`, `5mes`, `2es`, etc. — the parser captures that tag
into `size` and the dashboard shows it in a **Size** column ("full" = untagged).
Points are recorded exactly as logged; sizing is **not** used to re-scale results.
Only two records carry a `review` flag — one no-trade (`F14`) and one unresolved
entry with no result (`F56`) — and both are excluded from the counts.

**One continuous record.** The page presents a single, unbroken, operator-executed
log — every trade from February 2026 to now, in order. There is no "historical
vs. live" split in the public presentation. (The `F#`/`S#` labels in the data are
just the operator's own sequence tags and carry no separate-track-record meaning.)

**Updating the data:** open `admin.html` → load the latest export → review flagged
rows → download `trades.json` → commit to repo root. Done.

**Current snapshot** (from the committed `trades.json`): 103 countable trades,
64% win rate, profit factor 2.0, net +180.75 pts. Durability — delete the 3 best
trades and it still nets +123.75 pts at PF 1.69.

---

## Conversion mechanism (spec §4) — current build

CTA → **qualification modal** (name, email, one fit question + two
acknowledgement checkboxes). No financial account data is collected on the page.

**Form delivery:** set `FORMSPREE_ENDPOINT` in the inline `<script>` to your
Formspree (or equivalent) form URL. Until it is set, the form **falls back to a
prefilled `mailto:` to `hd@ekantikcapital.com`** so nothing is lost. The next
steps (third-party accreditation verification → data room → operator call) are
**manual hand-offs** in this build.

> Not yet built (later phases, per spec §11): automated third-party
> accreditation integration (Parallel Markets / VerifyInvestor), the self-serve
> data room, and briefing scheduling.

---

## Compliance & data-integrity guardrails baked in

- **`noindex` by default** (`<meta name="robots">`). The 506(b) vs 506(c)
  decision is a counsel call (spec §1.2); the conservative default ships
  non-indexed. Remove only if counsel confirms 506(c).
- **No subscription terms, fees, or target returns on the public page** — those
  live behind verification (spec §1.3 / §4).
- **No manufactured urgency** — the old countdown / "spots remaining" framing is
  gone; scarcity is the two real caps (spec §07 / §8.2).
- **One continuous record** — the page shows a single, unbroken, operator-executed
  log from February 2026 to now, in order; no separate "track records," no resets.
  (Per the client's direction, this supersedes the spec's §02 historical/live split.)
- **No fabricated numbers** — every figure (hero datum, §02 KPI strip, the whole
  dashboard) is computed **client-side from this repo's own `trades.json`** via
  `parser.js`. Nothing is hardcoded; counts exclude records flagged for review.
  This page is a **self-contained demonstration of the edge** — independent of
  `accelerator.` or any other property.
- **Process-not-guarantee language** on the Sit-Out and the Gate; "proven"
  attached only to the historical edge and the architecture (spec §7).

---

## Things to wire before go-live

1. Engage **securities counsel** (506(b) vs 506(c), Marketing Rule, founding
   economic interest) — spec standing caveat.
2. Set `FORMSPREE_ENDPOINT` (or swap in another form backend).
3. Review the flagged rows in `admin.html` and confirm the 8 ambiguous
   half-size / parenthetical results before publishing headline figures
   (spec §9 data-integrity discipline).
4. Fill the real cohort cap values in §07.
5. Decide whether `admin.html` should ship to the public host at all — it is
   `noindex` and internal-only; consider hosting it separately or removing it
   from the public deploy.

---

*Ekantik Capital Advisors LLC — confidential working document. Not an offer or
solicitation. Past performance is not indicative of future results. Sample is
pre-asymptotic.*
