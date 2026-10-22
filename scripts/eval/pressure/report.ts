// The evaluation written out: a Markdown report for people and a JSON next to it for the next comparison.
import type { PressureGrade } from "../../../src/lib/weedVision/pressure/grade";
import type { EvalMetrics, QuadratScore } from "./score";

export type EvalReport = {
  fixture: string; date: string; gradeVersion: string; crop: string | null; group: string;
  scheme: PressureGrade["scheme"]; unitM: number; cellM: number; detectionFloorM: number;
  grade: { cells: number; assessed: number; confirmed: number; possible: number; actionCells: number; escapes: number; patches: number; fieldCover: number; fieldClass: string; disagreeing: number };
  metrics: EvalMetrics; quadrats: QuadratScore[];
};

export function buildReport(name: string, date: string, grade: PressureGrade, cellM: number, metrics: EvalMetrics, quadrats: QuadratScore[]): EvalReport {
  const s = grade.summary;
  return {
    fixture: name, date, gradeVersion: grade.version, crop: grade.crop, group: grade.group, scheme: grade.scheme, unitM: s.unitM, cellM, detectionFloorM: grade.detectionFloorM,
    grade: { cells: s.cells, assessed: s.assessed, confirmed: s.confirmed, possible: s.possible, actionCells: s.byClass.action + s.byClass.high, escapes: s.escapes, patches: s.patches, fieldCover: s.fieldCover, fieldClass: s.fieldClass, disagreeing: s.disagreeing },
    metrics, quadrats,
  };
}

const pct = (v: number | null, d = 1) => (v == null ? "n/a" : `${(100 * v).toFixed(d)}%`);
const pts = (v: number | null) => { if (v == null) return "n/a"; const t = (100 * v).toFixed(2); return Number(t) === 0 ? "0.00 points" : `${v > 0 ? "+" : ""}${t} points`; };
const num = (v: number | null, d = 2) => (v == null ? "n/a" : v.toFixed(d));

export function reportMarkdown(r: EvalReport): string {
  const m = r.metrics, c = m.confusion;
  const L: string[] = [];
  L.push(`# Weed pressure evaluation: ${r.fixture} (${r.date})`, "");
  L.push(`Grade ${r.gradeVersion}, crop ${r.crop ?? "not on file"} (${r.group}), action point ${pct(r.scheme.action, 0)} cover (${r.scheme.source}). Cells ${num(r.cellM)} m, treatment unit ${num(r.unitM, 1)} m, detection floor ${Math.round(r.detectionFloorM * 100)} cm.`, "");
  L.push(`Scored ${m.scored} of ${m.quadrats} truth quadrats; ${m.notScored} had less than half their area in assessed cells and are listed, not scored.`, "");
  L.push("## Cover and count against truth", "");
  L.push("| | Cover | Count |", "|---|---|---|");
  L.push(`| Mean absolute error | ${pts(m.cover.mae).replace("+", "")} | ${num(m.count.mae, 1)} |`);
  L.push(`| Bias (predicted minus truth) | ${pts(m.cover.bias)} | ${m.count.bias == null ? "n/a" : Number(m.count.bias.toFixed(1)) === 0 ? "0.0" : `${m.count.bias > 0 ? "+" : ""}${m.count.bias.toFixed(1)}`} |`);
  L.push(`| RMSE | ${pts(m.cover.rmse).replace("+", "")} | |`, "");
  L.push(`## Act or not, at the action point (${pct(m.actionPoint, 0)})`, "");
  L.push("| | Truth: act | Truth: don't act |", "|---|---|---|");
  L.push(`| Grade: act | ${c.tp} | ${c.fp} |`, `| Grade: don't act | ${c.fn} | ${c.tn} |`, "");
  L.push(`Precision ${pct(c.precision)}, recall ${pct(c.recall)}. Patch IoU inside the quadrats ${pct(m.patchIoU)} (the grade's patch cells, 5% over the unit, against quadrats at the action point); with the cells classed at the action point instead, ${pct(m.actionIoU)}.`, "");
  L.push("## Not assessed inside the quadrats", "");
  if (!m.notAssessedCells) L.push("Every cell inside a quadrat was assessed.", "");
  else {
    L.push(`${m.notAssessedCells} cell${m.notAssessedCells === 1 ? "" : "s"} inside the quadrats were not assessed (a cell can carry several reasons):`, "");
    L.push("| Reason | Cells |", "|---|---|");
    for (const [k, v] of Object.entries(m.notAssessedByReason).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
    L.push("");
  }
  L.push("## The grade on the whole field", "");
  const g = r.grade;
  L.push(`${g.assessed} of ${g.cells} cells assessed; field cover ${pct(g.fieldCover)} (${g.fieldClass}); ${g.actionCells} cells at the action point or over; ${g.confirmed} confirmed, ${g.possible} possible; ${g.patches} patches; ${g.escapes} large escapes; ${g.disagreeing} cells where pixels and objects disagree.`, "");
  L.push("## Per quadrat", "");
  L.push("| Quadrat | Side | Assessed | Truth cover | Predicted | Truth count | Predicted | Truth acts | Grade acts |", "|---|---|---|---|---|---|---|---|---|");
  for (const q of r.quadrats) L.push(`| ${q.id} | ${q.sideM.toFixed(2)} m | ${pct(q.assessedShare, 0)} | ${pct(q.truthCover)} | ${pct(q.predCover)} | ${q.truthCount} | ${num(q.predCount, 1)} | ${q.truthAct ? "yes" : "no"} | ${q.predAct == null ? "not scored" : q.predAct ? "yes" : "no"} |`);
  L.push("", "Cover is weed over the visible ground (imaged, off the crop row band and crowns), as the grade reads it. These numbers are only as good as the truth file: say how it was made beside them.", "");
  return L.join("\n");
}
