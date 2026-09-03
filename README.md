# rr-djuikoo.com

Portfolio personnel avec panneau chat (agent **Wags**). Le site présente parcours, projets et certifications; le chat répond via une Lambda AWS + Bedrock.

> **État** : site en production derrière CloudFront, chat branché sur une Lambda
> en streaming vers Bedrock, déploiement du site automatisé après les analyses de
> sécurité. L'infrastructure Terraform est appliquée manuellement.

## Prérequis

- **Node.js**, pour le générateur et pour l'agent
- **Python 3**, pour le serveur statique local
- [pre-commit](https://pre-commit.com/), pour les hooks qualité et sécurité
- Pour toucher à l'infrastructure : **Terraform 1.15.8**, AWS CLI, TFLint

## Démarrage local

```bash
make serve                   # régénère site/ puis le sert sur :8000
pre-commit install           # active les hooks au commit
pre-commit run --all-files   # prettier, gitleaks, terraform fmt/validate/tflint, build-site
```

Sans backend local, le panneau de chat affiche `[Namespace] Error calling the agent.`;
c'est le comportement attendu. Le détail (statut HTTP, corps de la réponse) est
écrit dans la console du navigateur, de quoi distinguer ce cas d'une vraie panne.

```bash
make agent-deps               # installe les deps de l'agent (no-op si deja a jour)
make plan                     # agent-deps puis terraform plan -out=tfplan
make apply                    # terraform apply tfplan
```

Le paquet Lambda embarque `node_modules` : les dépendances doivent être présentes
et à jour au moment du `terraform plan`, sinon l'archive part sans elles et la
fonction échoue à l'initialisation, renvoyant ce même message en production.
`make plan` s'en charge, et une `precondition` Terraform fait échouer le plan
plutôt que de construire une archive amputée.

## Architecture

Région `us-east-1`. Le bucket du site n'est jamais public, et la Lambda n'a le
droit de lire qu'un seul objet, `content.json`. Réponses diffusées en NDJSON.

## Gestion du contenu

Le contenu est nécessaire dans la page HTML **et** dans le runtime de l'agent.
Le dupliquer garantit qu'il divergera, l'embarquer dans le paquet Lambda impose
un `terraform apply` à chaque correction de texte. D'où une source unique et
deux artefacts générés :

```
src/profile.mjs ----------+
                          |--> scripts/build-site.mjs --> site/index.html   (navigateurs, crawlers)
src/index.template.html --+                          \--> site/content.json (lu depuis S3 par la Lambda)
```

- `src/` n'est jamais déployé; `site/index.html` et `site/content.json` sont des
  artefacts committés qui ne s'éditent **jamais** à la main.
- `make build` régénère les deux. `make serve` en dépend, puis sert `site/` sur
  http://localhost:8000.
- Le hook pre-commit `build-site` rejoue le générateur et fait échouer le commit
  si la sortie diffère : la dérive source/artefact est incommittable.
- `content.json` part vers S3 avec le reste du site et est lu au runtime par
  `agent/content.mjs` (cache 5 min), qui alimente les tools de l'agent à chaque
  invocation. Éditer `src/profile.mjs` met donc à jour la page et **Wags** en même
  temps, **sans `terraform apply`**.
- Tout ce qui entre dans `profile.mjs` est publié : `content.json` est servi
  publiquement. Aucune donnée privée ne doit y figurer.

## CI/CD et sécurité

Deux workflows, `permissions: {}` par défaut et actions épinglées par SHA.

**`Security Scan`** (PR et push sur `main`) : Trivy avec gate `HIGH/CRITICAL`,
Semgrep, Gitleaks, et Checkov sur `terraform/**`.

**`Deploy Site`** ne démarre qu'après un `Security Scan` réussi sur `main`, sur
le SHA exact qui a été scanné : archive attestée puis revérifiée avant envoi,
sync vers S3, comparaison des empreintes, invalidation CloudFront. Accès AWS par
OIDC, aucun secret de longue durée. L'infrastructure, elle, reste appliquée à la
main en local.

## Licence

À définir.
