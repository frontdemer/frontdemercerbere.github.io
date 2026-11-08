// Cloudflare Worker: turns a booking request from visiblenatu.re into an issue
// in a private GitHub repo. The GitHub token lives only in the Worker's secrets.
//
// Config (wrangler.toml [vars]): ALLOWED_ORIGINS, GITHUB_REPO, AVAILABILITY_URL, PRICES_URL, TOURIST_TAX_RATE
// Secret (wrangler secret put): GITHUB_TOKEN  (fine-grained, Issues: read/write on GITHUB_REPO only)

const LANGS = ["nl", "fr", "en"];
const MAX = { name: 100, email: 200, message: 2000 };
const MAX_GUESTS = 4;
// Taxe de séjour Cerbère, € per adult per night. Unverified: same 2024 rate as the admin app
// (meublé classé 2-3 étoiles). Override with TOURIST_TAX_RATE in wrangler.toml once confirmed
// with the commune / Communauté de communes ACVI. Minors (<18) are exempt.
const DEFAULT_TAX_RATE = 0.88;

// Fallback when prices.json cannot be fetched; keep in sync with prices.json on the site.
const DEFAULT_PRICES = {
  "low-n": 75, "low-w": 475, "mid-n": 95, "mid-w": 600,
  "high-n": 125, "high-w": 800, "jul2-n": 150, "jul2-w": 950,
  "aug-n": 175, "aug-w": 1100, "aug2-n": 135, "aug2-w": 850,
};

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

    const adults = Number(data.adults);
    const children = Number(data.children ?? 0);
    if (!Number.isInteger(adults) || !Number.isInteger(children) || adults < 1 || children < 0 || adults + children > MAX_GUESTS) {
      return reply({ error: "guests" }, 400, cors);
    }

    const nights = daysBetween(checkin, checkout);
    const today = new Date().toISOString().slice(0, 10);
    if (checkin < addDays(today, -1) || nights < 2 || nights > 90) {
      return reply({ error: "dates" }, 400, cors);
    }

    const conflict = await overlapsBooked(env, checkin, checkout);
    const quote = calcQuote(await loadPrices(env), checkin, nights, adults, Number(env.TOURIST_TAX_RATE) || DEFAULT_TAX_RATE);

    const issue = {
      title: `Reservering ${checkin} → ${checkout} – ${name}`.slice(0, 200),
      body: buildBody({ lang, name, email, message, checkin, checkout, nights, conflict, quote, adults, children }),
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

async function loadPrices(env) {
  if (!env.PRICES_URL) return DEFAULT_PRICES;
  try {
    const res = await fetch(env.PRICES_URL, { cf: { cacheTtl: 300 } });
    if (!res.ok) return DEFAULT_PRICES;
    return { ...DEFAULT_PRICES, ...(await res.json()) };
  } catch {
    return DEFAULT_PRICES;
  }
}

// Same seasons as the site: low jan-mar/oct-dec, mid apr-jun/sep, high jul-aug in four periods.
function priceKey(iso) {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (month === 7) return day <= 18 ? "high" : "jul2";
  if (month === 8) return day <= 20 ? "aug" : "aug2";
  return [4, 5, 6, 9].includes(month) ? "mid" : "low";
}

// Full weeks at the weekly rate of the week's first day, remaining nights at each night's own rate.
// Special rates (long weekends, holidays) are not detected; this is an indication only.
function calcQuote(prices, checkin, nights, adults, taxRate) {
  const lines = [];
  let total = 0;
  let date = checkin;
  let left = nights;
  while (left >= 7) {
    const amount = prices[`${priceKey(date)}-w`];
    lines.push({ label: `Week vanaf ${date}`, amount });
    total += amount;
    date = addDays(date, 7);
    left -= 7;
  }
  while (left > 0) {
    const amount = prices[`${priceKey(date)}-n`];
    lines.push({ label: `Nacht ${date}`, amount });
    total += amount;
    date = addDays(date, 1);
    left -= 1;
  }
  const tax = Math.round(adults * nights * taxRate * 100) / 100;
  return { total, lines, tax, taxRate, adults, nights };
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

const eur = n => `€${Number.isInteger(n) ? n : n.toFixed(2).replace(".", ",")}`;

// No @mentions from guests, no breaking out of the code fence, no table breakage.
const noMention = s => s.replace(/(^|\s)@/g, "$1@​");
const cell = s => noMention(s).replace(/\|/g, "\\|").replace(/\s+/g, " ");

function buildBody({ lang, name, email, message, checkin, checkout, nights, conflict, quote, adults, children }) {
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
    `| Gasten | ${adults} ${adults === 1 ? "volwassene" : "volwassenen"}${children ? `, ${children} ${children === 1 ? "kind" : "kinderen"} (onder 18)` : ""} |`,
    `| Berekende prijs | **${eur(quote.total)}** (indicatief, excl. toeristenbelasting) |`,
    `| Toeristenbelasting Cerbère | **${eur(quote.tax)}** (${adults} × ${nights} nachten × ${eur(quote.taxRate)}, kinderen onder 18 vrij; tarief nog te controleren, ter plaatse of vooraf te betalen) |`,
    `| Totaal te betalen | **${eur(quote.total + quote.tax)}** |`,
  ];
  if (conflict) {
    lines.push("", "> ⚠️ De gekozen data overlappen met nachten die in de beschikbaarheidskalender als bezet staan. Controleer dit voordat je bevestigt.");
  }
  lines.push("", "<details><summary>Prijsberekening</summary>", "", ...quote.lines.map(l => `- ${l.label}: €${l.amount}`), "", "</details>");
  if (message) {
    const safe = noMention(message).replace(/`{3,}/g, "``");
    lines.push("", "**Opmerkingen**", "", "```text", safe, "```");
  }
  return lines.join("\n");
}
