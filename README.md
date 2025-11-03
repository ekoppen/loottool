# 🎁 Sinterklaas Lootjes

Een moderne, multi-tenant Sinterklaas lootjes applicatie met real-time updates, family mode en email notificaties.

## ✨ Features

- **Multi-tenant**: Meerdere lotingen tegelijk, elk met eigen inloggegevens
- **Family Mode**: Gezinsleden kunnen elkaar niet trekken
- **Real-time Updates**: Live updates via WebSockets
- **Email Notificaties**: Automatische email met inloggegevens
- **Responsive Design**: Werkt perfect op desktop en mobiel
- **Geen Scrollbars**: Compact design dat altijd op het scherm past
- **Moderne UI**: Glassmorphism design met Sinterklaas kleuren

## 🚀 Quick Start

### Stap 1: Configureer Email (Optioneel)

Als je email notificaties wilt gebruiken:

1. **Bewerk `.env` bestand**:
   ```bash
   nano .env
   ```

2. **Vervang met je eigen Gmail gegevens**:
   ```env
   GMAIL_USER=jouw-email@gmail.com
   GMAIL_APP_PASSWORD=jouw-16-char-app-password
   ```

3. **Volg de [Gmail App Password Setup](#gmail-app-password-setup)** voor het aanmaken van een app password

> **Let op**: Als je geen email wilt gebruiken, werkt de app ook zonder! Laat de standaard waarden staan.

### Stap 2: Start de Applicatie

**Met Docker Compose (Aanbevolen)**:
```bash
docker-compose up -d
```

**Zonder Docker**:
```bash
npm install
npm start
```

### Stap 3: Open de Applicatie

- **Hoofdpagina**: http://localhost:3512
- **Admin**: http://localhost:3512/admin.html

## 📧 Gmail App Password Setup

Voor email functionaliteit heb je een Gmail App Password nodig:

1. Ga naar https://myaccount.google.com/security
2. Schakel **2-Step Verification** in (als nog niet gedaan)
3. Ga naar **App passwords**: https://myaccount.google.com/apppasswords
4. Selecteer:
   - App: **Mail**
   - Device: **Other (custom name)** → bijv. "Sinterklaas Lootjes"
5. Klik op **Generate**
6. Kopieer het gegenereerde 16-character wachtwoord
7. Plak dit in je `.env` bestand bij `GMAIL_APP_PASSWORD`

**Belangrijk**: 
- Dit is NIET je normale Gmail wachtwoord!
- Het app password is 16 karakters zonder spaties
- Bewaar dit wachtwoord veilig (het wordt niet opnieuw getoond)

## 🎯 Gebruik

### Een Loting Aanmaken

1. Ga naar http://localhost:3512/admin.html
2. Vul in:
   - **Naam van je loting**: bijv. "Familie Jansen 2024"
   - **Gebruikersnaam**: Kies een admin gebruikersnaam
   - **Wachtwoord**: Minimaal 4 tekens
   - **Email** (optioneel): Als ingevuld, krijg je een email met alle gegevens
3. Klik op **"Verder naar deelnemers"**
4. Voeg deelnemers toe:
   - **Simpele modus**: Voeg gewoon namen toe
   - **Gezinsmodus**: Groepeer namen per gezin (bijv. "Familie Jansen", "Gezin Piet")
5. Klik op **"Loting Aanmaken"**

### Deelnemers Link Delen

Na aanmaken krijg je twee links:
- **Deelnemers link**: Deel deze met je groep  
  `http://localhost:3512/event/abc123...`
- **Admin link**: Bewaar deze voor jezelf (niet delen!)  
  `http://localhost:3512/admin/abc123...`

Als je een email hebt opgegeven, krijg je beide links automatisch toegestuurd!

### Deelnemen aan een Loting

1. Open de deelnemers link die je hebt ontvangen
2. Klik op je naam in de lijst
3. Bevestig dat jij het bent
4. Zie wie je hebt getrokken!

## 🔧 Configuratie

### Environment Variables (`.env`)

| Variabele | Verplicht | Beschrijving |
|-----------|-----------|--------------|
| `PORT` | Nee | Server poort (default: 3000) |
| `BASE_URL` | Nee | Basis URL voor emails (bijv. https://jouwdomain.com) |
| `GMAIL_USER` | Nee | Gmail email adres voor verzenden |
| `GMAIL_APP_PASSWORD` | Nee | Gmail App Password (16 karakters) |

**Voorbeeld `.env`**:
```env
PORT=3000
BASE_URL=http://localhost:3512
GMAIL_USER=sinterklaas@gmail.com
GMAIL_APP_PASSWORD=abcdefghijklmnop
```

### Poorten Aanpassen

Standaard draait de app op poort 3512. Om dit te wijzigen:

**In `docker-compose.yml`**:
```yaml
ports:
  - "8080:3000"  # Externe poort:Interne poort
```

**In `.env`**:
```env
BASE_URL=http://localhost:8080
```

## 📂 Project Structuur

```
loottool/
├── .env                # Email configuratie (NIET committen!)
├── .env.example        # Voorbeeld configuratie
├── .gitignore          # Git ignore rules
├── server.js           # Express server + WebSocket logic
├── database.js         # SQLite database functies
├── package.json        # Dependencies
├── docker-compose.yml  # Docker configuratie
├── Dockerfile          # Docker image definitie
├── README.md          # Deze file
├── public/
│   ├── index.html     # Deelnemers interface
│   ├── admin.html     # Admin interface
│   ├── sint.png       # Sinterklaas afbeelding
│   └── kado.png       # Cadeau icoon
└── data/
    └── lottery.db     # SQLite database (automatisch aangemaakt)
```

## 🔒 Beveiliging

### Veilig Gebruik

✅ **Goed**:
- Gebruik unieke wachtwoorden per loting
- Deel alleen de deelnemers link, niet de admin link
- Bewaar `.env` lokaal (wordt niet gecommit naar Git)
- Gebruik HTTPS in productie

⚠️ **Let op**:
- Wachtwoorden worden NIET gehashed (dit is een simpele loting app)
- Event URLs zijn random maar niet crypto-secure
- Gebruik deze app niet voor gevoelige data

### Email Privacy

- Emails worden alleen verstuurd als je expliciet een adres opgeeft
- Je Gmail credentials blijven lokaal in `.env`
- Geen data wordt naar externe services gestuurd (behalve email via Gmail)

## 🛠 Development

### Logs Bekijken

```bash
# Docker logs
docker-compose logs -f sinterklaas-lootjes

# Laatste 50 regels
docker-compose logs --tail=50 sinterklaas-lootjes

# Zoek naar email gerelateerde logs
docker-compose logs sinterklaas-lootjes | grep -i email
```

### Database Reset

```bash
# Verwijder alle lotingen
rm -f data/lottery.db*

# Restart container
docker-compose restart
```

### Rebuild Docker Image

```bash
# Full rebuild
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Lokaal Testen (zonder Docker)

```bash
# Installeer dependencies
npm install

# Start server
npm start

# Of met custom port
PORT=8080 npm start
```

## 🐛 Troubleshooting

### Email Werkt Niet

**Probleem**: Emails worden niet verzonden

**Oplossing**:
1. Check of email is geconfigureerd:
   ```bash
   docker-compose logs sinterklaas-lootjes | grep -i email
   ```
   Je moet zien: `📧 Email service configured`

2. Controleer `.env` bestand:
   ```bash
   cat .env | grep GMAIL
   ```
   Beide waarden moeten ingevuld zijn (niet de placeholder tekst)

3. Test Gmail App Password:
   - Log in op Gmail
   - Ga naar https://myaccount.google.com/apppasswords
   - Verwijder oude app password
   - Maak nieuw aan en update `.env`

4. Restart container:
   ```bash
   docker-compose restart
   ```

### Scrollbars Verschijnen

**Probleem**: Onnodige scrollbars in UI

**Oplossing**:
- Browser zoom moet 100% zijn
- Hard refresh: Ctrl+Shift+R (Windows) of Cmd+Shift+R (Mac)
- Clear browser cache

### Poort Al in Gebruik

**Probleem**: `port 3512 already in use`

**Oplossing**:
```bash
# Vind proces op poort 3512
lsof -i :3512

# Kill het proces
kill -9 <PID>

# Of gebruik andere poort in docker-compose.yml
```

### Container Start Niet

**Probleem**: Docker container crashed

**Oplossing**:
```bash
# Bekijk logs
docker-compose logs sinterklaas-lootjes

# Check syntax .env file
cat .env

# Rebuild
docker-compose build --no-cache
docker-compose up -d
```

## 📝 Features in Detail

### Family Mode

- **Flexibele Gezinsnamen**: Niet alleen A, B, C maar volledige namen
  - Voorbeelden: "Familie Jansen", "Gezin Van Dam", "De Vries Familie"
- **Edit Modal**: Eenvoudig wijzigen van gezinsindeling met modal (geen browser alert)
- **Autocomplete**: Suggesties van bestaande gezinsnamen
- **Validatie**: Voorkomt dat gezinsleden elkaar trekken
- **Minimum**: Tenminste 2 verschillende gezinnen nodig

### Real-time Updates

- **Live Dashboard**: Admin ziet direct wie heeft getrokken
- **WebSocket**: Automatische updates zonder refresh
- **Progress Tracking**: Percentage voltooid
- **Reconnect**: Automatisch herverbinden bij verbindingsverlies

### Email Functionaliteit

**Wat krijg je in de email**:
- Admin gebruikersnaam en wachtwoord
- Direct link naar admin pagina
- Direct link naar deelnemers pagina
- Duidelijke instructies
- Mooie HTML opmaak met Sinterklaas styling

**Privacy**:
- Alleen verzonden als je een email opgeeft
- Geen tracking of analytics
- Direct van je eigen Gmail account

## 🎨 Design

### Kleurenschema

- **Primary**: Sinterklaas rood `#c41e3a`
- **Secondary**: Bruin `#8b4513`
- **Accent**: Goud `#daa520`
- **Background**: Gradient van rood naar bruin

### Typography

- **Headings**: Playfair Display (serif, elegant)
- **Body**: Inter (sans-serif, modern en leesbaar)
- **Monospace**: Voor URLs en codes

### UI Principes

- **Glassmorphism**: Transparante cards met blur effect
- **Geen Icons in Labels**: Clean en professioneel
- **Responsive**: Werkt op alle schermgroottes
- **Accessibility**: Duidelijke focus states en kleurcontrast

## 🌐 Productie Deployment

### Reverse Proxy (Aanbevolen)

Voor productie gebruik met eigen domein:

**Nginx voorbeeld**:
```nginx
server {
    listen 443 ssl;
    server_name sinterklaas.jouwdomein.nl;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3512;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

**Update `.env`**:
```env
BASE_URL=https://sinterklaas.jouwdomein.nl
```

### Security Checklist

- [ ] Gebruik HTTPS (SSL certificaat)
- [ ] Update `.env` met productie URL
- [ ] Gebruik sterke wachtwoorden
- [ ] Backup `data/` directory regelmatig
- [ ] Monitor logs voor errors
- [ ] Beperk toegang tot admin URLs

## 📜 License

MIT License - Gebruik en pas aan zoals je wilt!

## 🤝 Contributing

Pull requests zijn welkom! Voor grote wijzigingen, open eerst een issue om te bespreken wat je wilt veranderen.

## ❓ Veel Gestelde Vragen

**Q: Kan ik meerdere lotingen tegelijk hebben?**  
A: Ja! Elke loting heeft zijn eigen unieke URL en credentials.

**Q: Moet ik email configureren?**  
A: Nee, het is optioneel. De app werkt prima zonder email.

**Q: Hoe verwijder ik een oude loting?**  
A: Login als admin en klik op "Loting Verwijderen" onderaan de pagina.

**Q: Kan ik de gezinsnamen achteraf wijzigen?**  
A: Ja, tijdens het toevoegen van deelnemers kun je op "Wijzig" klikken.

**Q: Werkt het zonder internet?**  
A: Ja, op lokaal netwerk. Voor email heb je wel internet nodig.

---

Made with ❤️ voor gezellige Sinterklaasavonden 🎅🎁
