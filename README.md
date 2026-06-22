# The Transform Engine

*(working title)*

A generative, self-improving engine for stimulating puzzles — designed to run as
an experience layer ("cartridge") on top of the **mithril-matrix** platform's
phone-to-screen and phone-to-phone primitives.

---

## North Star

> **A hidden rule, wrapped in a layer of abstraction, that can be puzzled through logically.**

Every part of this system answers to that one sentence. The test for whether
anything belongs: *is it a hidden rule, abstracted, that yields to logic?* If
yes, it's in. If no, cut it.

That sentence already contains the whole design:

- *"a hidden rule"* → **the atom** (the Transform)
- *"a layer of abstraction"* → **scalability** (turn the layer up, depth grows without ceiling)
- *"puzzled through logically"* → **fairness** (solvable by reasoning, never by luck or brute force)

---

## What this is

Not a puzzle. Not an escape room. An engine that **generates** intellectually
stimulating scenarios from a single foundational atom, makes them **deeper**
through composition, makes them **social** through distribution, and makes itself
**better over time** through feedback. The escape-room / adventure framing is
just a skin; the value is the engine underneath.

It is deliberately a *miniature of the realm's self-improving loop* — a bounded,
low-stakes, endlessly playable sandbox that trains (and shares a brain with) the
same machinery that manages the realm.

---

## Pillar 1 — The Atom: the Transform

A **Transform** is a hidden rule `r`, drawn from a rule-space `R`, presented as
evidence, with a gap the solver crosses by recovering and applying `r`.

```
Transform {
  R         // rule-space: the universe of possible hidden rules
  r ∈ R     // the secret  — the GENERATIVE face (the system builds with it)
  E         // evidence: observable manifestations of r (examples, behaviors)
  q         // query: the input the solver must transform once they "get it"
  verify(x) // true iff x == r(q) — checks APPLICATION, not the stated rule
}
```

The solver never sees `r`. They observe `E`, **infer** a candidate `r'`,
**test** it, and **apply** it to `q`. The distance from `E` to `r` is the
challenge; the click of `r' ≈ r` is the reward.

The rule has **two faces**: a *generative* face (the system constructs the
scenario from `r`) and an *epistemic* face (the solver reconstructs `r` to
solve). The distance between those faces **is** the puzzle.

### The fairness invariant ("solvable by insight")

> Let `H` = every rule in `R` consistent with the evidence `E`.
> The Transform is **fair** iff every rule in `H` gives the **same answer to `q`**.

No ambiguity, no "you couldn't have known," no guessing. Evidence must pin the
answer by reasoning alone. (Multi-agent version in Pillar 3.)

This also defines difficulty for free: difficulty ≈ how much work it takes to
shrink `H` (or find any consistent `r'`) given how rich `R` is and how sparse or
noisy `E` is.

### Reward (formalized)

> **reward ∝ compression(`r`, `E`) × inference-depth × anti-brute-force-margin**

- **Compression** — `r` is far simpler than the evidence it explains. Finding the
  elegant rule behind the mess *is* the dopamine. (Also a clean, learnable
  "interestingness" signal — see Pillar 4.)
- **Anti-brute-force margin** — `q`'s answer space is large enough that guessing
  fails, so success *proves* understanding. `verify` checks application precisely
  so the reward is earned.
- **Inference depth** — reasoning steps from evidence to rule.

### Substrate independence (skins)

The logic `(R, r, E, q)` is separate from the **skin** that renders it —
symbols, a grid, audio, color, language, space. One atom, infinite costumes. The
same rule re-skinned feels brand new, and skins can be mixed.

---

## Pillar 2 — Composition (the depth engine)

Depth must scale in *thought*, not *length*. Three modes, increasing in depth:

1. **Functional** (`output → input`): the answer to `T1` feeds `T2`'s query or
   evidence. Useful but mechanical — adds steps.
2. **Epistemic** (the deep one): `T2`'s evidence is **unreadable until `r1` is
   recovered**. `r1` is the *lens* that makes `T2`'s pattern even perceptible.
   You can't see the next puzzle until you understand this one. Depth, not length
   — each insight unlocks *visibility*, not just a door.
3. **Meta**: a Transform whose domain *is rules* — `r` operates on other rules
   ("the rule itself changes by a meta-rule"). Top of the abstraction axis. **No
   ceiling.** This is what guarantees it never gets old.

---

## Pillar 3 — Distribution (the social layer)

Group size (number of phones) is a **second, orthogonal dial**. The rule's
abstraction is one axis; how facts are spread across players is another. The
abstraction here comes *through required communication* — the human channel
itself becomes part of the puzzle.

A `distribute(E, N)` step assigns facts to `N` phones via two operations:

- **Separate (partition):** split the evidence so no one phone has the whole
  picture. Scales with how finely it's cut and how many fragments must be merged.
  More phones → finer separation → more comms required.
- **Duplicate (replicate):** put the same fact on multiple phones. Unlocks:
  - **verification / consensus** ("we both have this — do we agree?")
  - **ambiguity** (is this fact unique or shared?)
  - **corrupted copies** (duplicate but subtly alter one → the group must *find
    the lie* by cross-checking — deduction stacked on the social layer)

Deepest consequence: when facts are scattered, the group must **invent its own
protocol** to share them (who reports what, in what order, how to confirm). That
protocol-building is itself a puzzle that doesn't exist with one phone.

The dials are **orthogonal**: hold the rule fixed and scale difficulty purely by
spreading facts wider, or hold distribution and deepen the rule. They multiply.

### Multi-agent fairness invariant

> No single phone need be solvable alone, but the **union of all phones' facts
> must** satisfy the fairness invariant. The *group* can always reason it out; no
> *individual* necessarily can.

Advanced knobs (later): asymmetric distribution (natural roles/leader), a
constrained **comms graph** (who may talk to whom — a network-topology puzzle),
and **bandwidth limits** (few messages → forces compression, echoing the
reward principle).

---

## Pillar 4 — Feedback → Ontology (the improvement loop)

This closes the loop: generation makes puzzles; feedback teaches the system what
"good" means.

Two signals:

- **Implicit (free):** play already emits solved/failed, time-to-solve, probe
  count, hints used, where players got stuck, abandonment, and (in groups) comms
  patterns.
- **Explicit (one tap — keep it effortless):** "satisfying / too easy / unfair /
  confusing."

> The reward formula is only a **prediction** of quality. The feedback tap is the
> **actual human label.** The gap between *predicted* and *felt* reward is the
> training signal — it turns the heuristic from a guess into a learned model.

### Log vs. ontology

- A **log** is raw events ("group of 3, rule = color-swap-rotate, separated 2
  ways, solved in 4:12, rated 'satisfying'").
- The **ontology** is distilled from many logs — structured concepts and their
  relationships:

> **rule-type × abstraction level × inference mode × distribution shape ×
> group size/skill → reward**

That map — *"this kind of rule, abstracted this far, split this way, for a group
like this, produces this much delight"* — is the ontology for improvement. The
loop reads it → hypothesizes what generates reward → biases new generation →
measures actual feedback → updates the map.

> generate → play → log → distill → learn → generate better

### Architectural decision

Do **not** build a parallel telemetry system. **Emit into the realm's existing
log/ontology**, using the same conventions, so the self-improving machinery
already built for the realm works on this sandbox for free. Sandbox and main loop
share a brain.

### Cautions

1. **Feedback is sparse and biased** — people rate when delighted or annoyed,
   rarely when neutral. Weight implicit signal heavily; treat explicit taps as
   rare, high-value labels. Cold-start on the compression heuristic.
2. **Goodhart risk** — optimizing purely for "satisfying" drifts toward easy
   dopamine (too-easy puzzles rate well). Balance reward against *challenge and
   novelty*. The thing that should never get old must not optimize itself *into*
   old.

---

## The Interaction Model

The Transform's two faces map directly onto mithril-matrix's surfaces:

- **Screen = shared reality** — the evidence, the gap, and the reward theater
  (public; everyone sees it).
- **Phone = your lab and your hands** — experiment, hypothesize, apply, submit
  (private).

### Core interaction: a black box you interrogate

```
phone sends an input → screen shows what the hidden rule did to it →
infer the rule → submit your answer on the phone → screen plays the reward
```

The scientific method as a game: poke the black box, watch the world react,
figure out the law, prove it.

### Phone-to-phone

Split the two faces across people. Example: Phone A can *only send inputs*;
Phone B can *only see outputs*. Neither sees a before-*and*-after pair alone, so
they must talk. The rule lives in the gap *between* players. (The *Keep Talking
and Nobody Explodes* dynamic — but generated and self-scaling.)

| Transform part | Phone → Screen | Phone → Phone |
|---|---|---|
| Evidence `E` | shown on screen / probed via phone | **split across phones** — must be pooled |
| Apply the rule | manipulate on your phone | one applies, others advise |
| Query `q` | challenge on the shared screen | shared; inputs gated per person |
| `verify` + reward | screen erupts (public payoff) | shared win — earned together |
| Epistemic composition | rule #1 decodes what the screen shows next | rule #1 unlocks what *another phone* can read |

---

## Worked example

Hidden rule `r`: *swap red↔blue, and rotate the shape 90°.*

- Screen shows a "machine"; the phone feeds it shapes.
- Send a **red triangle** → screen returns a **blue triangle, rotated**. Send a
  **blue square** → **red square, rotated**. *(Gathering evidence `E` by
  experiment.)*
- The locked door shows the **query** `q`: a **red arrow** in the input slot —
  "what comes out?"
- On the phone, recolor to blue, rotate 90°, **submit**. `verify` checks it.
- Correct → the screen erupts and the next chamber opens. The public payoff *is*
  the shared "aha."

**Fairness in practice:** the allowed probes must uniquely pin the rule — e.g.,
"rotate 90°" must be distinguishable from "flip."

**Make it social:** Phone A only sends inputs, Phone B only sees outputs. They
reconstruct `r` by talking. Same atom, now forced collaboration.

---

## Design invariants (non-negotiable)

1. Every challenge is a **hidden rule, abstracted, solvable by logic.**
2. **Fairness** holds — solvable by reasoning, never by guess or brute force
   (multi-agent: over the union of facts).
3. Reward is **earned through understanding**, not labor — `verify` checks
   application.
4. Depth scales by **abstraction and composition**, not by length.
5. The system **learns** from play and never optimizes itself into staleness.

---

## Build order (seed first)

1. **Primitive contract** — formalize the Transform interface and the
   output→input type system that lets any two compose. *(The keystone.)*
2. **Three composable primitives + one hand-built level on mm** — e.g.
   Decoder → Lock → Reveal, played phone-in / screen-out. Proves composition and
   the cartridge in one shot.
3. **The generator** — build levels by *backward construction* from the goal so
   they're solvable by guarantee, hitting a target difficulty.
4. **Endless / progressive mode** — difficulty curve via the dials.
5. **Distribution layer** — separate/duplicate across phones.
6. **Feedback → ontology** — emit into the realm's log; close the loop.

---

## Open questions

- The **generator** is the technical crux: how to algorithmically produce
  `(r, E, q)` that provably satisfies fairness *and* hits a target difficulty.
  (Backward construction + a verifier/solver is the likely path.)
- **Cold-start difficulty estimation** — an automated solver to score a puzzle's
  hardness before any human plays it.
- The **rule-space `R`** design — rich enough for depth, structured enough to
  generate and reason over.
- Exact **schema alignment** with the realm's existing log/ontology.
