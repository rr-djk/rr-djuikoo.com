# rr-djuikoo.com

Portfolio personnel avec assistant virtuel intégré (agent Wags). Le site présente le parcours, les projets et les certifications de son auteur.

## Fonctionnalités

- Consultation du parcours professionnel, des projets et des certifications.
- Panneau de chat interactif alimenté par l'agent Wags (réponses en streaming via Amazon Bedrock).
- Génération statique à partir d'une source de contenu unique et infrastructure as code.

## Architecture

```
Browser
  ├── CloudFront → S3 → site statique
  └── /api → Lambda → S3 (content.json) → Bedrock
```

CloudFront distribue le site statique stocké sur S3 et achemine les appels `/api/*` vers une fonction Lambda. La Lambda lit les données du profil dans S3 (`content.json`) et consulte Amazon Bedrock pour générer les réponses.

## Développement local

### Prérequis

- Node.js (génération du site et dépendances de l'agent)
- Python 3 (serveur statique local)
- pre-commit (validation du code et des configurations)
- Terraform 1.15.8 (gestion de l'infrastructure AWS)

### Prise en main

```bash
make serve                   # régénère site/ puis lance le serveur sur http://localhost:8000
pre-commit install           # installe les hooks de contrôle local
pre-commit run --all-files   # exécute tous les vérificateurs (linter, formatage, sécurité)
```

Pour l'infrastructure, les commandes `make plan` et `make apply` permettent d'inspecter et de déployer les ressources AWS.

## Gestion du contenu

```
src/profile.mjs
  ├─► site/index.html
  └─► site/content.json ─► S3 ─► Lambda / Wags
```

Le fichier `src/profile.mjs` constitue la source unique de vérité. La commande `make build` régénère `site/index.html` (pour le navigateur) et `site/content.json` (lu par la Lambda sur S3). Les artefacts générés sous `site/` sont committés mais ne doivent pas être modifiés directement.

## Documentation complémentaire

- [SECURITY.md](SECURITY.md) : politique et contrôles de sécurité
- [docs/architecture.md](docs/architecture.md) : architecture technique détaillée
- [docs/deployment.md](docs/deployment.md) : chaîne CI/CD et procédure de déploiement
- [docs/infrastructure.md](docs/infrastructure.md) : infrastructure Terraform et spécificités AWS

Le site est déployé automatiquement sur `main` après validation des contrôles de sécurité. L'infrastructure AWS est gérée séparément avec Terraform.

## Licence

À définir.
