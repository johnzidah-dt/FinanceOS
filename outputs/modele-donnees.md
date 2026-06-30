# Modele de donnees initial

## Entites principales

### Tenant

Represente une entreprise cliente du SaaS.

- id
- nom
- domaine
- statut_abonnement
- devise_par_defaut
- created_at

### Utilisateur

- id
- tenant_id
- nom
- email
- role
- statut
- created_at

### Client

- id
- tenant_id
- nom
- adresse
- telephone
- email
- identifiant_fiscal
- created_at

### Projet

- id
- tenant_id
- client_id
- nom
- type : projet ou evenement
- statut
- date_debut
- date_fin
- budget_prevu
- created_from_invoice_id
- created_at

### Facture

- id
- tenant_id
- client_id
- projet_id
- numero
- reference_interne
- date_facture
- date_echeance
- objet
- devise
- montant_ht
- montant_ttc
- montant_paye
- reste_a_payer
- statut
- created_by
- created_at

### SectionFacture

- id
- facture_id
- titre
- ordre

### LigneFacture

- id
- facture_id
- section_id
- reference
- designation
- prix_unitaire
- quantite
- type_quantite : nombre ou forfait
- total_ligne
- ordre

### Paiement

- id
- tenant_id
- facture_id
- projet_id
- client_id
- montant
- date_paiement
- moyen
- destination_type : caisse ou banque
- destination_id
- statut
- reference_transaction
- created_by
- created_at

### Caisse

- id
- tenant_id
- nom
- devise
- solde_initial
- solde_courant
- statut

### CompteBancaire

- id
- tenant_id
- banque
- intitule
- numero_compte
- devise
- solde_courant
- statut

### MouvementTresorerie

- id
- tenant_id
- source_type
- source_id
- destination_type
- destination_id
- sens : entree ou sortie
- montant
- motif
- projet_id
- facture_id
- paiement_id
- decaissement_id
- date_mouvement
- created_by

### Decaissement

- id
- tenant_id
- projet_id
- beneficiaire
- motif
- montant
- source_type : caisse ou banque
- source_id
- statut
- demande_par
- valide_par
- date_demande
- date_validation
- date_decaissement
- signature_beneficiaire_url
- piece_jointe_url

### RapportGenere

- id
- tenant_id
- type_rapport
- periode_debut
- periode_fin
- format : excel, word, pdf
- fichier_url
- genere_par
- created_at

## Relations importantes

- Un tenant possede ses clients, utilisateurs, projets, caisses, banques et factures.
- Une facture appartient a un client et peut appartenir a un projet.
- Une facture contient plusieurs sections, chaque section contient plusieurs lignes.
- Un paiement appartient a une facture et alimente une caisse ou un compte bancaire.
- Un projet regroupe factures, paiements, mouvements et decaissements.
- Un decaissement genere un mouvement de sortie depuis une caisse ou une banque.

## Index recommandes

- tenant_id sur toutes les tables metier.
- numero de facture unique par tenant.
- facture_id sur paiements et lignes de facture.
- projet_id sur factures, paiements, mouvements et decaissements.
- date_facture, date_paiement, date_mouvement pour les rapports.
