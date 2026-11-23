# Vorrat

Kleine Vorrats-App (PWA) für Handy und PC: Bestand je Lagerort mit MHD, Mindestbestand, automatische Einkaufsliste.

- Frontend: React + Vite + TypeScript, vite-plugin-pwa (offline-fähig, installierbar)
- Daten und Login: Supabase (Postgres mit Row Level Security), Schema in `supabase/01_schema.sql`
- Hosting: GitHub Pages, Deployment per GitHub Actions bei jedem Push auf `main`

## Lokal starten

```
npm install
copy .env.example .env.local   # Werte eintragen
npm run dev
```

Produktdaten per Barcode: [Open Food Facts](https://world.openfoodfacts.org) (ODbL).
