#!/usr/bin/env python3
"""
Build availability.json from the Google Calendar iCal feed (the leading calendar).
Airbnb reservations are copied into that calendar by tools/airbnb-to-google.gs. The
Airbnb feed itself is only read when AIRBNB_ICAL_URL is set (not used by default).

The feed URLs contain secret tokens, so they are read from the environment
(GitHub Actions secrets) and never written to disk. The output only holds
merged ranges of booked nights -- no names, descriptions or reservation codes.

    GOOGLE_ICAL_URL=... python3 scripts/build_availability.py

Output format (half-open ranges, "end" is the checkout day, which stays free
for a new arrival):

    {"updated": "2026-11-04T20:00:00Z", "booked": [["2026-08-04", "2026-08-08"]]}
"""
import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

# (variable, required)
SOURCES = [("GOOGLE_ICAL_URL", True), ("AIRBNB_ICAL_URL", False)]
LOCAL_TZ = ZoneInfo("Europe/Paris")
# Airbnb marks everything beyond its booking window as unavailable, as one block that ends
# at the edge of that window (about a year ahead). That is "not open yet", not a booking,
# and direct requests are allowed there. Ignore Airbnb events ending within this margin of
# the horizon.
AIRBNB_HORIZON_DAYS = 360
OUTPUT = Path(__file__).resolve().parent.parent / "availability.json"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "visiblenatu.re availability"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8", errors="replace")
    if "BEGIN:VCALENDAR" not in text:
        raise ValueError("response is not an iCal file")
    return text


def unfold(text):
    return re.sub(r"\r?\n[ \t]", "", text).replace("\r\n", "\n").replace("\r", "\n")


def prop(body, name):
    m = re.search(rf"^{name}((?:;[^:\n]*)?):(.*)$", body, re.M | re.I)
    return (m.group(1), m.group(2).strip()) if m else (None, None)


def parse_day(value):
    # Google's free/busy feed uses UTC times (20270724T130000Z); take the day in the house's
    # time zone so a local midnight start does not land on the previous day.
    if re.fullmatch(r"\d{8}T\d{6}Z", value):
        dt = datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        return dt.astimezone(LOCAL_TZ).date()
    return date(int(value[0:4]), int(value[4:6]), int(value[6:8]))


def events(text):
    """Yield (first_night, checkout) pairs for every non-cancelled event."""
    for block in unfold(text).split("BEGIN:VEVENT")[1:]:
        body = block.split("END:VEVENT")[0]
        if re.search(r"^STATUS:CANCELLED", body, re.M | re.I):
            continue
        if re.search(r"^RRULE", body, re.M | re.I):
            print("warning: recurring event skipped (RRULE is not supported)", file=sys.stderr)
            continue
        _, start = prop(body, "DTSTART")
        _, end = prop(body, "DTEND")
        if not start:
            continue
        first = parse_day(start)
        last = parse_day(end) if end else first + timedelta(days=1)
        if last <= first:
            last = first + timedelta(days=1)
        yield first, last


def merge(ranges):
    merged = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def main():
    ranges = []
    for var, required in SOURCES:
        url = os.environ.get(var)
        if not url:
            if required:
                sys.exit(f"{var} is not set")
            continue
        try:
            found = list(events(fetch(url)))
        except Exception as exc:  # message only: the URL itself is secret
            sys.exit(f"{var}: could not read calendar ({type(exc).__name__}: {exc})")
        print(f"{var}: {len(found)} events")
        if var == "AIRBNB_ICAL_URL":
            horizon = date.today() + timedelta(days=AIRBNB_HORIZON_DAYS)
            kept = [r for r in found if r[1] < horizon]
            if len(kept) != len(found):
                print(f"{var}: ignored {len(found) - len(kept)} event(s) at the end of Airbnb's booking window")
            found = kept
        ranges.extend(found)

    today = date.today()
    booked = [[s.isoformat(), e.isoformat()] for s, e in merge(ranges) if e > today]

    old = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {}
    if old.get("booked") == booked:
        print("availability unchanged")
        return
    data = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "booked": booked}
    OUTPUT.write_text(json.dumps(data, indent=2) + "\n")
    print(f"wrote {len(booked)} booked ranges")


if __name__ == "__main__":
    main()
