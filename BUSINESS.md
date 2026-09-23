# PointIQ: product and business plan

## The gap

- **Hudl + Balltime** own video and AI tagging. **VolleyMetrics** (Hudl) and **DataVolley** own college scouting data. **SoloStats** owns courtside stat entry for high schools and clubs.
- All of them *describe* what happened: box scores, heat maps, video clips.
- None of them turns that data into **decisions with probabilities attached**:
  - Start in R2, not R1: +0.8 pts per set.
  - Libero serving for #12 is worth +3 pts of match win probability.
  - R4's weak side-out is 97% likely to be real, not noise.
  - This 6'1" OH's .380 in a small-school league is a .240 in 18 Open, ± .04.

That's PointIQ's lane: **decision analytics on top of the data teams already collect.** PointIQ sits on top of Hudl and SoloStats rather than competing with them. The pitch is "keep your stat app; PointIQ tells you what to do with it."

## Getting data from Hudl and SoloStats

**There is no public Hudl volleyball API.** Hudl's public data APIs are for soccer (Wyscout, StatsBomb). Plan in three steps:

1. **Now: file import (built).**
   - College programs on VolleyMetrics get DataVolley `.dvw` files for their matches. That's the richest source: every rally, both teams' rotations, every touch. PointIQ parses `.dvw` directly.
   - SoloStats exports CSV (and XML for Hudl). PointIQ auto-maps CSV columns with a manual override.
   - Coaches already download these files, so the workflow is "drag the file in."
2. **With traction: Hudl partner integration.** Hudl works with integration partners. Apply once there are 10–20 paying programs and a usage story. The ask is OAuth access to a program's volleyball stats/`.dvw` files so matches sync automatically. SoloStats (Rotate123) is a smaller company and likely more receptive to a direct export/API partnership. Contact them early.
3. **Never: scraping Hudl.** It violates their terms and would get the product killed right when it matters.

## Pricing

Volleyball is seasonal: HS and college in fall, club December–May. That's why there's a **season pass** as well as monthly and annual.

| Plan | Monthly | Season (4 mo) | Annual | Buyer |
|---|---|---|---|---|
| Starter | Free | Free | Free | Any coach. Rotation win probability from your own numbers |
| Coach | $29 | $99 | $249 | HS varsity / club team. Lineup Lab, libero/subs, live tracker, all imports |
| Program | $79 | $299 | $749 | College / multi-team club. Multi-season model, order search, game theory, 6 seats |
| Program + Recruiting | $149 | $549 | $1,490 | D1/D2/D3 staffs. Everything plus the recruiting board, 10 seats |

For reference: Hudl team plans run roughly $400–$4,000 per year. Balltime's recruiting plan is $299/yr for an individual. A college athletics budget buys at $750–$1,500/yr without committee approval at many schools.

**Is monthly subscription viable?** Yes as an *option*, but most revenue should be season or annual. Monthly-only churns every November. The feature gating is already built (`src/engine/plans.js`, `can(feature)` checks throughout the UI). Billing needs Stripe Checkout + Customer Portal and a webhook that sets the program's plan key.

## What it takes to sell (in order)

1. **Pilot at UCLA (this season).**
   - Offer the volleyball staff (and club teams) free Program + Recruiting in exchange for 30 minutes of feedback every two weeks.
   - Ask for 3–5 real `.dvw` files to validate the parser and fit the model's effect sizes to real rallies.
   - The success metric is one decision the staff changed because of PointIQ.
2. **Hosted backend** (needed before charging anyone):
   - Auth with staff seats.
   - Postgres (one row per program ≈ today's JSON state).
   - Stripe billing.
   - File storage for `.dvw` uploads.
   - Supabase or Firebase can cover the first three in a few weeks.
   - Keep the math client-side. It's fast, and it keeps hosting cheap.
3. **Case study → outreach.**
   - One page: "UCLA's staff used PointIQ to …" (with permission).
   - Email 200 college staffs (volleyball ops / analysts are the champions), then HS coaches through state coaching associations and AVCA events.
4. **Recruiting data moat.** Every program that tracks prospects and later sees how signees performed lets the level adjustments be calibrated on real outcomes. That calibration can't be bought or copied.

## Compliance notes

- **NCAA recruiting:** PointIQ stores evaluations; it never contacts athletes. Keep it that way, and keep minors' data minimal. Recruiting records hold stats and public profile links only, no contact info, until legal review.
- **Student-athlete data:** FERPA applies when a school shares education records. Get a data processing agreement template before the first paid school contract.
- **Trademarks:** Hudl, SoloStats, DataVolley and VolleyMetrics are named only to describe file compatibility. Don't use their logos.
- Using a university's name in marketing requires the school's written permission.
