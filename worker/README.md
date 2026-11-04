# Reserveringen → GitHub issue

Een Cloudflare Worker ontvangt het reserveringsformulier van visiblenatu.re en maakt een issue aan in de
**private** repo `frontdemer/reserveringen`. Het GitHub-token staat alleen in de Worker, nooit op de site.

## Eenmalig instellen

1. **Token maken** (GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token)
   - Resource owner: `frontdemer`
   - Repository access: *Only select repositories* → `frontdemer/reserveringen`
   - Permissions → Repository permissions → **Issues: Read and write**
   - Kies een verloopdatum en zet een herinnering in je agenda om het token te vernieuwen.
2. **Worker uitrollen** (Cloudflare-account nodig, gratis)
   ```bash
   cd worker
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put GITHUB_TOKEN   # plak het token
   ```
   `deploy` toont de URL, bijvoorbeeld `https://fdm-reservations.<jouw-naam>.workers.dev`.
3. **URL in de site zetten**: vul die URL in bij `RESERVATION_ENDPOINT` in `index.html` en push.
4. **Meldingen**: open de repo `frontdemer/reserveringen` → *Watch* → *All Activity* (of *Custom* → Issues).
   GitHub mailt je dan bij elke nieuwe aanvraag; de GitHub-app geeft ook pushmeldingen.

## Wat de Worker doet

- Accepteert alleen verzoeken van `https://visiblenatu.re` (zie `ALLOWED_ORIGINS` in `wrangler.toml`).
- Valideert naam, e-mail en data (minimaal 2, maximaal 90 nachten, geen data in het verleden).
- Een verborgen veld vangt simpele spambots af: die krijgen "ok" terug maar er wordt niets aangemaakt.
- Vergelijkt de data met `availability.json`. Bij overlap krijgt het issue het label
  `beschikbaarheid-conflict`; de aanvraag wordt nooit geweigerd, want die file loopt tot een uur achter.
- `@`-vermeldingen van gasten worden onschadelijk gemaakt, zodat niemand een melding kan afdwingen.

## Testen

Een aanvraag kun je nagaan met:

```bash
curl -i -X POST "$WORKER_URL" -H "Origin: https://visiblenatu.re" -H "Content-Type: application/json" \
  -d '{"lang":"nl","name":"Test","email":"test@example.com","checkin":"2027-02-01","checkout":"2027-02-04"}'
```

Sluit het testissue daarna in de repo.
