# FinanceOS

FinanceOS centralise la facturation, les paiements, les caisses et banques, les achats fournisseurs, les dossiers et la paie.

## Version

Version actuelle : **2.0.0**.

Cette version est multi-utilisateur : les données sont enregistrées dans PostgreSQL et synchronisées entre les navigateurs connectés au même espace FinanceOS. Le stockage du navigateur n'est plus la source principale.

## Architecture

- `finance-os` : interface web et reverse proxy Nginx ;
- `api` : authentification, autorisations, synchronisation et API ;
- `db` : PostgreSQL avec volume persistant `financeos-db` ;
- `WebSocket` : actualisation des autres utilisateurs après une modification ;
- `PWA` : installation sur ordinateur ou mobile.

## Démarrage avec Docker

### Installation automatique sur Proxmox/Linux

Sur une VM ou un LXC Debian/Ubuntu exécuté en tant que `root` :

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/johnzidah-dt/FinanceOS/main/install.sh)"
```

La commande installe Docker si nécessaire, génère les secrets, démarre les trois services et affiche l'adresse ainsi que le mot de passe administrateur initial. Relancer la même commande met à jour FinanceOS en conservant `.env` et PostgreSQL.

Pour un dépôt GitHub privé :

```bash
export GITHUB_TOKEN="VOTRE_JETON_READ_REPOSITORY"
curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" https://raw.githubusercontent.com/johnzidah-dt/FinanceOS/main/install.sh | bash
```

### Installation manuelle

```bash
cp .env.example .env
# Modifier obligatoirement POSTGRES_PASSWORD, JWT_SECRET et INITIAL_ADMIN_PASSWORD
docker compose up -d --build
docker compose ps
```

Ouvrez `http://localhost:8080`. Pour une installation sur un serveur ou un mobile, configurez un domaine HTTPS afin que l'installation PWA soit proposée correctement.

Accès initial de développement :

```text
admin@demo.local
demo1234
```

## Persistance et mises à jour

La base reste dans le volume Docker `financeos-db`. Une reconstruction des conteneurs ne supprime pas ce volume.

Avant chaque mise à jour :

```bash
mkdir -p backups
docker compose exec -T db pg_dump -U financeos -d financeos -Fc > backups/financeos-$(date +%F-%H%M).dump
docker compose pull
docker compose up -d
```

N'exécutez jamais `docker compose down -v` en production : l'option `-v` supprime le volume PostgreSQL.

## Documentation

- [Déploiement Docker](docs/DEPLOYMENT_DOCKER.md)
- [Mises à jour et protection des données](docs/UPDATE_AND_DATA_MIGRATION.md)
- [Installation Proxmox](INSTALL_PROXMOX.md)

## Vérification

```bash
sh scripts/release-check.sh
```
