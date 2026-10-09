// Now as "2026-10-08T12:34:56Z" (no milliseconds), the form every file in the data repo uses.
export const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

// Local time in the config's time zone ("local" = the tablet's own zone).
export function localParts(now, timezone) {
  const opts = { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' };
  if (timezone && timezone !== 'local') opts.timeZone = timezone;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', opts).formatToParts(now).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    day: p.weekday.slice(0, 3).toLowerCase(),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}
