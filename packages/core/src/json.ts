/** A plain JSON object, as opposed to an array or null. For checking model output. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
