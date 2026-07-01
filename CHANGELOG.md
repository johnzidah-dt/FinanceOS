# Changelog

## 2.0.1 - 2026-07-01

- Suppression du compte et de la société de démonstration : la première ouverture crée désormais le premier administrateur et sa société.
- Correction des faux conflits de synchronisation provoqués par plusieurs sauvegardes simultanées du même navigateur.
- Ajout d’un indicateur visible « Enregistrement / Enregistré / Non synchronisé ».
- Ajout des décaissements de salaires avec règlement automatique de la dette salariale.
- Ajout des règlements CNSS, AMU et autres charges sociales avec période et justificatif téléchargeable.
- Classement des décaissements par nature : fournisseur, salaire, charges, prestataire, freelance, partenaire, achats, avantages et fonctionnement.
- Correction des mentions d’arrêté sur les factures et proformas.
- Agrandissement et alignement à gauche du logo sur les documents PDF.
- Correction des espacements des bulletins de paie et des synthèses qui chevauchaient les tableaux.
- Correction des erreurs de réinitialisation de formulaires après une opération serveur.

## 2.0.0 - 2026-06-30

- Ajout de PostgreSQL comme stockage central partagé.
- Ajout d'une API avec authentification, mots de passe chiffrés et autorisations.
- Synchronisation temps réel entre utilisateurs par WebSocket.
- Ajout de l'installation PWA sur ordinateur et mobile.
- Déploiement Docker en trois services avec volume de base persistant.
- Mise à jour des procédures Proxmox, sauvegarde et restauration.
- Ajout d'un installateur Proxmox/Linux en une seule commande.

Toutes les modifications notables de Finance OS sont documentées ici.

## [1.0.0] - 2026-06-30

### Ajouté

- Factures, proformas, paiements et reçus PDF.
- Gestion des caisses, banques, décaissements et arrêtés.
- Contacts clients et fournisseurs, achats et bons de commande.
- Dossiers avec historique et pièces téléchargeables.
- Gestion de la paie, dossiers salariés et bulletins PDF.
- Gestion des sociétés, utilisateurs, rôles et autorisations.
- Sauvegarde et restauration versionnées des données locales.
- Image Docker Nginx, contrôle de santé et pipeline GHCR.
