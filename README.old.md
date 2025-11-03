# 🎅 Sinterklaas Lootjes - Web Applicatie

Een complete web-applicatie voor het organiseren van Sinterklaas lootjes trekken, waarbij elke deelnemer op zijn eigen apparaat en eigen moment zijn lootje kan bekijken.

## ✨ Features

- **Admin Interface**: Maak en beheer lotingen met een beveiligd admin panel
- **Gezinsmodus**: Optioneel gezinsleden uitsluiten van elkaar trekken
- **Multi-device**: Elke deelnemer gebruikt zijn eigen apparaat
- **Privacy**: Niemand ziet elkaars lootjes
- **Real-time tracking**: Zie wie al heeft getrokken
- **Docker ready**: Eenvoudig te hosten met Docker

## 🚀 Snelstart met Docker

### Optie 1: Docker Compose (Aanbevolen)

```bash
# Start de applicatie
docker-compose up -d

# Bekijk logs
docker-compose logs -f

# Stop de applicatie
docker-compose down
```

### Optie 2: Docker zonder Compose

```bash
# Build de image
docker build -t sinterklaas-lootjes .

# Run de container
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e ADMIN_PASSWORD=sinterklaas2024 \
  --name sinterklaas-lootjes \
  sinterklaas-lootjes

# Bekijk logs
docker logs -f sinterklaas-lootjes

# Stop de container
docker stop sinterklaas-lootjes
docker rm sinterklaas-lootjes
```

## 📦 Installatie zonder Docker

```bash
# Installeer dependencies
npm install

# Start de server
npm start
```

## 🎯 Gebruik

### 1. Admin: Loting Aanmaken

1. Ga naar `http://localhost:3000/admin.html`
2. Log in met het admin wachtwoord (standaard: `sinterklaas2024`)
3. Klik op "Nieuwe Loting Maken"
4. Voeg deelnemers toe (optioneel met gezinnen)
5. Klik op "Loting Aanmaken"

### 2. Deelnemers: Lootje Bekijken

1. Ga naar `http://localhost:3000`
2. Voer je naam precies in zoals geregistreerd
3. Klik op "Toon Mijn Lootje"
4. Zie wie je mag verrassen!

## ⚙️ Configuratie

### Environment Variables

Je kunt de volgende omgevingsvariabelen instellen:

- `PORT`: Poort waarop de server draait (standaard: 3000)
- `ADMIN_PASSWORD`: Wachtwoord voor admin toegang (standaard: sinterklaas2024)

### Docker Compose Configuratie

Pas `docker-compose.yml` aan voor je eigen instellingen:

```yaml
environment:
  - PORT=3000
  - ADMIN_PASSWORD=jouw_wachtwoord_hier
ports:
  - "8080:3000"  # Gebruik een andere externe poort
```

## 📁 Project Structuur

```
sinterklaas-app/
├── server.js              # Express backend
├── package.json           # Node.js dependencies
├── Dockerfile            # Docker configuratie
├── docker-compose.yml    # Docker Compose configuratie
├── public/
│   ├── index.html        # Deelnemers interface
│   └── admin.html        # Admin interface
└── data/
    └── lottery.json      # Loting data (wordt aangemaakt)
```

## 🔒 Beveiliging

- **Admin wachtwoord**: Verander altijd het standaard wachtwoord in productie!
- **Data persistence**: Loting data wordt opgeslagen in `data/lottery.json`
- **Geen authenticatie voor deelnemers**: Namen zijn case-sensitive en moeten exact overeenkomen

### Wachtwoord Wijzigen

**Docker Compose:**
```yaml
environment:
  - ADMIN_PASSWORD=mijn_veilig_wachtwoord
```

**Docker:**
```bash
docker run -e ADMIN_PASSWORD=mijn_veilig_wachtwoord ...
```

**Zonder Docker:**
```bash
ADMIN_PASSWORD=mijn_veilig_wachtwoord npm start
```

## 🌐 Netwerk Toegang

### Lokaal Netwerk (LAN)

Om de applicatie toegankelijk te maken op je lokale netwerk:

1. **Vind je lokale IP adres:**
   ```bash
   # Linux/Mac
   ip addr show
   # of
   ifconfig
   
   # Windows
   ipconfig
   ```

2. **Zorg dat de container luistert op alle interfaces:**
   Docker doet dit standaard al met `-p 3000:3000`

3. **Deel de URL met deelnemers:**
   ```
   http://192.168.1.X:3000
   ```

### Externe Toegang (Internet)

Voor externe toegang heb je nodig:
- Een reverse proxy (nginx, Caddy, Traefik)
- Een domeinnaam
- SSL certificaat (Let's Encrypt)

**Voorbeeld met Caddy:**

```Caddyfile
sinterklaas.jouwdomein.nl {
    reverse_proxy localhost:3000
}
```

## 🛠️ Troubleshooting

### Container start niet

```bash
# Bekijk logs
docker-compose logs

# Controleer of poort 3000 vrij is
lsof -i :3000
```

### Data niet persistent

Zorg dat de volume mount correct is:
```bash
# Maak data directory aan
mkdir -p ./data
chmod 777 ./data
```

### Admin wachtwoord werkt niet

Controleer of de environment variable correct is gezet:
```bash
docker-compose exec sinterklaas-lootjes env | grep ADMIN_PASSWORD
```

## 🎨 Aanpassingen

### Kleuren/Styling

Pas de CSS aan in `public/index.html` en `public/admin.html`:
- Hoofdkleur: `#8B0000` (donkerrood)
- Accentkleur: `#FFD700` (goud)

### Meer Gezinnen

Voeg meer gezinsopties toe in `public/admin.html`:

```html
<select id="familySelect">
    <option value="A">Gezin A 🏠</option>
    <option value="B">Gezin B 🏡</option>
    <!-- Voeg meer toe -->
    <option value="F">Gezin F 🏛️</option>
</select>
```

## 📝 API Endpoints

### Publieke Endpoints

- `GET /api/status` - Check of er een loting bestaat
- `POST /api/draw` - Haal je lootje op

### Admin Endpoints

- `POST /api/admin/login` - Authenticeer als admin
- `GET /api/admin/config` - Haal configuratie op
- `POST /api/admin/create` - Maak nieuwe loting
- `POST /api/admin/reset` - Verwijder loting

## 🤝 Bijdragen

Dit is een simpel project voor Sinterklaas. Voel je vrij om het aan te passen voor je eigen gebruik!

## 📄 Licentie

MIT - Gebruik en pas aan zoals je wilt!

## 🎄 Veel Plezier!

Fijne Sinterklaasavond! 🎅🎁
# loottool
