# Cahier des charges - Logiciel SaaS de facturation, paiement, caisse et projets

## 1. Objectif

Construire une plateforme SaaS pour agences de prestation de services, cabinets et petites entreprises qui veulent centraliser :

- la facturation ;
- le suivi des paiements ;
- la gestion de caisse ;
- les comptes bancaires ;
- les décaissements ;
- les projets et evenements ;
- les rapports exportables.

Le modele de facture fourni sert de reference pour la premiere version du generateur de factures : entete marque, reference, date, client, titre, objet, tableau groupe par sections, total, montant en lettres, signature et pied de page societe.

## 2. Perimetre fonctionnel

### Clients

- Creation et modification d'une fiche client.
- Historique des factures et paiements.
- Solde restant du client.
- Coordonnees administratives et fiscales.

### Projets et evenements

- Creation automatique d'un projet lors de la creation d'une facture.
- Possibilite de rattacher une facture a un projet existant.
- Association des encaissements, depenses et decaissements a un projet.
- Suivi de rentabilite : facture, encaisse, depense, marge.

### Factures

- Generation de facture selon le modele fourni.
- Numerotation automatique.
- Lignes de facture groupees par sections.
- Gestion des quantites, prix unitaires, forfaits et totaux.
- Statuts : brouillon, emise, partiellement payee, payee, en retard, annulee.
- Export PDF dans la version complete.
- Apercu imprimable dans le prototype.

### Paiements

- Enregistrement de paiements partiels ou complets.
- Moyen de paiement : especes, virement, cheque, mobile money, carte.
- Destination : caisse ou compte bancaire.
- Mise a jour automatique du statut facture.
- Historique des paiements par facture, client et projet.

### Caisse

- Plusieurs caisses possibles.
- Entrees et sorties.
- Solde temps reel.
- Journal de caisse.
- Cloture journaliere.
- Lien avec projet, facture ou decaissement.

### Comptes bancaires

- Plusieurs comptes bancaires.
- Affectation des paiements entrants.
- Decaissements depuis un compte bancaire.
- Solde et journal des mouvements.

### Decaissements

- Creation d'une demande de decaissement.
- Source : caisse ou banque.
- Motif, beneficiaire, projet lie, montant, date.
- Statuts : demande, valide, decaisse, annule.
- Generation d'une fiche signable par le beneficiaire et le responsable.

### Reporting

- Rapport journalier.
- Rapport mensuel.
- Rapport temps reel.
- Factures payees, partiellement payees et impayees.
- Encaissements par caisse, banque, client et projet.
- Decaissements et soldes disponibles.
- Export Excel et Word.

## 3. MVP recommande

1. Clients, projets et factures.
2. Generation d'une facture conforme au modele fourni.
3. Paiements partiels et complets.
4. Caisse et comptes bancaires.
5. Decaissements avec fiche signable.
6. Reporting avec export Excel et Word.
7. Gestion des utilisateurs et roles.
8. Multi-tenant SaaS : chaque entreprise possede son espace isole.

## 4. Roles utilisateurs

- Super administrateur SaaS : gere les tenants, abonnements et parametrages globaux.
- Administrateur entreprise : gere l'entreprise, les utilisateurs, les caisses et banques.
- Manager financier : valide les paiements, decaissements et rapports.
- Caissier : enregistre les entrees, sorties et clotures de caisse.
- Agent commercial : cree clients, projets et factures.
- Lecteur / auditeur : consulte les donnees sans modification.

## 5. Regles metier critiques

- Une facture peut creer automatiquement un projet, mais l'utilisateur doit pouvoir choisir un projet existant.
- Le statut facture depend du total des paiements confirmes.
- Un paiement doit toujours etre affecte a une destination : caisse ou compte bancaire.
- Un decaissement ne peut pas etre marque "decaisse" si la source n'a pas assez de liquidite.
- Toute entree ou sortie doit etre horodatee et attribuee a un utilisateur.
- Les exports doivent conserver les filtres appliques dans le rapport affiche.

## 6. Elements restant a fournir

- Modeles de fiche de decaissement.
- Modeles de rapports Word et Excel souhaites.
- Liste des roles exacts et droits.
- Regles fiscales : TVA, retenues, devises, mentions obligatoires.
- Processus de validation interne des decaissements.
- Identite visuelle finale : logo, couleurs, police, pied de page.
