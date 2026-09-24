# rr-djuikoo.com

Portfolio personnel avec assistant virtuel multi-agent (Wags) intégré. Le site présente le parcours, les projets et les certifications de son auteur.

## Fonctionnalités

- Consultation du parcours professionnel, des projets et des certifications.
- Panneau de chat interactif alimenté par une architecture multi-agent Wags (réponses streamées en NDJSON via Amazon Bedrock Claude Haiku 4.5).
- Filtrage intelligent des questions hors-sujet (_gatekeeper_) et exploration dynamique du code source des projets GitHub via un sous-agent dédié (_code explorer_).
- Rendu riche en Markdown des réponses de l'agent (titres, listes, blocs de code, tableaux) sécurisé contre les XSS via sanitization HTML (`DOMPurify`).
- Génération statique à partir d'une source de contenu unique (`src/profile.mjs`) et infrastructure as code Terraform.

## Architecture

```
Browser
  ├── CloudFront → S3 → Site statique
  └── /api/chat → Lambda (Response Stream)
                   ├── DynamoDB (Sessions & Rate Limit)
                   ├── SSM Parameter Store (Secret Turnstile)
                   ├── Cloudflare Siteverify (Validation 1er message)
                   ├── S3 (content.json - Cache TTL 5 min)
                   └── Multi-Agent Strands (Claude Haiku 4.5)
                        ├── Gatekeeper (Filtre hors-sujet)
                        ├── Orchestrateur Wags (8 outils)
                        └── Code Explorer (Sub-agent GitHub /tmp)
```

CloudFront distribue le site statique stocké sur S3 et achemine les appels `/api/*` vers une fonction Lambda URL (avec signature SigV4 OAC). Au premier message, la Lambda vérifie le défi Cloudflare Turnstile résolu par le navigateur afin de filtrer le trafic automatisé avant d'invoquer Bedrock. La Lambda exécute un système multi-agent Strands qui filtre les questions hors-sujet, consulte le profil (`content.json`) et explore le code source des projets publics sur GitHub au besoin. Des trames de maintien de connexion (`type: ping`) sont transmises toutes les 10 secondes pendant le streaming NDJSON.

## Développement local

### Prérequis

- Node.js 20 ou plus (génération du site, dépendances de l'agent et du frontend)
- Python 3 (serveur statique local et backend mock de test)
- qrencode (génération du QR code pour les tests sur réseau local)
- pre-commit (validation du code et des configurations)
- Terraform 1.15.8 (gestion de l'infrastructure AWS)

### Prise en main

```bash
make serve                   # régénère site/ puis lance le serveur sur http://localhost:8000
make mock                    # lance le site avec un backend mock simulant l'agent sur http://localhost:8002
make check                   # exécute la suite de tests locaux (outils, repo, câblage, sans appel AWS)
make eval                    # exécute le banc d'essai de l'agent contre Amazon Bedrock
pre-commit install           # installe les hooks de contrôle local
pre-commit run --all-files   # exécute tous les vérificateurs (linter, formatage, sécurité, vendor)
```

Pour gérer l'infrastructure Terraform, créez d'abord votre fichier d'environnement :

```bash
cp .env.example .env
# Éditez .env pour spécifier votre adresse email d'alerte budgétaire
```

Provisionnez ensuite le secret Cloudflare Turnstile dans AWS SSM Parameter Store. Une étape manuelle unique et indépendante de `.env`, puisque ce secret ne doit jamais transiter par Terraform (voir [docs/infrastructure.md](docs/infrastructure.md)). Consultez la [documentation Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/get-started/) pour générer les clés, puis exécutez directement dans votre terminal :

```bash
aws ssm put-parameter \
  --name "/rr-djuikoo/turnstile-secret-key" \
  --value "VOTRE_SECRET_CLOUDFLARE" \
  --type "SecureString" \
  --overwrite
```

Cloudflare n'affiche cette clé secrète qu'une seule fois, à sa création : une fois la commande exécutée, elle ne vivra que dans SSM.

Lancez enfin le plan et l'application Terraform :

```bash
source .env && make plan     # prépare les dépendances Node.js et génère le plan Terraform
source .env && make apply    # applique le plan validé
```

## Gestion du contenu & Personnalisation

```
src/profile.mjs
  ├─► site/index.html   (Génération statique HTML)
  └─► site/content.json ─► S3 ─► Lambda / Wags (Base de connaissances)
```

Pour personnaliser le portfolio avec vos propres informations :

1. **Éditer `src/profile.mjs`** : Ce fichier constitue la **source unique de vérité**. Mettez à jour vos données personnelles (identité, biographie, liens de contact, projets GitHub, expériences professionnelles, diplômes et certifications).
2. **Régénérer les artefacts** : Exécutez `make build` (ou `node scripts/build-site.mjs`). Cela met à jour à la fois `site/index.html` pour l'affichage web et `site/content.json` pour l'agent IA.
3. **Mise à jour en production** : Lors du déploiement (ou de la synchronisation de `site/content.json` sur S3), l'agent Wags prend automatiquement en compte vos nouvelles informations en cinq minutes au plus (durée maximale du cache TTL mémoire de la Lambda, une instance froide lisant la nouvelle version immédiatement), **sans aucun redéploiement d'infrastructure** (`terraform apply` non nécessaire pour une simple mise à jour de contenu).

Les artefacts générés dans `site/` sont committés dans le dépôt git mais ne doivent jamais être édités à la main.

## Documentation complémentaire

- [SECURITY.md](SECURITY.md) : politique et contrôles de sécurité
- [docs/architecture.md](docs/architecture.md) : architecture technique détaillée et fonctionnement multi-agent
- [docs/deployment.md](docs/deployment.md) : chaîne CI/CD et procédure de déploiement
- [docs/infrastructure.md](docs/infrastructure.md) : infrastructure Terraform, supervision et suivi budgétaire

Le site est déployé automatiquement sur `main` via GitHub Actions après validation des contrôles de sécurité. L'infrastructure AWS est gérée séparément avec Terraform.

## Licence

À définir.
