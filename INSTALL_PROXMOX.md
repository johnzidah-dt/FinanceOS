# Finance OS 1.0.0 - Installation sur Proxmox

Finance OS 1.0.0 peut être servi par Nginx dans un conteneur Docker ou directement dans un conteneur LXC Debian/Ubuntu. La V1 stocke encore les données dans le navigateur : lisez la procédure de sauvegarde avant chaque mise à jour.

## Option 1 - Docker dans une VM ou un LXC Proxmox

Pré-requis : Docker et Docker Compose installés.

```bash
cd /opt/finance-os
cp .env.example .env
docker compose up -d --build
curl -fsS http://127.0.0.1:8080/healthz
```

L’application sera disponible sur :

```text
http://IP_DU_CONTENEUR:8080
```

Identifiants de test :

```text
admin@demo.local
demo1234
```

À la première connexion, Finance OS affiche un guide de démarrage. La base métier est vide : il faut créer les comptes bancaires/caisses, contacts, factures et dossiers. Le mot de passe administrateur peut être modifié depuis l’écran Profil ou depuis Paramètres > Utilisateurs.

Commandes utiles :

```bash
docker compose logs -f
docker compose restart
docker compose down
```

Pour déployer l'image publiée par GitHub plutôt que la reconstruire, consultez `docs/DEPLOYMENT_DOCKER.md`.

## Option 2 - LXC Proxmox avec Nginx

Créer un conteneur LXC Debian 12 ou Ubuntu 24.04, puis installer Nginx :

### Installation rapide

Copier le dossier du projet dans le LXC, par exemple dans `/opt/finance-os`, puis exécuter :

```bash
cd /opt/finance-os
sh deploy/install-lxc-nginx.sh
```

### Installation manuelle

```bash
apt update
apt install -y nginx rsync
```

Copier le dossier du prototype dans le conteneur :

```bash
mkdir -p /var/www/finance-os
rsync -av outputs/prototype/ /var/www/finance-os/
```

Créer le site Nginx :

```bash
cat >/etc/nginx/sites-available/finance-os <<'EOF'
server {
  listen 80;
  server_name _;

  root /var/www/finance-os;
  index index.html;

  location = /healthz {
    access_log off;
    add_header Content-Type text/plain;
    return 200 "ok\n";
  }

  location = /index.html {
    add_header Cache-Control "no-store, no-cache, must-revalidate";
    try_files $uri =404;
  }

  location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-store";
  }
}
EOF
```

Activer le site :

```bash
ln -sf /etc/nginx/sites-available/finance-os /etc/nginx/sites-enabled/finance-os
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

L’application sera disponible sur :

```text
http://IP_DU_LXC
```

## Mise à jour

Avant toute mise à jour, téléchargez une sauvegarde depuis **Paramètres > Application** et créez un snapshot Proxmox.

Après modification des fichiers dans `outputs/prototype`, reconstruire l’image Docker :

```bash
docker compose up -d --build
```

Pour LXC sans Docker, recopier simplement les fichiers :

```bash
rsync -av outputs/prototype/ /var/www/finance-os/
systemctl reload nginx
```

## Notes pour les tests

- Les données sont stockées dans le navigateur et ne sont pas encore centralisées.
- Les données factices ont été retirées. Seuls la société initiale et le compte administrateur sont présents.
- Les journaux sont exportés en `.xls`.
- Les documents métier sont générés en PDF.
- Conservez le même protocole, domaine et port pour ne pas changer l'origine du stockage navigateur.
- Le plan de migration vers PostgreSQL est décrit dans `docs/UPDATE_AND_DATA_MIGRATION.md`.
