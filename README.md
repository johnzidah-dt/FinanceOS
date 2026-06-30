# Finance OS

Finance OS centralise la facturation, les proformas, les paiements, les caisses et banques, les achats fournisseurs, les dossiers et la paie pour les sociétés de services.

## Version

Version actuelle : **1.0.0**.

## Démarrage avec Docker

```bash
cp .env.example .env
docker compose up -d --build
```

L'application est ensuite disponible sur `http://localhost:8080`.

Identifiants initiaux de test :

```text
admin@demo.local
demo1234
```

Modifiez immédiatement ce mot de passe depuis le profil administrateur.

## Données de la V1

La V1 est une application statique servie par Nginx. Les données sont actuellement stockées dans le navigateur, sous une clé stable et versionnée. Elles ne sont donc ni centralisées ni partagées entre plusieurs appareils.

Avant toute mise à jour, utilisez **Paramètres > Application > Télécharger une sauvegarde**. Conservez aussi la même adresse, le même protocole et le même port : le stockage du navigateur est lié à cette origine.

## Documentation

- [Déploiement Docker](docs/DEPLOYMENT_DOCKER.md)
- [Publication GitHub](docs/GITHUB_PUBLISHING.md)
- [Mises à jour et protection des données](docs/UPDATE_AND_DATA_MIGRATION.md)
- [Installation Proxmox](INSTALL_PROXMOX.md)

## Vérification d'une version

```bash
sh scripts/release-check.sh
```

