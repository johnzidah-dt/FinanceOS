# Installation de FinanceOS 2.0.0 sur Proxmox

## Architecture recommandée

Utilisez une VM Debian 12 ou Ubuntu 24.04. Un LXC privilégié avec les fonctions Docker activées peut convenir pour les tests, mais une VM offre une isolation plus prévisible en production.

Configuration minimale : 2 vCPU, 2 Go de RAM et 20 Go de disque.

## Installation

### Installation automatique recommandée

Dans la console `root` de la VM ou du LXC :

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/johnzidah-dt/FinanceOS/main/install.sh)"
```

Cette commande peut être relancée pour mettre FinanceOS à jour. Elle conserve les secrets, la configuration et le volume PostgreSQL.

### Installation manuelle

```bash
apt update
apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh
git clone https://github.com/johnzidah-dt/FinanceOS.git /opt/finance-os
cd /opt/finance-os
cp .env.example .env
nano .env
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8080/healthz
```

Configurez ensuite un reverse proxy HTTPS vers `IP_DE_LA_VM:8080`. HTTPS est obligatoire pour proposer l'installation de l'application sur les appareils distants.

## Sauvegarde quotidienne

```bash
mkdir -p /var/backups/financeos
cd /opt/finance-os
docker compose exec -T db pg_dump -U financeos -d financeos -Fc > /var/backups/financeos/financeos-$(date +%F).dump
find /var/backups/financeos -type f -mtime +30 -delete
```

Planifiez cette commande avec `cron` et copiez les sauvegardes sur un autre stockage.

## Mise à jour

```bash
cd /opt/finance-os
docker compose exec -T db pg_dump -U financeos -d financeos -Fc > /var/backups/financeos/pre-update.dump
git pull --ff-only
docker compose up -d --build
docker compose ps
```

Ne lancez jamais `docker compose down -v`.
