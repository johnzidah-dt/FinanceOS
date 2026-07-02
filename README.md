# FinanceOS

FinanceOS centralise la facturation, les paiements, les caisses et banques, les achats fournisseurs, les dossiers et la paie.

## Version

Version actuelle : **2.0.2**.

Cette version est multi-utilisateur : les données sont enregistrées dans PostgreSQL et synchronisées entre les navigateurs connectés au même espace FinanceOS. Le stockage du navigateur n'est plus la source principale.

Pour la paie au Togo, l'assiette CNSS inclut le salaire, les indemnités, primes, gratifications, commissions et avantages soumis. Les remboursements de frais et prestations familiales en sont exclus, conformément aux [règles de recouvrement publiées par la CNSS Togo](https://cnss.tg/prestations/recouvrement/). Les taux restent configurables par société dans FinanceOS.

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

La commande installe Docker si nécessaire, génère les secrets et démarre les trois services. À la première ouverture, le premier utilisateur crée son compte administrateur et sa première société. Relancer la même commande met à jour FinanceOS en conservant `.env` et PostgreSQL.

Pour un dépôt GitHub privé :

```bash
export GITHUB_TOKEN="VOTRE_JETON_READ_REPOSITORY"
curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" https://raw.githubusercontent.com/johnzidah-dt/FinanceOS/main/install.sh | bash
```

### Installation manuelle

```bash
cp .env.example .env
# Modifier obligatoirement POSTGRES_PASSWORD et JWT_SECRET
docker compose up -d --build
docker compose ps
```

Ouvrez `http://localhost:8080`. Pour une installation sur un serveur ou un mobile, configurez un domaine HTTPS afin que l'installation PWA soit proposée correctement.

Aucun compte par défaut n’est créé. Le formulaire d’inscription initialise le premier espace de travail.

## Persistance et mises à jour

La base reste dans le volume Docker `financeos-db`. Une reconstruction des conteneurs ne supprime pas ce volume.

Avant chaque mise à jour :

```bash
mkdir -p backups
docker compose exec -T db pg_dump -U financeos -d financeos -Fc > backups/financeos-$(date +%F-%H%M).dump
git pull --ff-only
docker compose up -d --build
```

L’installateur automatique réalise lui-même une sauvegarde datée dans `/opt/financeos/backups` avant de télécharger une nouvelle version. Pour mettre à jour une installation existante :

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/johnzidah-dt/FinanceOS/main/install.sh)"
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
