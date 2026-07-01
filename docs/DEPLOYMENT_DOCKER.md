# Déploiement Docker - FinanceOS 2.0.0

## Prérequis

- Docker Engine et Docker Compose ;
- au moins 2 Go de RAM et 10 Go de stockage ;
- un nom de domaine HTTPS pour l'installation PWA hors de `localhost`.

## Installation

```bash
git clone https://github.com/johnzidah-dt/FinanceOS.git finance-os
cd finance-os
cp .env.example .env
nano .env
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8080/healthz
```

Dans `.env`, remplacez au minimum :

```dotenv
POSTGRES_PASSWORD=mot-de-passe-long-et-unique
JWT_SECRET=secret-aleatoire-de-64-caracteres-ou-plus
INITIAL_ADMIN_PASSWORD=mot-de-passe-administrateur
```

## HTTPS et PWA

Placez FinanceOS derrière Caddy, Traefik, Nginx Proxy Manager ou un reverse proxy Nginx. Le proxy doit transmettre HTTP et WebSocket vers `http://127.0.0.1:8080`.

Une fois le certificat HTTPS actif, Chrome, Edge et Android peuvent proposer **Installer FinanceOS**. Sur iPhone/iPad, utilisez **Partager > Sur l'écran d'accueil**.

## Images GitHub

Le pipeline publie deux images :

```text
ghcr.io/johnzidah-dt/financeos
ghcr.io/johnzidah-dt/financeos-api
```

Pour un dépôt privé, connectez Docker à GHCR avec un jeton `read:packages`, puis utilisez `docker-compose.prod.yml`.

## Sauvegarde

```bash
mkdir -p backups
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > backups/financeos.dump
```

## Restauration

```bash
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < backups/financeos.dump
```
