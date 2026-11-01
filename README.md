# Sinterklaas Lootjes

Online lootjes trekken voor familie, vrienden en collega's. Iedereen trekt zelf, niemand trekt zichzelf, en in gezinsmodus trekken gezinsleden elkaar niet. Met live updates, optionele mail met inloggegevens en een herstelflow voor wie zijn lootje vergat.

## Architectuur

- **Express-server** (`server.js`): API, e-mail en live updates (Socket.IO). Wie wie trekt blijft op de server en komt alleen via `/api/draw` bij de juiste persoon.
- **Apenkaas** als database (`store.js`, collecties in `apenkaas.json`). De server gebruikt een server-sleutel; de browser praat nooit rechtstreeks met Apenkaas.
- **Frontend** (`public/`): losse HTML-pagina's met `style.css` en `common.js`, zonder build.

## Opzetten

1. Maak in de Apenkaas-console een tenant en een niet-publieke sleutel met `data:read` en `data:write` (voor het eerste push ook rechten om collecties aan te maken).
2. Maak de collecties aan vanuit de Apenkaas-repo:
   ```bash
   APENKAAS_URL=https://apenkaas.nl APENKAAS_TENANT=<tenant> APENKAAS_KEY=<sleutel> \
     node scripts/push.mjs <pad>/koplootjes/apenkaas.json
   ```
3. Organisatoren loggen in via de gehoste loginpagina van Apenkaas. Zet in de console bij de app (Apps, bewerken) de redirect-URI `<BASE_URL>/auth/callback` (bijvoorbeeld `https://lootjes.example.nl/auth/callback`, lokaal `http://localhost:3000/auth/callback`).
4. Kopieer `.env.example` naar `.env` en vul tenant, sleutel, de vier collectie-id's uit de uitvoer, `APENKAAS_APP_ID` (UUID van de app) en `SESSION_SECRET` (`openssl rand -hex 32`) in.
5. Voor achtergrondfoto's gebruikt de app een bucket; `push.mjs` maakt hem aan en geeft `APENKAAS_ACHTERGRONDEN_BUCKET_ID` in de uitvoer. De sleutel heeft daarvoor ook `storage:read` en `storage:write` nodig.
6. Starten: `npm install && npm start`, of `docker compose up -d` (poort 3512).

## Uiterlijk per loting

De organisator kiest per loting een kleurthema (vijf), een welkomsttekst en een achtergrondfoto. De foto wordt in de browser verkleind (JPEG, zonder locatiegegevens), via de server in Apenkaas-opslag gezet en op de deelnemerspagina's getoond via de permanente publieke link van Apenkaas.

## Lootje bewaren (Mijn lootjes)

Na het uitpakken kan een deelnemer zijn lootje bewaren met een e-mailadres en (niet verplicht) wachtwoord, of door in te loggen met een bestaand account. Het lootje wordt gekoppeld via een korte, getekende claim-token die bij het trekken wordt meegegeven (een uur geldig), niet via het e-mailadres. Zonder wachtwoord krijgt de deelnemer een mail om er zelf een te kiezen. Op `/mijn-lootjes` ziet een ingelogde gebruiker wie hij of zij trok. Overslaan kan; later koppelen kan dan niet meer, omdat het lootje maar één keer wordt getoond.

## Tests

`npm test` draait de verdeling en de hele flow tegen een nep-Apenkaas, zonder netwerk.

## Gegevens

Organisatoren hebben een Apenkaas-account; de server bewaart alleen account-id en e-mailadres in een getekende sessiecookie en in de loting zelf. Lotingen van vóór de accounts (met eigen gebruikersnaam en wachtwoord, scrypt-hash) kunnen via hun oude beheerlink aan een account worden gekoppeld. Namen en verdeling staan in de Apenkaas-tenant, dus iedereen met toegang tot die console kan ze zien.
