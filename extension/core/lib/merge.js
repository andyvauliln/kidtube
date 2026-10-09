// Overlay rules (PLAN.md §3.1): objects deep-merge, arrays and scalars replace,
// null resets the key to the bundled default.
export function mergeConfig(base, overlay) {
  if (!isPlainObject(overlay)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(overlay)) {
    if (value === null) continue;
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergeConfig(out[key], value);
    } else {
      out[key] = structuredClone(value);
    }
  }
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
