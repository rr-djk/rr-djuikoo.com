# Pipeline CI/CD et déploiement

Ce document détaille l'automatisation de l'intégration continue, des analyses de sécurité et du déploiement du site.

## Vue d'ensemble

Le projet utilise deux workflows GitHub Actions interconnectés :

1. **Security Scan** : vérifie la conformité, la sécurité du code et de l'infrastructure sur chaque PR et push sur `main`.
2. **Deploy Site** : s'exécute automatiquement après le succès de Security Scan sur `main` pour déployer le site statique sur AWS.

L'infrastructure AWS (Terraform) est volontairement exclue de la chaîne de déploiement automatique et reste gérée manuellement.

## Workflow 1 : Security Scan (`security-scan.yml`)

Ce workflow s'exécute avec des permissions réinitialisées (`permissions: {}`) et des actions épinglées par SHA de commit.

### Jobs d'analyse

- **Trivy (`sca`)** :
  - Analyse les vulnérabilités dans les dépendances de l'agent (`agent/package-lock.json`) et du frontend (`package-lock.json`). Échoue en cas de sévérité `HIGH` ou `CRITICAL`. Génère un rapport SARIF complet.
  - **Vérification de l'alignement Vendor** : Exécute une étape vérifiant que les bibliothèques JS exécutées par le navigateur dans `site/js/vendor/` correspondent exactement au fichier `package-lock.json` audité par Trivy (`npm ci && npm run vendor && git diff --exit-code site/js/vendor/`). Cela prévient tout décalage en cas de mise à jour des dépendances, y compris pour une pull request créée par API sans passer par les hooks pre-commit, comme le ferait Dependabot s'il était activé sur ce dépôt.
- **Semgrep (`sast`)** : exécute une analyse statique de code avec le jeu de règles `p/ci` (version 1.172.0).
- **Gitleaks (`secrets`)** : analyse l'historique git pour détecter d'éventuels jetons, clés ou mots de passe.
- **Checkov (`iac`)** : analyse les fichiers Terraform du dossier `terraform/`. Se déclenche uniquement si des fichiers d'infrastructure ont été modifiés (`dorny/paths-filter`).

## Workflow 2 : Deploy Site (`deploy-site.yml`)

Ce workflow s'exécute uniquement si `Security Scan` a réussi sur la branche `main`.

### Étapes de déploiement

1. **Isolation du commit** : extrait exactement le SHA du commit ayant réussi les analyses de sécurité.
2. **Détection de changement** : vérifie si des fichiers du dossier `site/` ont été modifiés.
3. **Archive déterministe et manifeste** :
   - Construit une archive tarball déterministe `site.tar.gz` avec un horodatage fixe.
   - Génère `manifest.sha256` contenant les empreintes SHA-256 de chaque fichier.
4. **Attestation de provenance** :
   - Crée une attestation de build signée via `actions/attest`.
   - Vérifie immédiatement l'attestation avec `gh attestation verify --deny-self-hosted-runners`.
5. **Connexion AWS (OIDC)** : s'authentifie auprès d'AWS sans secret permanent, via un rôle IAM assumé temporairement (`AWS_DEPLOY_ROLE_ARN`).
6. **Synchronisation S3** :
   - Envoie les fichiers statiques (images, CSS, JS) avec un en-tête `Cache-Control: public, max-age=3600`.
   - Envoie `index.html` séparément avec un en-tête `Cache-Control: no-cache, no-store, must-revalidate`.
   - Supprime les anciens fichiers absents de la nouvelle build (`--delete`).
7. **Vérification d'intégrité S3** : compare l'empreinte ETag/MD5 de chaque objet S3 téléversé avec les valeurs du manifeste local.
8. **Invalidation du cache** : déclenche une invalidation CloudFront sur la trajectoire `/*` et attend sa confirmation.

## Gestion de l'infrastructure

L'infrastructure AWS (fichiers `.tf` sous `terraform/`) est appliquée exclusivement depuis un poste de travail autorisé :

```bash
make agent-deps   # prépare les dépendances Node.js du paquet Lambda
make plan         # génère le plan Terraform (tfplan)
make apply        # applique le plan validé
```

Le processus de déploiement garantit que le paquet Lambda embarque l'ensemble de ses dépendances d'exécution (`node_modules`) avant toute mise à jour du code.
