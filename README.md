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
- **Historical vs. live kept separate** — pre-launch operator record vs. the
  post-22-May-2026 live public sample are never blended (spec §02 / §9).
- **No fabricated numbers** — the hero live datum reads the **same**
  `trades.json` source as `accelerator.` (spec §6) and degrades gracefully to a
  "watch it print" link rather than hardcoding a figure. Resolve the 12
  "Unknown"-direction trades (spec §9) before any headline figure is displayed.
- **Process-not-guarantee language** on the Sit-Out and the Gate; "proven"
  attached only to the historical edge and the architecture (spec §7).

---

## Things to wire before go-live

1. Engage **securities counsel** (506(b) vs 506(c), Marketing Rule, founding
   economic interest) — spec standing caveat.
2. Set `FORMSPREE_ENDPOINT` (or swap in another form backend).
3. Confirm the shared `trades.json` URL/path for the hero live datum.
4. Fill the real cohort cap values in §07 (`[N]` / `[$X]`).
5. Confirm cross-links to `accelerator.ekantikcapital.com` (one-directional per
   spec §1.3 — `founding.` is the only property carrying solicitation language).

---

*Ekantik Capital Advisors LLC — confidential working document. Not an offer or
solicitation. Past performance is not indicative of future results. Sample is
pre-asymptotic.*
