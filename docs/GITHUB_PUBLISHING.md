# Publication du projet sur GitHub

Le dépôt doit être privé par défaut.

## Avec GitHub CLI

Depuis la racine du projet :

```bash
gh auth login
gh repo create finance-os --private --source=. --remote=origin --push
git push origin v1.0.0
```

## Avec un dépôt créé depuis le site GitHub

Créez un dépôt privé vide nommé `finance-os`, sans README ni licence, puis exécutez :

```bash
git remote add origin git@github.com:PROPRIETAIRE/finance-os.git
git push -u origin main
git push origin v1.0.0
```

Depuis le workspace préparé par Codex, dont les métadonnées Git sont séparées, utilisez directement :

```bash
sh scripts/publish-github.sh git@github.com:PROPRIETAIRE/finance-os.git
```

## Après publication

1. Activez la protection de la branche `main`.
2. Exigez le contrôle GitHub Actions avant fusion.
3. Interdisez les poussées directes sur `main`.
4. Activez Dependabot pour les actions GitHub.
5. Publiez les versions avec des tags immuables `vMAJEUR.MINEUR.CORRECTIF`.

Le workflow `.github/workflows/container.yml` construit l'image et la publie dans `ghcr.io/PROPRIETAIRE/finance-os`.
