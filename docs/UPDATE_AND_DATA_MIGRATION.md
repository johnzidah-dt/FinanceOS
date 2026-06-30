# Plan de mise à jour et de protection des données

## Situation de la V1

Finance OS 1.0.0 est servi comme application statique. Les données sont enregistrées dans le stockage local du navigateur sous la clé stable `finance-os-prototype-v17`. Le remplacement du conteneur ne supprime pas ces données si l'utilisateur conserve le même navigateur et exactement la même origine : protocole, domaine et port.

Cette architecture convient aux tests, mais pas encore à un usage multi-utilisateur centralisé.

## Procédure obligatoire avant chaque mise à jour V1

1. Dans Finance OS, ouvrir **Paramètres > Application**.
2. Télécharger une sauvegarde JSON et vérifier que le fichier n'est pas vide.
3. Créer un snapshot Proxmox de la VM ou du LXC.
4. Noter la version Docker actuellement déployée.
5. Déployer une version numérotée, jamais `latest` seule.
6. Vérifier `/healthz`, la connexion et l'ouverture des principales rubriques.
7. Restaurer la sauvegarde depuis l'application uniquement si les données n'apparaissent pas.

Le fichier de sauvegarde contient des données sensibles et doit être chiffré ou placé dans un coffre sécurisé.

## Mise à jour Docker

```bash
cp .env .env.before-update
# Modifier uniquement FINANCE_OS_VERSION dans .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
curl -fsS http://127.0.0.1:8080/healthz
```

## Rollback applicatif

```bash
cp .env.before-update .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Le rollback du conteneur ne doit jamais écraser les données. Une restauration de sauvegarde reste une opération séparée et explicite.

## Règles de versionnement des données

- `APP_VERSION` suit le versionnement sémantique.
- `DATA_SCHEMA_VERSION` n'augmente que lorsque la structure des données change.
- Chaque évolution du schéma ajoute une migration idempotente de `N` vers `N+1`.
- Une migration ne supprime jamais immédiatement une propriété encore utilisée par la version précédente.
- L'application refuse une sauvegarde provenant d'un schéma plus récent.
- La clé de stockage ne doit jamais être renommée pour contourner une migration.

## Passage à une base PostgreSQL

### Phase 1 - Socle

- API authentifiée côté serveur.
- PostgreSQL dans un volume nommé ou un service managé.
- Mots de passe hachés avec Argon2 ou bcrypt.
- Stockage objet séparé pour les contrats, scans et relevés.
- Import contrôlé des sauvegardes JSON V1.

### Phase 2 - Migrations sûres

- Outil de migration versionné avec le code.
- Sauvegarde `pg_dump` avant migration.
- Migrations transactionnelles et additives selon le modèle expand/contract.
- Compatibilité temporaire entre la version courante et la précédente.
- Migration exécutée par une tâche unique avant le basculement applicatif.

### Phase 3 - Déploiement

- Environnement de staging alimenté par des données anonymisées.
- Test automatique de restauration de sauvegarde.
- Image Docker référencée par tag et digest.
- Contrôle de santé, vérification fonctionnelle et rollback automatique.
- Conservation quotidienne, hebdomadaire et mensuelle des sauvegardes.

## Critères autorisant une mise à jour

- Sauvegarde créée et restaurable.
- Migration testée sur une copie de la base.
- Tests fonctionnels et comptables validés.
- Image Docker immuable disponible.
- Version précédente encore disponible pour rollback.
- Notes de version et procédure de retour arrière publiées.

