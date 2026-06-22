/**
 * The Transform Engine — Solver  (the automated player / oracle)
 *
 * Recovers a hidden rule from evidence the way a human does: by probing a black
 * box and narrowing the hypothesis set until the query's answer is forced. It is
 * a PLAYER, not a cheater —
 *   - it may call the oracle (observe what the rule does to an input),
 *   - it may NOT read the secret rule, and
 *   - it may NOT probe the query input itself (that would be asking for the answer).
 *
 * What it powers:
 *   1. Validation   — can a rational agent actually solve this puzzle in budget?
 *   2. Difficulty   — the measured probe count replaces the generator's proxy.
 *   3. Hints        — the next most-informative probe, live hypothesis count, etc.
 *
 * Stopping condition is QUERY AGREEMENT, not full identification: the solver stops
 * as soon as every surviving hypothesis agrees on the query's answer. You don't
 * have to know the exact rule — only enough to answer. (Matches the fairness law.)
 */

import { Transform, Rule, Value, Kind, Example, valueEquals } from "./transform";
import { GenerativeRuleSpace, RNG } from "./generator";

/** The black box. Internally `rule.apply`, but the solver treats it opaquely. */
export type Oracle<In extends Kind = Kind, Out extends Kind = Kind> = (
  input: Value<In>,
) => Value<Out>;

export type ProbeStrategy = "halving" | "entropy" | "random";

export interface SolveOptions<In extends Kind = Kind, Out extends Kind = Kind> {
  space: GenerativeRuleSpace<In, Out>;
  query: Value<In>;
  oracle: Oracle<In, Out>;
  /** Evidence already revealed before probing begins (passive start). */
  initialEvidence?: ReadonlyArray<Example<In, Out>>;
  budget?: number; // max probes; default 64
  strategy?: ProbeStrategy; // default "halving" (minimize worst-case survivors)
  rng?: RNG;
}

export interface ProbeStep<In extends Kind = Kind, Out extends Kind = Kind> {
  input: Value<In>;
  output: Value<Out>;
  hypothesesAfter: number;
}

export interface SolveResult<In extends Kind = Kind, Out extends Kind = Kind> {
  solved: boolean;
  answer?: Value<Out>;
  probes: ProbeStep<In, Out>[]; // the solution path; length = measured difficulty
  hypothesesRemaining: number;
  reason: "agreed" | "budget_exhausted" | "no_consistent_rule" | "stuck";
}

// =============================================================================
// 1. CORE: active solve (probe the black box)
// =============================================================================

export function solve<In extends Kind, Out extends Kind>(
  opts: SolveOptions<In, Out>,
): SolveResult<In, Out> {
  const { space, query, oracle } = opts;
  const strategy = opts.strategy ?? "halving";
  const budget = opts.budget ?? 64;
  const rng = opts.rng ?? Math.random;

  // Hypothesis set H = rules consistent with whatever evidence we already have.
  let H = [...space.consistent(opts.initialEvidence ?? [])];

  // Candidate probes: every input EXCEPT the query and any already-known evidence.
  const known = new Set<string>([key(query), ...(opts.initialEvidence ?? []).map((e) => key(e.input))]);
  const candidates = [...space.inputs()].filter((x) => !known.has(key(x)));

  const probes: ProbeStep<In, Out>[] = [];

  while (probes.length < budget) {
    if (H.length === 0) {
      return finish(false, undefined, probes, 0, "no_consistent_rule");
    }
    if (agreeOnQuery(H, query)) {
      return finish(true, H[0].apply(query), probes, H.length, "agreed");
    }

    const x = chooseProbe(H, candidates, strategy, rng);
    if (!x) {
      // No remaining probe can split H, yet H disagrees on the query.
      // For a fair puzzle this cannot happen; surface it if it does.
      return finish(false, undefined, probes, H.length, "stuck");
    }

    const y = oracle(x); // observe the black box
    H = H.filter((r) => valueEquals(r.apply(x), y)); // eliminate inconsistent hypotheses
    known.add(key(x));
    const idx = candidates.findIndex((c) => key(c) === key(x));
    if (idx >= 0) candidates.splice(idx, 1);
    probes.push({ input: x, output: y, hypothesesAfter: H.length });
  }

  // Out of budget. Answer only if the survivors happen to agree.
  const agreed = agreeOnQuery(H, query);
  return finish(agreed, agreed ? H[0].apply(query) : undefined, probes, H.length, "budget_exhausted");

  function finish(
    solved: boolean,
    answer: Value<Out> | undefined,
    p: ProbeStep<In, Out>[],
    remaining: number,
    reason: SolveResult<In, Out>["reason"],
  ): SolveResult<In, Out> {
    return { solved, answer, probes: p, hypothesesRemaining: remaining, reason };
  }
}

// =============================================================================
// 2. PASSIVE (DEDUCTIVE) SOLVE — no probing, just reason from fixed evidence
// =============================================================================

export interface DeductiveResult<Out extends Kind = Kind> {
  solved: boolean; // all rules consistent with the evidence agree on the query
  answer?: Value<Out>;
  hypotheses: number; // |H|
}

export function solveDeductive<In extends Kind, Out extends Kind>(
  t: Transform<In, Out>,
): DeductiveResult<Out> {
  const H = [...t.ruleSpace.consistent(t.evidence)];
  if (H.length === 0) return { solved: false, hypotheses: 0 };
  const solved = agreeOnQuery(H, t.query);
  return { solved, answer: solved ? H[0].apply(t.query) : undefined, hypotheses: H.length };
}

// =============================================================================
// 3. VALIDATION GATE + MEASURED DIFFICULTY
// =============================================================================

export interface Validation<In extends Kind = Kind, Out extends Kind = Kind> {
  solvable: boolean;
  /** Real probe count a rational solver needed — the measured difficulty. */
  measuredProbes: number;
  /** Sanity: solver's answer matches the secret's true answer. */
  correct: boolean;
  reason: SolveResult<In, Out>["reason"];
}

/**
 * QA a generated puzzle before serving it: run the solver against it (using the
 * secret only to build the oracle — never exposed to the solver) and confirm it's
 * solvable, while measuring true difficulty.
 */
export function validate<In extends Kind, Out extends Kind>(
  t: Transform<In, Out>,
  space: GenerativeRuleSpace<In, Out>,
  budget = 64,
  strategy: ProbeStrategy = "halving",
): Validation<In, Out> {
  const oracle: Oracle<In, Out> = (x) => t.rule.apply(x); // black box wrapper
  const r = solve({ space, query: t.query, oracle, initialEvidence: t.evidence, budget, strategy });
  const truth = t.rule.apply(t.query);
  return {
    solvable: r.solved,
    measuredProbes: r.probes.length,
    correct: r.answer != null && valueEquals(r.answer, truth),
    reason: r.reason,
  };
}

// =============================================================================
// 4. HINTS — a live solver the session drives as a human plays
// =============================================================================

export interface Hinter<In extends Kind = Kind, Out extends Kind = Kind> {
  /** Feed in each probe the human makes; updates the hypothesis set. */
  observe(input: Value<In>, output: Value<Out>): void;
  /** How many rules are still consistent (progress feedback). */
  hypothesisCount(): number;
  /** Have the survivors converged on the query answer? */
  solvedYet(): boolean;
  /** The answer, once the survivors agree. */
  likelyAnswer(): Value<Out> | undefined;
  /** Gentle hint: the most informative input to try next (never the query). */
  nextProbe(): Value<In> | undefined;
  /** Stronger hint: descriptions of up to `n` surviving hypotheses. */
  summaries(n?: number): string[];
}

export function makeHinter<In extends Kind, Out extends Kind>(opts: {
  space: GenerativeRuleSpace<In, Out>;
  query: Value<In>;
  initialEvidence?: ReadonlyArray<Example<In, Out>>;
  strategy?: ProbeStrategy;
  rng?: RNG;
}): Hinter<In, Out> {
  const strategy = opts.strategy ?? "halving";
  const rng = opts.rng ?? Math.random;
  let H = [...opts.space.consistent(opts.initialEvidence ?? [])];
  const seen = new Set<string>([key(opts.query), ...(opts.initialEvidence ?? []).map((e) => key(e.input))]);

  return {
    observe(input, output) {
      H = H.filter((r) => valueEquals(r.apply(input), output));
      seen.add(key(input));
    },
    hypothesisCount: () => H.length,
    solvedYet: () => H.length > 0 && agreeOnQuery(H, opts.query),
    likelyAnswer: () => (H.length > 0 && agreeOnQuery(H, opts.query) ? H[0].apply(opts.query) : undefined),
    nextProbe: () => {
      const candidates = [...opts.space.inputs()].filter((x) => !seen.has(key(x)));
      return chooseProbe(H, candidates, strategy, rng) ?? undefined;
    },
    summaries: (n = 3) =>
      H.slice(0, n).map((r, i) => r.describe?.() ?? `hypothesis #${i + 1}`),
  };
}

// =============================================================================
// 5. PROBE SELECTION — the intelligence
// =============================================================================
//
// "halving": pick the probe that minimizes the worst-case number of surviving
//            hypotheses (guarantees ~log2(|H|) probes — near optimal).
// "entropy": pick the probe with the most even split of H (max expected info).
// "random":  baseline.
// A probe that doesn't split H at all is useless and skipped.

function chooseProbe<In extends Kind, Out extends Kind>(
  H: ReadonlyArray<Rule<In, Out>>,
  candidates: ReadonlyArray<Value<In>>,
  strategy: ProbeStrategy,
  rng: RNG,
): Value<In> | null {
  if (H.length <= 1) return null;

  if (strategy === "random") {
    const useful = candidates.filter((x) => buckets(H, x).size > 1);
    return useful.length ? useful[Math.floor(rng() * useful.length)] : null;
  }

  let best: Value<In> | null = null;
  let bestScore = -Infinity;

  for (const x of candidates) {
    const b = buckets(H, x);
    if (b.size <= 1) continue; // doesn't distinguish any hypotheses

    let score: number;
    if (strategy === "halving") {
      const worst = Math.max(...[...b.values()]); // largest surviving bucket
      score = -worst; // smaller worst case is better
    } else {
      // entropy
      const total = H.length;
      let h = 0;
      for (const c of b.values()) {
        const p = c / total;
        h -= p * Math.log2(p);
      }
      score = h;
    }
    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && rng() < 0.5)) {
      bestScore = score;
      best = x;
    }
  }
  return best;
}

/** Group H by the output each rule produces at `x` (the partition `x` induces). */
function buckets<In extends Kind, Out extends Kind>(
  H: ReadonlyArray<Rule<In, Out>>,
  x: Value<In>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of H) {
    const k = JSON.stringify(r.apply(x).data);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// =============================================================================
// 6. HELPERS
// =============================================================================

/** Do all hypotheses agree on the query's answer? (the stopping condition) */
function agreeOnQuery<In extends Kind, Out extends Kind>(
  H: ReadonlyArray<Rule<In, Out>>,
  query: Value<In>,
): boolean {
  if (H.length === 0) return false;
  const first = JSON.stringify(H[0].apply(query).data);
  for (let i = 1; i < H.length; i++) {
    if (JSON.stringify(H[i].apply(query).data) !== first) return false;
  }
  return true;
}

function key(v: Value): string {
  return JSON.stringify(v.data);
}

// =============================================================================
// 7. WORKED EXAMPLE  — generate a puzzle, then solve it as a black box
// =============================================================================
//
//   import { generate, shapeSpace } from "./generator";
//
//   const { transform } = generate({ space: shapeSpace, difficulty: { queryExtrapolation: "far" } });
//
//   // Build the oracle from the secret — the ONLY place the rule is touched.
//   const result = solve({
//     space: shapeSpace,
//     query: transform.query,
//     oracle: (x) => transform.rule.apply(x),
//     initialEvidence: transform.evidence,
//   });
//
//   // result.solved === true
//   // result.probes.length === measured difficulty (often 0–2 for the 8-rule space,
//   //   since the evidence already pins most of it)
//   // valueEquals(result.answer!, transform.rule.apply(transform.query)) === true
//
//   // And for QA + difficulty in one call:
//   //   const v = validate(transform, shapeSpace);  // { solvable, measuredProbes, correct, reason }
