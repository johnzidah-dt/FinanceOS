# Déploiement Docker - Finance OS 1.0.0

## Prérequis

- Une VM ou un LXC Linux avec Docker Engine et Docker Compose.
- Les ports `80` ou `8080` ouverts selon l'architecture retenue.
- Un nom de domaine et un reverse proxy HTTPS pour une exposition sur Internet.

## Construction locale

```bash
git clone URL_DU_DEPOT finance-os
cd finance-os
cp .env.example .env
docker compose build --pull
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8080/healthz
```

L'application est disponible sur `http://IP_DU_SERVEUR:8080`.

## Déploiement depuis GitHub Container Registry

Dans `.env`, utilisez l'image publiée par GitHub Actions :

```dotenv
FINANCE_OS_IMAGE=ghcr.io/PROPRIETAIRE/finance-os
FINANCE_OS_VERSION=1.0.0
FINANCE_OS_PORT=8080
```

Pour un dépôt privé, authentifiez le serveur avec un jeton GitHub disposant du droit `read:packages` :

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u UTILISATEUR_GITHUB --password-stdin
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
curl -fsS http://127.0.0.1:8080/healthz
```

## Mise en ligne HTTPS

Exposez le conteneur derrière Nginx Proxy Manager, Traefik, Caddy ou un reverse proxy Nginx. Le proxy doit :

- terminer TLS avec un certificat valide ;
- rediriger HTTP vers HTTPS ;
- conserver durablement le même nom de domaine ;
- transmettre les requêtes vers `http://127.0.0.1:8080`.

Le maintien de la même origine est essentiel pour la V1, car les données sont stockées dans le navigateur.

## Commandes d'exploitation

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=200
docker compose -f docker-compose.prod.yml restart
docker compose -f docker-compose.prod.yml down
```

N'utilisez pas `docker compose down -v` sur une future version équipée d'une base de données.

