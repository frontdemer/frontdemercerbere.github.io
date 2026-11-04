// Cloudflare Worker: turns a booking request from visiblenatu.re into an issue
// in a private GitHub repo. The GitHub token lives only in the Worker's secrets.
//
// Config (wrangler.toml [vars]): ALLOWED_ORIGINS, GITHUB_REPO, AVAILABILITY_URL
// Secret (wrangler secret put): GITHUB_TOKEN  (fine-grained, Issues: read/write on GITHUB_REPO only)

const LANGS = ["nl", "fr", "en"];
const MAX = { name: 100, email: 200, message: 2000 };

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);
    const cors = originOk
      ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" }
      : { "Vary": "Origin" };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: originOk ? 204 : 403,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405, cors);
    if (!originOk) return reply({ error: "forbidden" }, 403, cors);

    let data;
    try {
      data = await request.json();
    } catch {
      return reply({ error: "invalid_json" }, 400, cors);
    }

    // Honeypot: bots fill every field. Pretend success, create nothing.
    if (clean(data.website, 200)) return reply({ ok: true }, 200, cors);

    const lang = LANGS.includes(data.lang) ? data.lang : "nl";
    const name = clean(data.name, MAX.name);
    const email = clean(data.email, MAX.email);
    const message = clean(data.message, MAX.message, true);
    const checkin = String(data.checkin || "");
    const checkout = String(data.checkout || "");

    if (!name) return reply({ error: "name" }, 400, cors);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "email" }, 400, cors);
    if (!isIsoDate(checkin) || !isIsoDate(checkout)) return reply({ error: "dates" }, 400, cors);

    const nights = daysBetween(checkin, checkout);
    const today = new Date().toISOString().slice(0, 10);
    if (checkin < addDays(today, -1) || nights < 2 || nights > 90) {
      return reply({ error: "dates" }, 400, cors);
    }

    const conflict = await overlapsBooked(env, checkin, checkout);

    const issue = {
      title: `Reservering ${checkin} → ${checkout} – ${name}`.slice(0, 200),
      body: buildBody({ lang, name, email, message, checkin, checkout, nights, conflict }),
      labels: conflict ? ["nieuw", "beschikbaarheid-conflict"] : ["nieuw"],
    };

    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "visiblenatu-reservations-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(issue),
    });
    if (!res.ok) {
      console.error("GitHub issue creation failed", res.status, await res.text());
      return reply({ error: "upstream" }, 502, cors);
    }
    return reply({ ok: true }, 200, cors);
  },
};

function reply(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function clean(value, max, keepNewlines = false) {
  const pattern = keepNewlines
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
    : /[\u0000-\u001F\u007F]/g;
  return String(value ?? "").replace(pattern, keepNewlines ? "" : " ").trim().slice(0, max);
}

function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
}

// Soft check only: flag the issue, never reject (availability.json can lag an hour).
async function overlapsBooked(env, checkin, checkout) {
  if (!env.AVAILABILITY_URL) return false;
  try {
    const res = await fetch(env.AVAILABILITY_URL, { cf: { cacheTtl: 300 } });
    if (!res.ok) return false;
    const { booked = [] } = await res.json();
    return booked.some(([start, end]) => checkin < end && checkout > start);
  } catch {
    return false;
  }
}

// No @mentions from guests, no breaking out of the code fence, no table breakage.
const noMention = s => s.replace(/(^|\s)@/g, "$1@​");
const cell = s => noMention(s).replace(/\|/g, "\\|").replace(/\s+/g, " ");

function buildBody({ lang, name, email, message, checkin, checkout, nights, conflict }) {
  const lines = [
    `Aanvraag via visiblenatu.re (taal gast: ${lang.toUpperCase()})`,
    "",
    "| | |",
    "|---|---|",
    `| Naam | ${cell(name)} |`,
    `| E-mail | ${cell(email)} |`,
    `| Aankomst | ${checkin} |`,
    `| Vertrek | ${checkout} |`,
    `| Nachten | ${nights} |`,
  ];
  if (conflict) {
    lines.push("", "> ⚠️ De gekozen data overlappen met nachten die in de beschikbaarheidskalender als bezet staan. Controleer dit voordat je bevestigt.");
  }
  if (message) {
    const safe = noMention(message).replace(/`{3,}/g, "``");
    lines.push("", "**Opmerkingen**", "", "```text", safe, "```");
  }
  return lines.join("\n");
}
