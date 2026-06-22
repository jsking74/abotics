/**
 * The Transform Engine — Generator  (Pillar 1 cont.: fair-by-construction puzzles)
 *
 * Produces a Transform (rule, evidence, query) that satisfies the fairness
 * invariant BY CONSTRUCTION and hits a target difficulty.
 *
 * The key idea (backward construction): we do NOT generate evidence and hope it's
 * fair. We pick the secret rule first, then construct the *teaching set* — the
 * minimal evidence that eliminates every rival rule. Whatever rivals survive are
 * behaviorally identical to the secret on the whole probe domain, so they agree
 * with it on any query. Fairness is therefore guaranteed, not checked-and-prayed.
 *
 * EXACTNESS CAVEAT (read this): the guarantee is exact only when we discriminate
 * against the ENTIRE rule space. For small/enumerable spaces we do exactly that.
 * For large spaces we sample rivals (`budget.rivals`) and the guarantee degrades
 * to probabilistic — same caveat as `isFair`'s sampling. The generator enumerates
 * fully when `space.size() <= budget.rivals` and warns otherwise.
 */

import {
  Transform,
  Rule,
  RuleSpace,
  Example,
  Value,
  Kind,
  isFair,
  valueEquals,
} from "./transform";

// =============================================================================
// 1. WHAT THE GENERATOR NEEDS FROM A RULE-SPACE
// =============================================================================
//
// The runtime contract (RuleSpace) is what the SOLVER needs. The generator needs
// more: to enumerate/sample rules and probe inputs, and to mint a secret rule.
// Keeping this as a separate extension is deliberate — the base atom stays lean.

export type RNG = () => number; // returns [0,1); default Math.random

export interface GenerativeRuleSpace<In extends Kind = Kind, Out extends Kind = Kind>
  extends RuleSpace<In, Out> {
  /** Enumerate (or sample up to `limit`) the candidate universe R. */
  rules(limit?: number): Iterable<Rule<In, Out>>;
  /** Enumerate (or sample up to `limit`) candidate input values — the probe domain. */
  inputs(limit?: number): Iterable<Value<In>>;
  /** Mint a secret rule, optionally near a target complexity. */
  sampleRule(opts?: { complexity?: number; rng?: RNG }): Rule<In, Out>;
  /** Optional distance between inputs — drives query "near vs far" extrapolation. */
  inputDistance?(a: Value<In>, b: Value<In>): number;
}

// =============================================================================
// 2. DIFFICULTY KNOBS  (the dials from the spec, made explicit)
// =============================================================================

export interface DifficultySpec {
  /** Pick a secret of ~this complexity (inference depth). Default: any. */
  ruleComplexity?: number;
  /**
   * 0 = minimal teaching set (hardest: every example load-bearing).
   * >0 = add this many confirming/redundant examples (easier).
   */
  evidenceRedundancy?: number;
  /** Query close to the evidence (easier, interpolation) vs far (harder, must generalize). */
  queryExtrapolation?: "near" | "far";
}

export interface GenerateOptions<In extends Kind = Kind, Out extends Kind = Kind> {
  space: GenerativeRuleSpace<In, Out>;
  difficulty?: DifficultySpec;
  rng?: RNG;
  idPrefix?: string;
  /** Caps for tractability on large spaces. Full enumeration when size <= rivals. */
  budget?: { rivals?: number; probes?: number };
}

export interface DifficultyEstimate {
  spaceBits: number; // log2(|R|) — prior uncertainty before any evidence
  teachingSize: number; // load-bearing examples ≈ teaching dimension
  ruleComplexity: number;
  antiBruteForceBits: number; // log2(answer-space size at the query)
  queryExtrapolation: number; // query distance from evidence (0 if unknown)
  score: number; // combined, monotone in "harder"
}

export interface GenerateResult<In extends Kind = Kind, Out extends Kind = Kind> {
  transform: Transform<In, Out>;
  /** The load-bearing probes. Also the basis for hints and interactive-probe order. */
  teachingSet: ReadonlyArray<Example<In, Out>>;
  estimatedDifficulty: DifficultyEstimate;
  /** True if discrimination was against the full space (exact guarantee). */
  exact: boolean;
}

// =============================================================================
// 3. THE GENERATOR
// =============================================================================

export function generate<In extends Kind, Out extends Kind>(
  opts: GenerateOptions<In, Out>,
): GenerateResult<In, Out> {
  const { space } = opts;
  const rng = opts.rng ?? Math.random;
  const difficulty = opts.difficulty ?? {};
  const budgetRivals = opts.budget?.rivals ?? 5000;
  const budgetProbes = opts.budget?.probes ?? 5000;

  const exact = space.size() <= budgetRivals;
  if (!exact) {
    // Probabilistic regime — surface it loudly so callers don't trust a false guarantee.
    console.warn(
      `[generator] |R|=${space.size()} > budget ${budgetRivals}: discriminating against a SAMPLE. Fairness is probabilistic, not exact.`,
    );
  }

  // 1. Pick the secret rule — backward construction starts from the answer.
  const rule = space.sampleRule({ complexity: difficulty.ruleComplexity, rng });

  // 2. Gather rivals and probe inputs (bounded).
  const rivals = [...space.rules(budgetRivals)].filter((r) => r !== rule);
  const probes = [...space.inputs(budgetProbes)];
  if (probes.length === 0) throw new Error("[generator] empty probe domain");

  // 3. Teaching set: greedy set-cover of rivals by discriminating probes.
  const teachingInputs = greedyTeachingSet(rule, rivals, probes);

  // 4. Survivors = rivals indistinguishable from `rule` on the teaching set.
  //    By construction they agree with `rule` on EVERY probe, hence on any query.
  const survivors = rivals.filter((r) =>
    teachingInputs.every((x) => valueEquals(r.apply(x), rule.apply(x))),
  );

  // 5. Optional redundancy to LOWER difficulty (extra confirming examples).
  const evidenceInputs = addRedundancy(
    teachingInputs,
    probes,
    difficulty.evidenceRedundancy ?? 0,
    rng,
  );

  // 6. Query: an input not used as evidence, ranked by the difficulty knobs.
  //    Every non-evidence probe is fair (survivors agree everywhere), so we are
  //    free to optimize the query purely for difficulty.
  const query = chooseQuery(rule, evidenceInputs, probes, space, difficulty, rng);

  // 7. Assemble.
  const evidence: Example<In, Out>[] = evidenceInputs.map((x) => ({
    input: x,
    output: rule.apply(x),
  }));
  const transform: Transform<In, Out> = {
    id: `${opts.idPrefix ?? "t"}-${Math.floor(rng() * 1e9).toString(36)}`,
    ruleSpace: space,
    rule,
    evidence,
    query,
    verify(candidate) {
      return valueEquals(candidate, this.rule.apply(this.query));
    },
  };

  // 8. Defensive self-check. Construction guarantees fairness; this catches bugs
  //    and the sampled-rival edge cases. In the exact regime it must always pass.
  if (!isFair(transform, valueEquals)) {
    throw new Error(
      "[generator] produced an unfair transform — construction bug or under-sampled rival set",
    );
  }

  const teachingSet: Example<In, Out>[] = teachingInputs.map((x) => ({
    input: x,
    output: rule.apply(x),
  }));

  return {
    transform,
    teachingSet,
    estimatedDifficulty: estimateDifficulty(transform, teachingInputs, survivors, space, difficulty),
    exact,
  };
}

// =============================================================================
// 4. THE HEART: greedy teaching set (a discriminating set / set cover)
// =============================================================================
//
// Each probe `x` "covers" (eliminates) the rivals that disagree with `rule` at x.
// We greedily pick the probe covering the most still-alive rivals until none can
// be eliminated. Rivals that no probe can eliminate are behaviorally identical to
// `rule` on the probe domain → they agree on every query → fairness is preserved
// whether or not they survive. (This is also why duplicate/equivalent rules in R
// are harmless.)

function greedyTeachingSet<In extends Kind, Out extends Kind>(
  rule: Rule<In, Out>,
  rivals: ReadonlyArray<Rule<In, Out>>,
  probes: ReadonlyArray<Value<In>>,
): Value<In>[] {
  let remaining = new Set(rivals);
  const chosen: Value<In>[] = [];

  while (remaining.size > 0) {
    let best: Value<In> | null = null;
    let bestKill: Rule<In, Out>[] = [];

    for (const x of probes) {
      const rx = rule.apply(x);
      const kill: Rule<In, Out>[] = [];
      for (const r of remaining) if (!valueEquals(r.apply(x), rx)) kill.push(r);
      if (kill.length > bestKill.length) {
        best = x;
        bestKill = kill;
      }
    }

    if (!best || bestKill.length === 0) break; // remaining rivals are indistinguishable
    chosen.push(best);
    for (const r of bestKill) remaining.delete(r);
  }

  // Always need at least one example for the player to have something to observe.
  if (chosen.length === 0 && probes.length > 0) chosen.push(probes[0]);
  return chosen;
}

// =============================================================================
// 5. SUPPORTING CHOICES
// =============================================================================

/** Add `extra` confirming examples (distinct from the teaching set) to ease difficulty. */
function addRedundancy<In extends Kind>(
  teaching: ReadonlyArray<Value<In>>,
  probes: ReadonlyArray<Value<In>>,
  extra: number,
  rng: RNG,
): Value<In>[] {
  if (extra <= 0) return [...teaching];
  const used = new Set(teaching);
  const pool = probes.filter((x) => !used.has(x));
  const picked: Value<In>[] = [];
  for (let i = 0; i < extra && pool.length > 0; i++) {
    picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return [...teaching, ...picked];
}

/**
 * Choose a query input (not used as evidence). All such probes are fair, so we
 * rank purely by difficulty: maximize anti-brute-force, and honor near/far
 * extrapolation relative to the evidence.
 */
function chooseQuery<In extends Kind, Out extends Kind>(
  rule: Rule<In, Out>,
  evidenceInputs: ReadonlyArray<Value<In>>,
  probes: ReadonlyArray<Value<In>>,
  space: GenerativeRuleSpace<In, Out>,
  difficulty: DifficultySpec,
  rng: RNG,
): Value<In> {
  const used = new Set(evidenceInputs);
  const candidates = probes.filter((x) => !used.has(x));
  if (candidates.length === 0) {
    // Degenerate: evidence used the whole domain. Reuse a probe as the query.
    return probes[Math.floor(rng() * probes.length)];
  }

  const dist = space.inputDistance;
  const distToEvidence = (x: Value<In>): number => {
    if (!dist || evidenceInputs.length === 0) return 0;
    return Math.min(...evidenceInputs.map((e) => dist(x, e)));
  };

  const scored = candidates.map((x) => {
    const abf = space.outputSpaceSize(x); // bigger = harder to guess
    const d = distToEvidence(x);
    const extrapolation =
      difficulty.queryExtrapolation === "far"
        ? d
        : difficulty.queryExtrapolation === "near"
          ? -d
          : 0;
    return { x, score: Math.log2(Math.max(2, abf)) + extrapolation };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].x;
}

/** Cold-start difficulty estimate — score a puzzle BEFORE any human plays it. */
function estimateDifficulty<In extends Kind, Out extends Kind>(
  t: Transform<In, Out>,
  teaching: ReadonlyArray<Value<In>>,
  survivors: ReadonlyArray<Rule<In, Out>>,
  space: GenerativeRuleSpace<In, Out>,
  difficulty: DifficultySpec,
): DifficultyEstimate {
  const spaceBits = Math.log2(Math.max(1, space.size()));
  const teachingSize = teaching.length;
  const antiBruteForceBits = Math.log2(Math.max(2, space.outputSpaceSize(t.query)));
  const dist = space.inputDistance;
  const queryExtrapolation =
    dist && t.evidence.length
      ? Math.min(...t.evidence.map((e) => dist(t.query, e.input)))
      : 0;

  // More candidate rules to sift, more load-bearing examples, deeper rule, larger
  // answer space, and farther extrapolation all push difficulty up. Redundancy in
  // the evidence pulls it down (each extra confirming example reduces the search).
  const redundancyRelief = (difficulty.evidenceRedundancy ?? 0) * 0.5;
  const score =
    spaceBits +
    teachingSize +
    t.rule.complexity +
    0.5 * antiBruteForceBits +
    queryExtrapolation -
    redundancyRelief;

  return {
    spaceBits,
    teachingSize,
    ruleComplexity: t.rule.complexity,
    antiBruteForceBits,
    queryExtrapolation,
    score,
  };
}

// =============================================================================
// 6. WORKED EXAMPLE  — a generative space + a generated, guaranteed-fair puzzle
// =============================================================================
//
// Domain: shapes transformed by (a color op) ∘ (a rotation). 2 × 4 = 8 rules,
// 2 × 3 × 4 = 24 inputs — small enough to enumerate, so the fairness guarantee is
// EXACT. This is the same family as transform.ts's worked example, now generated.

type Shape = {
  color: "red" | "blue";
  form: "triangle" | "square" | "arrow";
  rot: 0 | 90 | 180 | 270;
};
const SYM: Kind = { tag: "symbol" };
const val = (s: Shape): Value => ({ kind: SYM, data: s, skin: { modality: "spatial" } });

const COLORS: Shape["color"][] = ["red", "blue"];
const FORMS: Shape["form"][] = ["triangle", "square", "arrow"];
const ROTS: Shape["rot"][] = [0, 90, 180, 270];

const colorOps = [
  { name: "id", f: (c: Shape["color"]) => c, cost: 0 },
  { name: "swap", f: (c: Shape["color"]) => (c === "red" ? "blue" : "red") as Shape["color"], cost: 1 },
];

function makeRule(colorOp: (typeof colorOps)[number], turn: Shape["rot"]): Rule {
  return {
    apply: (i) => {
      const s = i.data as Shape;
      return val({ color: colorOp.f(s.color), form: s.form, rot: ((s.rot + turn) % 360) as Shape["rot"] });
    },
    complexity: colorOp.cost + (turn === 0 ? 0 : 1),
    describe: () => `${colorOp.name}-color ∘ rotate(${turn})`,
  };
}

const ALL_RULES: Rule[] = colorOps.flatMap((co) => ROTS.map((r) => makeRule(co, r)));
const ALL_INPUTS: Value[] = COLORS.flatMap((c) =>
  FORMS.flatMap((f) => ROTS.map((r) => val({ color: c, form: f, rot: r }))),
);

export const shapeSpace: GenerativeRuleSpace = {
  inKind: SYM,
  outKind: SYM,
  rules: (limit) => (limit ? ALL_RULES.slice(0, limit) : ALL_RULES),
  inputs: (limit) => (limit ? ALL_INPUTS.slice(0, limit) : ALL_INPUTS),
  sampleRule: (o) => {
    const pool =
      o?.complexity == null ? ALL_RULES : ALL_RULES.filter((r) => r.complexity === o.complexity);
    const rng = o?.rng ?? Math.random;
    return (pool.length ? pool : ALL_RULES)[Math.floor(rng() * (pool.length || ALL_RULES.length))];
  },
  consistent: (evidence) =>
    ALL_RULES.filter((r) => evidence.every((e) => valueEquals(r.apply(e.input), e.output))),
  outputSpaceSize: () => COLORS.length * FORMS.length * ROTS.length, // 24
  size: () => ALL_RULES.length, // 8
  inputDistance: (a, b) => {
    const x = a.data as Shape;
    const y = b.data as Shape;
    return (x.color !== y.color ? 1 : 0) + (x.form !== y.form ? 1 : 0) + (x.rot !== y.rot ? 1 : 0);
  },
};

// Usage:
//   const { transform, teachingSet, estimatedDifficulty, exact } =
//     generate({ space: shapeSpace, difficulty: { queryExtrapolation: "far" } });
//   // exact === true (8 rules fully enumerated)
//   // isFair(transform) === true   (guaranteed by construction)
//   // teachingSet = the minimal probes that pin the secret among all 8 rules
