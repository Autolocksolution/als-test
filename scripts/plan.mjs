// Logique pure des rappels (aucune dépendance) : décide quelles notifications envoyer.
const TZ = "Europe/Paris";

export function parisNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 60000;
  return { date, minutes, wall };
}

export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const wallOf = (date, time) => {
  const [y, m, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, mi) / 60000;
};
const okTime = t => /^\d{2}:\d{2}$/.test(t || "");
const okDate = t => /^\d{4}-\d{2}-\d{2}$/.test(t || "");
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export const MORNING_FROM = 7 * 60 + 30, MORNING_TO = 13 * 60, REMIND_MIN = 60, LATE_MIN = 10;

/** rdvs : [{id, ...doc}], sent : Set de clés déjà envoyées. Retourne [{key,title,body,tag}] */
export function due(rdvs, now, sent) {
  const out = [];
  const live = rdvs.filter(r => !r.done && okDate(r.date) && (r.title || "").trim());
  // 1) rappel avant le rendez-vous
  for (const r of live) {
    if (!okTime(r.time)) continue;
    const diff = wallOf(r.date, r.time) - now.wall;
    if (diff > REMIND_MIN || diff < -LATE_MIN) continue;
    const key = `rem_${r.id}_${r.date}_${r.time}`;
    if (sent.has(key)) continue;
    const when = diff >= 50 ? "dans 1 h" : diff > 0 ? `dans ${Math.round(diff)} min` : "maintenant";
    const place = (r.address || "").trim();
    out.push({ key, tag: key, title: `RDV ${when} · ${r.time}`, body: clip(r.title.trim() + (place ? " · " + place : ""), 160) });
  }
  // 2) récapitulatif du matin
  if (now.minutes >= MORNING_FROM && now.minutes < MORNING_TO) {
    const key = `day_${now.date}`;
    const today = live.filter(r => r.date === now.date).sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    if (today.length && !sent.has(key)) {
      const lines = today.slice(0, 4).map(r => (r.time ? r.time + " " : "") + clip(r.title.trim(), 40));
      const more = today.length > 4 ? ` · +${today.length - 4}` : "";
      out.push({ key, tag: key, title: today.length === 1 ? "1 rendez-vous aujourd'hui" : `${today.length} rendez-vous aujourd'hui`, body: lines.join(" · ") + more });
    }
  }
  return out;
}

export const OUTBOX_MAX = 5, STALE_MS = 12 * 3600 * 1000;

/** events : [{id,title,body,to,by,at}], devices : [{id,uid}]. Retourne {sends:[{id,title,body,tag,deviceIds}], skip:[ids]} */
export function planOutbox(events, devices, nowMs) {
  const fresh = [], skip = [];
  for (const e of [...events].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    if (!e.title || nowMs - (e.at || 0) > STALE_MS) skip.push(e.id); else fresh.push(e);
  }
  const target = e => devices.filter(d => e.to === "all" || d.uid !== e.by).map(d => d.id);
  const sends = fresh.slice(0, OUTBOX_MAX).map(e => ({ id: e.id, title: e.title, body: e.body || "", tag: "ob_" + e.id, deviceIds: target(e) }));
  const rest = fresh.slice(OUTBOX_MAX);
  if (rest.length) {
    const ids = new Set(rest.flatMap(target));
    sends.push({ id: rest[0].id, also: rest.slice(1).map(e => e.id), title: `${rest.length} autres changements`, body: rest.map(e => e.title).slice(0, 3).join(" · "), tag: "ob_more", deviceIds: [...ids] });
  }
  return { sends, skip };
}
