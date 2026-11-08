/**
 * Kopieert Airbnb-reserveringen naar de leidende Google Agenda van Front de Mer.
 *
 * Draait in je eigen Google-account (script.google.com), niet op de website.
 * Uitleg: tools/README.md. Vul hieronder de twee waarden in; zet deze file
 * NIET met de echte Airbnb-link terug in de (publieke) repo.
 */
const CALENDAR_ID = 'PLAK_HIER_HET_AGENDA_ID';        // Agenda-instellingen → Agenda integreren → Agenda-ID
const AIRBNB_ICAL_URL = 'PLAK_HIER_HET_AIRBNB_ICAL_ADRES'; // Airbnb → Kalender → Beschikbaarheid → Kalenders koppelen → Kalender exporteren

const COPY_BLOCKS = false;  // true: ook "Airbnb (Not available)" kopiëren (bijv. geïmporteerde Booking.com-boekingen)
const HORIZON_DAYS = 360;   // blokken die aan de rand van Airbnb's boekingsvenster eindigen zijn "nog niet open", geen boeking
const CHECKIN_HOUR = 15;
const CHECKOUT_HOUR = 11;
const TIME_ZONE = 'Europe/Paris';
const TAG = 'airbnb-sync:';  // staat in de beschrijving van gekopieerde events

function syncAirbnb() {
  const res = UrlFetchApp.fetch(AIRBNB_ICAL_URL, { muteHttpExceptions: true });
  const text = res.getContentText();
  if (res.getResponseCode() !== 200 || text.indexOf('BEGIN:VCALENDAR') < 0) {
    // Niets verwijderen als Airbnb niet goed antwoordt.
    throw new Error('Airbnb-kalender niet te lezen (HTTP ' + res.getResponseCode() + ')');
  }

  const today = isoDay(new Date());
  const horizon = isoDay(new Date(Date.now() + HORIZON_DAYS * 86400000));
  const wanted = {};
  parseIcal(text).forEach(function (ev) {
    if (ev.end <= today || ev.end >= horizon) return;
    if (!COPY_BLOCKS && !/^reserved$/i.test(ev.summary)) return;
    wanted[ev.uid] = ev;
  });

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error('Agenda niet gevonden: controleer CALENDAR_ID');
  const existing = {};
  cal.getEvents(new Date(), new Date(Date.now() + 800 * 86400000)).forEach(function (e) {
    const m = (e.getDescription() || '').match(/airbnb-sync:(\S+)/);
    if (m) existing[m[1]] = e;
  });

  let created = 0, updated = 0, removed = 0;
  Object.keys(wanted).forEach(function (uid) {
    const ev = wanted[uid];
    const start = Utilities.parseDate(ev.start + ' ' + CHECKIN_HOUR + ':00', TIME_ZONE, 'yyyy-MM-dd H:mm');
    const end = Utilities.parseDate(ev.end + ' ' + CHECKOUT_HOUR + ':00', TIME_ZONE, 'yyyy-MM-dd H:mm');
    const found = existing[uid];
    if (!found) {
      cal.createEvent('Airbnb', start, end, { description: TAG + uid });
      created++;
    } else if (found.getStartTime().getTime() !== start.getTime() || found.getEndTime().getTime() !== end.getTime()) {
      found.setTime(start, end);
      updated++;
    }
  });
  Object.keys(existing).forEach(function (uid) {
    if (!wanted[uid]) { existing[uid].deleteEvent(); removed++; }
  });
  console.log('Airbnb → Google: ' + created + ' nieuw, ' + updated + ' gewijzigd, ' + removed + ' verwijderd');
}

// Eenmalig uitvoeren: laat de sync elk uur lopen.
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncAirbnb').timeBased().everyHours(1).create();
}

function isoDay(d) {
  return Utilities.formatDate(d, TIME_ZONE, 'yyyy-MM-dd');
}

function parseIcal(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const out = [];
  unfolded.split('BEGIN:VEVENT').slice(1).forEach(function (block) {
    const body = block.split('END:VEVENT')[0];
    if (/^STATUS:CANCELLED/mi.test(body)) return;
    const start = icalDay(body, 'DTSTART');
    const end = icalDay(body, 'DTEND');
    if (!start || !end || end <= start) return;
    const uidMatch = body.match(/^UID:(.+)$/m);
    const summaryMatch = body.match(/^SUMMARY:(.*)$/m);
    out.push({
      uid: (uidMatch ? uidMatch[1].trim() : start + '_' + end).replace(/\s+/g, ''),
      start: start,
      end: end,
      summary: summaryMatch ? summaryMatch[1].trim() : '',
    });
  });
  return out;
}

function icalDay(body, name) {
  const m = body.match(new RegExp('^' + name + '[^:\\n]*:(\\d{4})(\\d{2})(\\d{2})', 'm'));
  return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
}
