// Local time in the config's time zone ("local" = the tablet's own zone).
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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

const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function inAllowedWindow(cfg, now) {
  const { day, minutes } = localParts(now, cfg.timezone);
  return (cfg.time?.allowed ?? []).some((w) => w.days.includes(day) && minutes >= toMinutes(w.from) && minutes < toMinutes(w.to));
}

// Next window start as "HH:MM" (today or a later day) with the day name, or null if there is none.
export function nextOpening(cfg, now) {
  const { day, minutes } = localParts(now, cfg.timezone);
  const start = DAYS.indexOf(day);
  for (let offset = 0; offset < 8; offset++) {
    const d = DAYS[(start + offset) % 7];
    const opens = (cfg.time?.allowed ?? [])
      .filter((w) => w.days.includes(d) && (offset > 0 || toMinutes(w.from) > minutes))
      .map((w) => w.from)
      .sort();
    if (opens.length) return { day: offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : d, at: opens[0] };
  }
  return null;
}

// Why he can't watch right now, or null when he can.
export function lockReason(cfg, now, playedSecondsToday) {
  if (!inAllowedWindow(cfg, now)) return 'outsideHours';
  const cap = cfg.time?.maxMinutesPerDay ?? 0;
  if (cap > 0 && playedSecondsToday >= cap * 60) return 'dailyCap';
  return null;
}
