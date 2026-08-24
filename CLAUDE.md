# Etaros — project instructions

Read alongside the global `~/.claude/CLAUDE.md`. Where they disagree, this file
wins for anything inside `~/sidekick`.

Source-of-truth documents, in order. Read them before proposing changes rather
than re-deriving what they already settle:

- `PRODUCT.md` — what Etaros is, who it is for, the binding brand commitments
- `DESIGN.md` — the design system as actually built, plus its known debt
- `_private/philosophy.md` — positioning and voice, the five commitments
- `.agents/product-marketing.md` — ICP, competitors, objections, visual identity
- `_private/design-brief.md` — the full UI brief and the skill sequence

## Constraints that are not up for discussion

- **Electron 33, vanilla JS, no framework, no build step.** One HTML file per
  surface with inline `<style>`. Do not propose React, Tailwind or a bundler.
- **The light theme must keep working.** Automatic (follows the OS) is the
  default; an explicit choice outranks the system.
- **Analysis runs on Mistral, in the EU.** Never write copy claiming Claude,
  Google, or "AI-powered" as a headline. That claim is false and it breaks
  commitment 2.
- **`app.config.js` is gitignored and never committed.** No provider key ships
  inside the app; the Cloudflare Worker holds it.
- **`_private/` and `.agents/` are never tracked.** They hold financials, grant
  applications and positioning. `scripts/guard.sh` blocks this at commit time.

## Tone, from philosophy.md

Quiet by default — silence on a safe screen is a feature. No theatre: no skull
icons, no fake terminal output, no INTRUSION DETECTED. Never condescending;
people who get scammed were targeted by professionals. Green, amber and red mean
a verdict and nothing else.

## What "looks AI-generated" means here

Every one of these was a real finding in this codebase. Check for them again
before claiming a surface is done:

1. Unicode glyphs standing in for icons. Icons are drawn SVG at one stroke weight.
2. A sub-heading under a heading that restates it.
3. One screen calling the same thing two different names.
4. A value that exists once — a font size, a radius, a colour used nowhere else.
5. Dead CSS for elements absent from both the markup and the renderer.
6. Copy that contradicts the code: a provider no longer used, a removed feature.
7. Colour carrying no meaning.
8. Motion that loops on its own. Movement answers an action, or it does not exist.

## How to work here

- **Measure before and after. Report counts, not adjectives.** "22 font sizes
  became 7" is a result; "cleaner typography" is not.
- **Verify what you changed.** A change you have not seen render is not
  finished. Use the browser tools or run the app; screenshot the result.
- **Never run one regex across a whole stylesheet.** It has broken this codebase
  twice: once injecting `var()` inside `cubic-bezier()`, once snapping the
  `400px` inside the `calc()` that centres the conversation column. Work per
  selector, and re-render after any sweep.
- **Say what you did not do, and why.** An honest gap is worth more than a claim
  that has to be checked.
- **If the brief contradicts itself, say so once and offer the choice.** "Quiet
  by default" and "more animation" pull opposite ways; do not silently average
  them.

## Skills, in order

Understanding first, system second, expression last. Expression before system is
what produces the generated look.

```
/impeccable critique <file>     scored UX review
/impeccable audit <file>        a11y, responsive, performance
/impeccable extract <file>      repeated values into tokens
/impeccable typeset <file>      hierarchy and scale
/impeccable layout <file>       spacing and rhythm
/impeccable polish <file>       final pass
/impeccable harden <file>       error, empty and edge states
/verify                         drive the real app
/code-review high               correctness
/security-review                this is a security product
```

The app (`index.html`) is **Operate** — the task outranks expression. The site
(`docs/index.html`) is **Persuade** — it has to earn attention. Do not carry the
app's restraint onto the landing page.

## Things the user does personally

Account creation, payment and Stripe or Paddle actions, repository visibility,
and any entry of credentials or secrets. Offer the exact command; do not run it.
