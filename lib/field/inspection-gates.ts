/** Latest non-cancelled inspection for each named phase supersedes earlier results. */
export function passedInspectionPhases(rows: { clearsPhase: string | null; result: string }[]) {
  const latest = new Map<string, string>();
  for (const row of rows) {
    if (!row.clearsPhase || row.result === "cancelled") continue;
    const name = row.clearsPhase.trim().toLowerCase();
    if (!latest.has(name)) latest.set(name, row.result);
  }
  return new Set([...latest].filter(([, result]) => result === "passed").map(([name]) => name));
}
