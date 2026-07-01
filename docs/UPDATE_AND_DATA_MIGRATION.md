# Mises à jour et protection des données

## Source de vérité

Depuis FinanceOS 2.0.0, PostgreSQL est la source de vérité. Les données du navigateur servent uniquement de cache et ne doivent pas être utilisées comme sauvegarde de production.

Le volume nommé `financeos-db` est indépendant des conteneurs de l'interface et de l'API. `docker compose up -d` remplace les services sans supprimer la base.

## Procédure avant mise à jour

1. Créer une sauvegarde `pg_dump`.
2. Copier la sauvegarde hors du serveur.
3. Créer un snapshot Proxmox.
4. Noter la version actuellement déployée.
5. Mettre à jour les images sans supprimer les volumes.
6. Contrôler la connexion, les factures, les paiements et les utilisateurs.

```bash
docker compose exec -T db pg_dump -U financeos -d financeos -Fc > financeos-before-update.dump
docker compose pull
docker compose up -d
docker compose ps
```

## Règle impérative

Ne jamais utiliser les commandes suivantes en production :

```bash
docker compose down -v
docker volume rm financeos-db
```

## Évolution du schéma

Les créations de tables sont idempotentes et exécutées au démarrage de l'API. Les prochaines versions devront ajouter des migrations numérotées, transactionnelles et additives. Une colonne ou table utilisée par la version précédente ne sera supprimée qu'après une version de transition.

## Import des données V1

Une sauvegarde JSON V1 peut être importée depuis **Paramètres > Application** après connexion. L'import remplace l'état métier partagé de l'espace courant dans PostgreSQL. Créez d'abord un `pg_dump`.

## Rollback

Un rollback applicatif consiste à redéployer les anciennes images. Une restauration PostgreSQL n'est nécessaire que si une migration de données incompatible a été appliquée.
