/** "September 15" — from a timestamp, or from a calendar date as stored. */
export function dayOf(value: Date | string) {
  if (typeof value === "string") {
    return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return value.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}
