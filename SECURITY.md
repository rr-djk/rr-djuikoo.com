# Politique de sécurité

## Contrôles de sécurité en place

Le projet intègre plusieurs niveaux de vérification automatique et de durcissement :

### Analyses automatisées (CI/CD)

Le workflow `.github/workflows/security-scan.yml` s'exécute sur chaque pull request vers `main` :

- **Trivy** : analyse des dépendances, échec sur les sévérités `HIGH` et `CRITICAL`.
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

## Exceptions de sécurité

Les exceptions d'analyse Checkov pour l'infrastructure Terraform (par exemple le mode mono-région ou le ciblage des journaux) sont documentées et justifiées dans le fichier `.checkov.yml` à la racine du dépôt.
