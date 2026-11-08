# Google Agenda leidend, Airbnb wordt erin gekopieerd

De website toont beschikbaarheid uit de **Google Agenda** van Front de Mer. Eigen boekingen zet je daar zelf in.
Airbnb-reserveringen kopieert `airbnb-to-google.gs` er elk uur automatisch in, zodat die agenda compleet is.
Airbnb pas je daarna zelf handmatig aan.

## Eenmalig instellen (10 minuten)

1. Ga naar <https://script.google.com> → **Nieuw project**. Plak de inhoud van `airbnb-to-google.gs` erin
   (vervang de bestaande code).
2. Vul bovenaan twee waarden in:
   - `CALENDAR_ID`: Google Agenda → instellingen van de agenda → *Agenda integreren* → **Agenda-ID**.
     Gebruik dezelfde agenda waarvan het openbare adres in de GitHub-secret `GOOGLE_ICAL_URL` staat.
   - `AIRBNB_ICAL_URL`: het Airbnb-exportadres (dezelfde link als in de secret `AIRBNB_ICAL_URL`).
3. Project instellingen (tandwiel) → Tijdzone: **(GMT+01:00) Parijs** of Brussel.
4. Kies bovenaan de functie `syncAirbnb` → **Uitvoeren**. Geef toestemming als Google erom vraagt.
   Bekijk daarna je agenda: de Airbnb-reserveringen staan er als "Airbnb" (inchecken 15:00, uitchecken 11:00).
5. Kies de functie `installTrigger` → **Uitvoeren**. Vanaf nu loopt de sync elk uur.

## Eigen boekingen in Google Agenda

- Zet ze als gebeurtenis in dezelfde agenda, met aankomstdag t/m vertrekdag.
- Zet **Weergeven als: Bezet** (bij "Hele dag"-gebeurtenissen staat dit vaak op *Vrij*, en dan telt het niet mee
  op de website; het openbare adres toont alleen bezette tijd).

## Wat wordt wel en niet gekopieerd

- Gekopieerd: Airbnb-reserveringen (`Reserved`). Geannuleerde reserveringen verdwijnen weer uit je agenda.
- Niet gekopieerd: `Airbnb (Not available)`, dus eigen blokkades, het niet-geopende deel van Airbnb's boekingsvenster
  en geïmporteerde Booking.com-boekingen. Boekingen via Booking.com moet je dus zelf in Google Agenda zetten,
  of zet `COPY_BLOCKS = true` (dan kopieert het script alle blokken, behalve die aan de rand van het venster).
- Verwijder of verplaats een gekopieerd event niet handmatig: het script maakt het bij de volgende run opnieuw aan.
  Wijzig of annuleer de reservering in Airbnb zelf.

## Website

De website leest de agenda via het openbare vrij/bezet-adres (GitHub Action, elk uur). Zodra de Airbnb-reserveringen
in Google Agenda staan, kan de Airbnb-feed uit `availability.yml` worden gehaald, zodat alleen nog Google telt.
