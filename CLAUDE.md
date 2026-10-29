# CLAUDE.md

Standing instructions for this repo. Read before every session.

## What this project is

**GLENN/OS** — a personal FPL (Fantasy Premier League) bot, a free tool for one
user that aims to match what premium FPL sites offer and give weekly
optimal-play advice. (Called GafferOS until 28 Aug 2026; the rename touched
localStorage keys and the iframe postMessage type.)
Stack: a single-file frontend (`index.html`, React via Babel-standalone, no build
step) + Vercel serverless functions in `/api`. Two odds APIs are wired in. The core
is an **xP (expected points) model** built on start probability (xMins), xG/xA per
90, clean-sheet probability, and fixtures, with real bookmaker odds layered on via
`/api/odds`.

The user must be able to trust this bot. A feature that claims to do something
must provably do it. "Looks like it works" is not evidence.

## How you work here: detective, not guesser

This is the most important rule in this file.

1. **Theory first.** State what you think is wrong and why.
2. **Evidence second.** Prove it — read the code, run it, add minimal targeted
   logging, check against real data. A beautiful theory with no evidence is worth
   nothing and has caused wasted "fixes" before.
3. **Fix only after evidence confirms the theory.** Never change code on an
   unverified hunch.
4. **If you are unsure, say so.** Don't paper over uncertainty. Verify with the
   real API / real data, or with a web search, and cite the source.

## Skriv ner återanvändbara fynd när du gör dem

Allt du mäter eller läser ur en extern källa och som kan behövas igen ska
dokumenteras **direkt**, i rätt avsnitt i `HANDOFF.md`. Annars görs samma
arbete om. Det har redan hänt: att gratisplanen inte ger Bet365 lästes ur ett
felmeddelande, stod ingenstans, och oddsmodellen låg nere i dagar medan vi
gissade på namnmatchning i stället.

Ett fynd är återanvändbart om det är ett **påstående om världen utanför
koden**: ett API:s kontrakt, en kvot eller gräns, ett fältnamn, ett
mätresultat, eller en idé som provades och inte höll. Ett negativt resultat är
lika värdefullt som ett positivt — det hindrar nästa försök.

Regler:
- **Datum och metod med varje siffra.** "Median 1,64 gånger över taket, mätt
  2026-10-29 mot FPL:s xG" är användbart. "Oddsen är uppblåsta" är det inte.
- **Rätta stale text i samma commit.** En dokumentation som påstår något
  gammalt är värre än ingen, eftersom den läses som sann. Hittar du en
  felaktig rad, skriv om den och säg i commit-meddelandet att den var fel.
- **Commit-meddelandet bär resonemanget**, inte bara diffen: teorin, beviset,
  och vad som provades och förkastades.
- **Leta efter gratis diagnostik först** och skriv ned den när du hittar den.
  `/markets` och `/bookmakers` hos odds-api.io kräver ingen nyckel och kostar
  ingen kvot. Det tog alldeles för lång tid att upptäcka.

## Design principles (apply to every change)

- **Don't overengineer.** Simple beats complex.
- **No fallbacks.** One correct path, no silent alternatives. If a precondition
  isn't met, fail — don't quietly substitute data. (This bot has already shipped
  silent fallbacks that contradict its own README; hunt them down, don't add more.)
- **One way.** One way to do a thing, not several.
- **Clarity over compatibility.** Clear code beats backward-compat cruft.
- **Throw errors / fail fast.** Surface broken preconditions loudly.
- **No backups.** Trust the primary mechanism.
- **Separation of concerns.** One function, one responsibility.

## Development methodology

- **Surgical changes only.** Minimal, focused diffs. Don't refactor adjacent code
  you weren't asked to touch.
- **Evidence-based debugging.** Minimal, targeted logging — not scattershot.
- **Fix root causes, not symptoms.**
- **Collaborate.** Work with the user to find the most efficient solution; check
  in rather than assuming intent.

## Domain-specific cautions (FPL / odds)

These are known-fragile areas. Verify against **live FPL bootstrap data**
(`https://fantasy.premierleague.com/api/bootstrap-static/`) and the live odds
API — do not assume field names or behaviour from memory.

- **Vig / margin.** Implied probability as `1/odds` overstates true probability
  because of the bookmaker margin. Any probability that feeds the xP model — and
  therefore the captaincy ranking — must be justified. If a market is de-vigged in
  one place and not another, that's an inconsistency to flag with evidence.
- **Name matching.** Player matching by surname is fragile. Falling back to
  "first bucket entry" when a more specific match fails is exactly the kind of
  silent guess this project forbids — treat it as a bug, prove it, fix the root.
- **FPL field names.** Confirm every FPL field you read actually exists in the
  live bootstrap payload before relying on it. Don't trust a field name because it
  looks plausible.

## Working rhythm

- For any multi-step task, **stop and report after each phase** before proceeding,
  unless the user says to run straight through.
- When something about FPL rules or external data is unclear, **search and cite** —
  don't guess.
- Ask one question too many rather than assume the wrong thing.
