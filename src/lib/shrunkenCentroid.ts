// Nearest shrunken centroid — the classifier behind "Mark & match".
//
// WHY THIS AND NOT LOGISTIC REGRESSION. The operator marks a handful of cells,
// so we are fitting in the n≈10, p≈12 regime. Data in that regime is ALWAYS
// linearly separable, which means unregularised logistic regression drives its
// weights toward ±∞ and every cell scores 0.000 or 1.000. The map then looks
// maximally confident while carrying almost no information — the precise
// failure this feature must not have. Heavy L2 fixes the symptom but turns λ
// into a magic constant nobody can tune from ten samples.
//
// Nearest centroid cannot overfit — its only parameters are the two class means
// — but it weights all features equally, so a handful of irrelevant ones dilute
// the few that matter.
//
// Nearest SHRUNKEN centroid is the middle: weight each feature by its
// between-class separation over within-class scatter, and soft-threshold that
// weight toward zero so uninformative features drop out. Feature selection
// without fitting a model we cannot afford to fit.
//
// Method: Tibshirani, Hastie, Narasimhan & Chu (2002), "Diagnosis of multiple
// cancer types by shrunken centroids of gene expression", PNAS 99(10) — the
// PAM method, published for exactly this small-n/high-p setting.

/** 1 = the operator wants cells like this, 0 = they do not. */
export type Label = 0 | 1;

export type SeparabilityVerdict = "clear" | "weak" | "indistinguishable";

export type Separability = {
  /** Leave-one-out accuracy over the marked cells, 0..1. */
  looAccuracy: number;
  verdict: SeparabilityVerdict;
  /** Features that survived shrinkage. Zero means the marks look alike. */
  featuresUsed: number;
  featureNames: string[];
  message: string;
};

export type Classifier = {
  /** Per-feature weight after shrinkage. Zero = discarded as uninformative. */
  weights: number[];
  /** Class centroids in standardised space, index 0 = unwanted, 1 = wanted. */
  centroids: [number[], number[]];
  featureNames: string[];
  separability: Separability;
};

export type FitOptions = {
  /**
   * Shrinkage threshold. Features whose standardised separation falls below
   * this are dropped entirely. 0.5 keeps genuinely discriminative features
   * while removing noise; raising it makes the match more conservative.
   */
  delta?: number;
};

const DEFAULT_DELTA = 0.5;

/** Mean and standard deviation of a column. */
function moments(values: number[]): { mean: number; sd: number } {
  const n = values.length;
  if (!n) return { mean: 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const varSum = values.reduce((a, b) => a + (b - mean) ** 2, 0);
  return { mean, sd: Math.sqrt(varSum / Math.max(1, n - 1)) };
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Standardise every feature against the WHOLE field, not just the marked cells.
 *
 * Using the field distribution means a cell's score does not shift when the
 * operator adds another mark, and it keeps the scale of "far from the wanted
 * centroid" meaningful in units of how much that feature actually varies
 * across this field.
 */
export function standardiser(allRows: number[][]): {
  apply: (row: number[]) => number[];
  sd: number[];
} {
  const p = allRows[0]?.length ?? 0;
  const mean: number[] = [], sd: number[] = [];
  for (let i = 0; i < p; i++) {
    const m = moments(allRows.map(r => r[i]));
    mean.push(m.mean);
    // A constant feature carries no information; guard the divide rather than
    // letting it produce Infinity and poison every distance.
    sd.push(m.sd > 1e-9 ? m.sd : 1);
  }
  return {
    sd,
    apply: (row: number[]) => row.map((v, i) => (v - mean[i]) / sd[i]),
  };
}

function fitCore(X: number[][], y: Label[], delta: number) {
  const p = X[0].length;
  const idx0 = y.map((v, i) => (v === 0 ? i : -1)).filter(i => i >= 0);
  const idx1 = y.map((v, i) => (v === 1 ? i : -1)).filter(i => i >= 0);

  const c0: number[] = [], c1: number[] = [], pooledSd: number[] = [];
  for (let i = 0; i < p; i++) {
    const m0 = moments(idx0.map(k => X[k][i]));
    const m1 = moments(idx1.map(k => X[k][i]));
    c0.push(m0.mean);
    c1.push(m1.mean);
    // Pooled within-class scatter.
    const n0 = idx0.length, n1 = idx1.length;
    const pooledVar =
      ((n0 - 1) * m0.sd ** 2 + (n1 - 1) * m1.sd ** 2) / Math.max(1, n0 + n1 - 2);
    pooledSd.push(Math.sqrt(Math.max(0, pooledVar)));
  }

  // Tibshirani's s0: the median within-class scatter, added to every
  // denominator so a feature that happens to be constant across a few marked
  // cells cannot produce a near-infinite relevance score.
  const s0 = median(pooledSd.filter(v => v > 0)) || 1e-6;

  // Shrinkage is GRADED, not binary. At four marks per class a pure-noise
  // feature clears the threshold by luck perhaps one time in seven — but it
  // does so carrying a weight around 0.05 against a real feature's 5, so it
  // moves the weighted distance by well under a percent. Raising delta does not
  // reliably prevent it (a different noise feature simply gets lucky instead)
  // and costs genuinely weak-but-real features, so the relative magnitude is
  // the guarantee to rely on, not the survivor count.
  const weights = c0.map((_, i) => {
    const t = Math.abs(c1[i] - c0[i]) / (pooledSd[i] + s0);
    return Math.max(0, t - delta);       // soft threshold toward zero
  });

  return { weights, centroids: [c0, c1] as [number[], number[]] };
}

/** Weighted squared distance; falls back to unweighted if everything shrank away. */
function score(row: number[], c: { weights: number[]; centroids: [number[], number[]] }): number {
  const w = c.weights.some(v => v > 0) ? c.weights : c.weights.map(() => 1);
  let d0 = 0, d1 = 0;
  for (let i = 0; i < row.length; i++) {
    d0 += w[i] * (row[i] - c.centroids[0][i]) ** 2;
    d1 += w[i] * (row[i] - c.centroids[1][i]) ** 2;
  }
  d0 = Math.sqrt(d0); d1 = Math.sqrt(d1);
  // Distance RATIO, not a sigmoid. It spans 0..1 smoothly and cannot saturate
  // to exactly 0 or 1 the way a separating hyperplane's margin does.
  const sum = d0 + d1;
  return sum < 1e-12 ? 0.5 : d0 / sum;
}

/**
 * Leave-one-out accuracy over the marked cells.
 *
 * This is the honest separability signal. Training-set separation is
 * meaningless here — with ten points in twelve dimensions the classes always
 * separate. LOO asks the only question that matters: does a mark the model has
 * never seen land on the right side? Cheap at this size: ten refits of some
 * arithmetic.
 */
function leaveOneOut(X: number[][], y: Label[], delta: number): number {
  if (X.length < 3) return 0;
  let correct = 0;
  for (let held = 0; held < X.length; held++) {
    const Xt = X.filter((_, i) => i !== held);
    const yt = y.filter((_, i) => i !== held);
    // A fold that loses a whole class cannot be classified; skip rather than
    // score it as a failure.
    if (!yt.includes(0) || !yt.includes(1)) { correct += 0.5; continue; }
    const c = fitCore(Xt, yt, delta);
    const s = score(X[held], c);
    if ((s >= 0.5 ? 1 : 0) === y[held]) correct++;
  }
  return correct / X.length;
}

/**
 * Fit on the marked cells.
 *
 * `X` must already be standardised with `standardiser`, built from every cell
 * in the field rather than only the marked ones.
 */
export function fitShrunkenCentroid(
  X: number[][],
  y: Label[],
  featureNames: string[],
  opts: FitOptions = {},
): Classifier {
  if (X.length !== y.length) throw new Error("match: features and labels differ in length");
  if (!y.includes(0) || !y.includes(1)) {
    throw new Error("match: need at least one wanted and one unwanted cell");
  }
  const delta = opts.delta ?? DEFAULT_DELTA;
  const core = fitCore(X, y, delta);
  const used = core.weights.filter(w => w > 0).length;
  const looAccuracy = leaveOneOut(X, y, delta);

  const verdict: SeparabilityVerdict =
    used === 0 ? "indistinguishable"
      : looAccuracy >= 0.9 ? "clear"
        : looAccuracy >= 0.7 ? "weak"
          : "indistinguishable";

  const message =
    verdict === "clear"
      ? `The marked cells separate cleanly on ${used} of ${featureNames.length} measurements.`
      : verdict === "weak"
        ? `These two sets only partly separate, so the match will be rough. Mark a few more cells, ` +
          `especially ones you are confident about.`
        : used === 0
          ? `The cells you marked look alike to every measurement we take. Try marking examples ` +
            `that differ more obviously.`
          : `We cannot tell your two sets apart reliably. A match now would look confident and ` +
            `be mostly guesswork. Mark more contrasting examples.`;

  return {
    ...core,
    featureNames,
    separability: {
      looAccuracy, verdict, featuresUsed: used, featureNames,
      message,
    },
  };
}

/** Score one standardised row. 1 = most like the wanted set. */
export function scoreRow(clf: Classifier, row: number[]): number {
  return score(row, clf);
}

/** Which measurements actually drove the match, strongest first. */
export function rankedFeatures(clf: Classifier): { name: string; weight: number }[] {
  return clf.featureNames
    .map((name, i) => ({ name, weight: clf.weights[i] }))
    .filter(f => f.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}
