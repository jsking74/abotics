/**
 * The Transform Engine — Primitive Contract  (Pillar 1 + the composition type system)
 *
 * NORTH STAR:
 *   "A hidden rule, wrapped in a layer of abstraction, that can be puzzled
 *    through logically."
 *
 * This file is the keystone: the formal shape every puzzle primitive implements,
 * and the output->input type system that lets any two compose. Everything else
 * in the engine (generator, endless mode, distribution, feedback) is operations
 * on this atom.
 *
 * Status: contract + illustrative reference implementations. Generation,
 * distribution (Pillar 3), and feedback (Pillar 4) are stubbed as forward hooks.
 */

// =============================================================================
// 1. VALUES & KINDS  — the type system that makes composition checkable
// =============================================================================

/**
 * A semantic type tag. Composition compatibility is checked against `Kind` ONLY.
 * Presentation (the "skin") is separate and never consulted by solving logic,
 * which is what makes one atom render as symbols, grids, color, audio, etc.
 *
 * The `rule` kind is what gives META composition for free: a Value can carry a
 * Rule as its data, so a Transform over rule-valued kinds is a rule about rules.
 */
export type Kind =
  | { tag: "symbol" }
  | { tag: "number" }
  | { tag: "color" }
  | { tag: "sequence"; of: Kind }
  | { tag: "grid"; of: Kind }
  | { tag: "set"; of: Kind }
  | { tag: "tuple"; of: Kind[] }
  | { tag: "rule"; in: Kind; out: Kind };

/**
 * A typed value passed as evidence, query, answer, or between composed
 * transforms. `data` shape is determined by `kind`. `skin` is presentation-only.
 */
export interface Value<K extends Kind = Kind> {
  readonly kind: K;
  readonly data: unknown;
  readonly skin?: SkinHint;
}

/** Presentation metadata. Read by renderers; ignored by composition & solving. */
export interface SkinHint {
  readonly modality: "symbol" | "spatial" | "color" | "audio" | "text" | "mixed";
  readonly [extra: string]: unknown;
}

/**
 * Structural assignability: may a value of `from` be used where `to` is wanted?
 * This is the gate every composition must pass.
 */
export function assignable(from: Kind, to: Kind): boolean {
  if (from.tag !== to.tag) return false;
  switch (from.tag) {
    case "sequence":
    case "grid":
    case "set":
      return assignable(from.of, (to as typeof from).of);
    case "tuple": {
      const t = to as Extract<Kind, { tag: "tuple" }>;
      return (
        from.of.length === t.of.length &&
        from.of.every((k, i) => assignable(k, t.of[i]))
      );
    }
    case "rule": {
      const t = to as Extract<Kind, { tag: "rule" }>;
      // rules are compatible when their in/out kinds are
      return assignable(from.in, t.in) && assignable(from.out, t.out);
    }
    default:
      return true; // scalar kinds: tag match is enough
  }
}

// =============================================================================
// 2. RULE, RULE-SPACE, EVIDENCE
// =============================================================================

/**
 * The hidden mapping — the GENERATIVE face. The solver's whole job is to
 * reconstruct this behavior well enough to answer the query.
 */
export interface Rule<In extends Kind = Kind, Out extends Kind = Kind> {
  /** Apply the rule. This is what `verify` checks the solver against. */
  apply(input: Value<In>): Value<Out>;
  /**
   * Description-length proxy (~ Kolmogorov size). Smaller rule explaining larger
   * evidence => higher compression => higher reward. Drives the "aha".
   */
  readonly complexity: number;
  /** Canonical description for tooling/telemetry ONLY. Never shown to the solver. */
  readonly describe?: () => string;
}

/**
 * The universe of candidate rules. Its richness and structure set difficulty and
 * generality. `consistent()` yields H — the set of rules compatible with the
 * given evidence — which is the basis of the fairness check.
 */
export interface RuleSpace<In extends Kind = Kind, Out extends Kind = Kind> {
  readonly inKind: In;
  readonly outKind: Out;
  /**
   * H = rules in R consistent with `evidence`. May be infinite; implementations
   * may sample. Fairness/difficulty reason over this set.
   */
  consistent(evidence: ReadonlyArray<Example<In, Out>>): Iterable<Rule<In, Out>>;
  /** Size of the answer space for `query` — the anti-brute-force margin. */
  outputSpaceSize(query: Value<In>): number;
  /** Richness of R — a coarse difficulty proxy. */
  size(): number;
}

/** An observed (input -> output) pair: output === rule.apply(input). */
export interface Example<In extends Kind = Kind, Out extends Kind = Kind> {
  readonly input: Value<In>;
  readonly output: Value<Out>;
}

// =============================================================================
// 3. THE TRANSFORM  — the atom
// =============================================================================

/**
 * A hidden rule, presented as evidence, with a gap the solver crosses by
 * recovering and applying the rule.
 *
 * Two faces:
 *   - generative: the system holds `rule` and builds `evidence` + `query` from it
 *   - epistemic:  the solver sees `evidence` + `query`, infers r', and applies it
 *
 * The distance between the faces IS the puzzle. The click of r' ≈ rule IS the reward.
 *
 * SERIALIZATION RULE: `rule` is the secret. It lives only on the generative side
 * and must never be sent to the client. Clients receive evidence, query, and a
 * way to submit candidates for verification.
 */
export interface Transform<In extends Kind = Kind, Out extends Kind = Kind> {
  readonly id: string;
  readonly ruleSpace: RuleSpace<In, Out>;
  readonly rule: Rule<In, Out>; // SECRET — generative side only
  readonly evidence: ReadonlyArray<Example<In, Out>>;
  readonly query: Value<In>;
  /** True iff candidate === rule.apply(query). Checks APPLICATION, not the stated rule. */
  verify(candidate: Value<Out>): boolean;
}

/** Ground-truth answer to a transform's query. Generative side only. */
export function answer<I extends Kind, O extends Kind>(t: Transform<I, O>): Value<O> {
  return t.rule.apply(t.query);
}

/** A default value-equality usable by `verify` / `isFair` for plain JSON data. */
export function valueEquals<O extends Kind>(a: Value<O>, b: Value<O>): boolean {
  return JSON.stringify(a.data) === JSON.stringify(b.data);
}

// =============================================================================
// 4. INVARIANTS & METRICS
// =============================================================================

/**
 * FAIRNESS ("solvable by insight"): every rule consistent with the evidence
 * agrees on the query's answer. No ambiguity, no guessing, no "you couldn't have
 * known." For infinite/large H, pass a `sampleLimit` — the check becomes
 * probabilistic (a necessary, not sufficient, condition).
 */
export function isFair<I extends Kind, O extends Kind>(
  t: Transform<I, O>,
  eq: (a: Value<O>, b: Value<O>) => boolean = valueEquals,
  sampleLimit = Infinity,
): boolean {
  const target = answer(t);
  let n = 0;
  for (const r of t.ruleSpace.consistent(t.evidence)) {
    if (++n > sampleLimit) break;
    if (!eq(r.apply(t.query), target)) return false; // a consistent rule disagrees -> unfair
  }
  return true;
}

/** reward ∝ compression × depth × anti-brute-force margin (relative scale). */
export interface RewardSignal {
  readonly compression: number; // evidence description length / rule complexity
  readonly antiBruteForce: number; // size of query's answer space
  readonly depth: number; // composition / inference depth (1 for a leaf transform)
  readonly score: number; // product — the predicted reward, calibrated later by feedback (Pillar 4)
}

export function reward<I extends Kind, O extends Kind>(
  t: Transform<I, O>,
  evidenceDescriptionLength: number,
  depth = 1,
): RewardSignal {
  const compression = evidenceDescriptionLength / Math.max(1, t.rule.complexity);
  const antiBruteForce = t.ruleSpace.outputSpaceSize(t.query);
  return {
    compression,
    antiBruteForce,
    depth,
    score: compression * Math.log2(Math.max(2, antiBruteForce)) * depth,
  };
}

// =============================================================================
// 5. COMPOSITION  — the depth engine (Pillar 2)
// =============================================================================

/**
 * FUNCTIONAL: solve t1, its answer becomes the query of t2. Requires
 * t1.out ⊑ t2.in. Adds steps (useful, but the shallow mode).
 */
export function composeFunctional<A extends Kind, B extends Kind, C extends Kind>(
  t1: Transform<A, B>,
  t2: Transform<B, C>,
): Transform<A, C> {
  if (!assignable(t1.ruleSpace.outKind, t2.ruleSpace.inKind)) {
    throw new TypeError(
      `composeFunctional: ${t1.id} output kind not assignable to ${t2.id} input kind`,
    );
  }
  const composedRule: Rule<A, C> = {
    apply: (a) => t2.rule.apply(t1.rule.apply(a)),
    complexity: t1.rule.complexity + t2.rule.complexity,
    describe: () => `(${t1.rule.describe?.() ?? t1.id}) >> (${t2.rule.describe?.() ?? t2.id})`,
  };
  return {
    id: `${t1.id}>>${t2.id}`,
    ruleSpace: composedRuleSpace(t1.ruleSpace, t2.ruleSpace), // TODO: principled A->C space
    rule: composedRule,
    // Solver must recover BOTH rules: t1's evidence + t2's evidence are presented.
    // t2's query is the (hidden) answer of t1, so the bridge value must be earned.
    evidence: t1.evidence as unknown as ReadonlyArray<Example<A, C>>, // TODO: merge views
    query: t1.query,
    verify: (c) => t2.verify(c),
  };
}

/**
 * EPISTEMIC (the deep mode): recovering t1's rule yields the LENS that decodes
 * t2's evidence. Until r1 is known, t2's evidence is unreadable. Each insight
 * unlocks *visibility* of the next, not just a door. This is depth, not length.
 */
export interface EpistemicTransform<
  A extends Kind, B extends Kind, C extends Kind, D extends Kind,
> extends Transform<C, D> {
  readonly lensSource: Transform<A, B>;
  /** Reveal the inner evidence once the lens (r1, or a candidate) is supplied. */
  decodeEvidence(lens: Rule<A, B>): ReadonlyArray<Example<C, D>>;
}

export function composeEpistemic<
  A extends Kind, B extends Kind, C extends Kind, D extends Kind,
>(
  lensSource: Transform<A, B>,
  inner: Transform<C, D>,
  /** How r1 encodes the inner evidence. Decoding requires the recovered lens. */
  encode: (lens: Rule<A, B>, plain: ReadonlyArray<Example<C, D>>) => ReadonlyArray<Example<C, D>>,
): EpistemicTransform<A, B, C, D> {
  const encoded = encode(lensSource.rule, inner.evidence);
  return {
    ...inner,
    id: `${lensSource.id}~>${inner.id}`,
    evidence: encoded, // opaque until decoded with the lens
    lensSource,
    decodeEvidence: (lens) => encode(lens, encoded), // symmetric encode used as decode in refs
  };
}

/**
 * META: falls out of the type system for free — a Transform whose values ARE
 * rules. No special machinery; that the same interface expresses "a rule about
 * rules" is the sign the abstraction is right.
 *
 *   type MetaTransform<...> =
 *     Transform<{ tag: "rule"; in; out }, { tag: "rule"; in; out }>;
 */
export type MetaTransform<
  In extends Kind, Out extends Kind, In2 extends Kind, Out2 extends Kind,
> = Transform<{ tag: "rule"; in: In; out: Out }, { tag: "rule"; in: In2; out: Out2 }>;

/** TODO: derive a principled A->C rule-space from two spaces. Placeholder. */
function composedRuleSpace<A extends Kind, B extends Kind, C extends Kind>(
  s1: RuleSpace<A, B>,
  s2: RuleSpace<B, C>,
): RuleSpace<A, C> {
  return {
    inKind: s1.inKind,
    outKind: s2.outKind,
    consistent: () => [], // TODO: cartesian/consistency join over H1 × H2
    outputSpaceSize: (q) => s2.outputSpaceSize(s1 as unknown as never ?? q),
    size: () => s1.size() * s2.size(),
  };
}

// =============================================================================
// 6. FORWARD HOOKS  — Pillars 3 & 4 (signatures only; specified later)
// =============================================================================

/**
 * DISTRIBUTION (Pillar 3): spread evidence across N phones. `separate` partitions,
 * `duplicate` replicates (enables consensus / corrupted-copy mechanics).
 * Multi-agent fairness: the UNION of all assignments must satisfy isFair, though
 * no single phone need be solvable alone.
 */
export interface Distribution<I extends Kind, O extends Kind> {
  separate(t: Transform<I, O>, phones: number): ReadonlyArray<ReadonlyArray<Example<I, O>>>;
  duplicate(
    assignments: ReadonlyArray<ReadonlyArray<Example<I, O>>>,
    opts: { replicas: number; corrupt?: number },
  ): ReadonlyArray<ReadonlyArray<Example<I, O>>>;
}

/**
 * FEEDBACK (Pillar 4): every play emits an event into the realm's existing log,
 * which is distilled into the improvement ontology. Implicit signal is free;
 * explicit is a one-tap, sparse-but-high-value label that calibrates `reward`.
 */
export interface PlayEvent<I extends Kind, O extends Kind> {
  readonly transformId: string;
  readonly solved: boolean;
  readonly timeMs: number;
  readonly probes: number;
  readonly hints: number;
  readonly groupSize: number;
  readonly explicit?: "satisfying" | "too_easy" | "unfair" | "confusing";
  readonly predicted: RewardSignal;
}

// =============================================================================
// 7. WORKED EXAMPLE  — the contract, made concrete (illustrative, not wired)
// =============================================================================
//
// Hidden rule: swap red<->blue AND rotate 90°. The classic "black box you probe".

type Shape = { color: "red" | "blue"; form: "triangle" | "square" | "arrow"; rot: 0 | 90 | 180 | 270 };
const sym: Kind = { tag: "symbol" };
const v = (s: Shape): Value => ({ kind: sym, data: s, skin: { modality: "spatial" } });

const swapRotate: Rule = {
  apply: (i) => {
    const s = i.data as Shape;
    return v({ ...s, color: s.color === "red" ? "blue" : "red", rot: ((s.rot + 90) % 360) as Shape["rot"] });
  },
  complexity: 2, // "swap colors" + "rotate 90" — small rule, large explained space => high compression
  describe: () => "swap(red,blue) ∘ rotate(90)",
};

// A small finite candidate set = the rule-space R for this example.
const candidates: Rule[] = [
  swapRotate,
  { apply: (i) => { const s = i.data as Shape; return v({ ...s, color: s.color === "red" ? "blue" : "red" }); }, complexity: 1, describe: () => "swap(red,blue)" },
  { apply: (i) => { const s = i.data as Shape; return v({ ...s, rot: ((s.rot + 90) % 360) as Shape["rot"] }); }, complexity: 1, describe: () => "rotate(90)" },
];

const shapeSpace: RuleSpace = {
  inKind: sym,
  outKind: sym,
  consistent: (evidence) =>
    candidates.filter((r) => evidence.every((e) => valueEquals(r.apply(e.input), e.output))),
  outputSpaceSize: () => 2 * 3 * 4, // |color| × |form| × |rot|
  size: () => candidates.length,
};

export const exampleTransform: Transform = {
  id: "swap-rotate-1",
  ruleSpace: shapeSpace,
  rule: swapRotate,
  // Two probes chosen so they DISAMBIGUATE swapRotate from swap-only and rotate-only:
  evidence: [
    { input: v({ color: "red", form: "triangle", rot: 0 }), output: swapRotate.apply(v({ color: "red", form: "triangle", rot: 0 })) },
    { input: v({ color: "blue", form: "square", rot: 90 }), output: swapRotate.apply(v({ color: "blue", form: "square", rot: 90 })) },
  ],
  query: v({ color: "red", form: "arrow", rot: 0 }),
  verify(candidate) {
    return valueEquals(candidate, this.rule.apply(this.query));
  },
};

// isFair(exampleTransform) === true  iff the two probes leave only rules that
// agree on the query (here: only `swapRotate` survives `consistent`, so it holds).
// Drop one probe and a second rule survives that disagrees -> isFair returns false.
