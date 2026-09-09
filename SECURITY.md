# Politique de sécurité

## Contrôles de sécurité en place

Le projet intègre plusieurs niveaux de vérification automatique et de durcissement :

### Analyses automatisées (CI/CD)

Le workflow `.github/workflows/security-scan.yml` s'exécute sur chaque pull request vers `main` :

- **Trivy** : analyse des dépendances déclarées de l'agent Lambda (`agent/package-lock.json`) et du site (`package-lock.json`), échec sur les sévérités `HIGH` et `CRITICAL`.
- **Semgrep** : analyse statique du code (SAST) avec les règles CI standard (`p/ci`).
- **Gitleaks** : détection de secrets et jetons d'accès dans l'historique et le code.
- **Checkov** : analyse de sécurité du code d'infrastructure Terraform (`terraform/`).

### Durcissement des workflows

- **Principe du moindre privilège** : `permissions: {}` défini par défaut à l'échelle des workflows.
- **Épinglage par SHA** : toutes les actions GitHub utilisent des commits SHA immuables.
- **Surveillance de l'exécuteur** : utilisation de `step-security/harden-runner` en mode audit.

### Déploiement et infrastructure

- **OIDC AWS** : aucun secret ni clé AWS à longue durée de vie stocké dans GitHub.
- **Attestation de provenance** : génération d'un manifeste SHA256 et vérification par GitHub Attestations avant déploiement.
- **Exposition S3 et Lambda** : le bucket S3 du site n'est pas public. La Lambda et le bucket S3 sont restreints par Origin Access Control (OAC) via CloudFront.

### Sécurité du Frontend et des Dépendances

- **Sanitization XSS dans le Chat** : Tout le contenu généré par l'assistant virtuel au format Markdown est passé au crible de `DOMPurify` avant insertion dans le DOM. Les balises à risque (ex: `<iframe>`, `<script>`, `<img>`) sont éliminées, et les liens externes sont contraints avec `rel="noopener noreferrer"`.
- **Garantie d'intégrité Vendor** : Les dépendances navigateur (`marked`, `DOMPurify`) sont déclarées dans `package.json` et synchronisées dans `site/js/vendor/` via `make vendor`. Trivy n'analysant que les manifestes et jamais les fichiers `.js` réellement servis, deux garde-fous complémentaires garantissent que les octets exécutés par le navigateur correspondent au lockfile audité : le hook pre-commit `vendor-deps` rejette les commits locaux qui dérivent, et une étape du workflow `security-scan.yml` rejette les pull requests et les push sur `main`, y compris ceux créés par API sans passer par pre-commit.

## Exceptions de sécurité

Les exceptions d'analyse Checkov pour l'infrastructure Terraform (par exemple le mode mono-région ou le ciblage des journaux) sont documentées et justifiées dans le fichier `.checkov.yml` à la racine du dépôt.
