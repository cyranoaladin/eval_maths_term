# Ce qui entre dans un artefact, et comment on le fait bouger

Une version qui se déplace n'est pas une version. Tout ce qui participe à la
construction ou au gate est désigné par une **empreinte** : actions GitHub par
empreinte de commit, images par empreinte de contenu. Le nom lisible reste en
commentaire, parce qu'une empreinte seule ne se relit pas.

## Le registre

| Entrée | Empreinte | Version lisible | Où |
|---|---|---|---|
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 | `.github/workflows/ci.yml` |
| `actions/setup-node` | `820762786026740c76f36085b0efc47a31fe5020` | v7.0.0 | idem |
| `actions/upload-artifact` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | v7.0.1 | idem |
| `docker/setup-buildx-action` | `37fe631027851001ddb9b187196cc803df7f5f0e` | v4.3.0 | idem |
| `docker/build-push-action` | `53b7df96c91f9c12dcc8a07bcb9ccacbed38856a` | v7.3.0 | idem |
| image Node de base | voir `ARG NODE_IMAGE` | node 22 bookworm-slim | `Dockerfile` |
| `mysql` | `sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb` | 8.4 | composes, scripts, recette |
| `mcr.microsoft.com/playwright` | `sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e` | v1.62.1-noble | `package.json` |
| `ghcr.io/gitleaks/gitleaks` | `sha256:71d3ee5990f2176f763b438298453fc37e87b119122045e176ca9d44ff00b08b` | v8.29.0 | `.github/workflows/ci.yml` |
| `aquasec/trivy` | `sha256:1c78ed1ef824ab8bb05b04359d186e4c1229d0b3e67005faacb54a7d71974f73` | 0.69.1 | `scripts/scan-image.sh` |
| `grafana/k6` | `sha256:5221b620a4f874faff6e32ba597aa667c058391fe4898b1c6f6377f062c6cdec` | latest au 31/08/2026 | scripts de charge |
| `auto-multiple-choice-common_1.7.0-3_all.deb` | `845c7e3e67251f1891aa2bddce5a215d38ed4a5338631e736e198f7c39a5d5d8` | 1.7.0-3 | `Dockerfile`, étape `paquets-amc` |
| `auto-multiple-choice_1.7.0-3_amd64.deb` | `04330c73434cae767c7ed27ad1e04f8d3560403f03763834899c0af810eb6c33` | 1.7.0-3 | idem |

Les deux dernières lignes ne sont pas des images mais des archives Debian,
posées par `dpkg-deb -x` dans un runtime réduit à ce que la composition utilise
réellement. Leur empreinte est vérifiée à la construction : une modification
amont fait échouer le build au lieu de passer inaperçue. Le raisonnement est
dans [AMC-RUNTIME](AMC-RUNTIME.md).

Pour relever l'empreinte d'une nouvelle version d'AMC :

```bash
version=1.7.0-3
base=http://deb.debian.org/debian/pool/main/a/auto-multiple-choice
for f in auto-multiple-choice-common_${version}_all auto-multiple-choice_${version}_amd64; do
  curl -fsSL "$base/$f.deb" | sha256sum | sed "s#-#$f.deb#"
done
```

Toute montée de version d'AMC exige de rejouer la matrice de preuve papier
(`scripts/matrice-preuve-papier.ts` puis `scripts/verifier-matrice-papier.sh`)
et la recette Docker complète.

## Faire monter une version

Rien ne monte tout seul. La procédure est la même pour une action et pour une
image :

1. Relever la nouvelle empreinte :

   ```bash
   # une action
   gh api repos/<org>/<action>/git/ref/tags/<tag> -q '.object.sha'
   # une image
   docker buildx imagetools inspect <image>:<tag> --format '{{.Manifest.Digest}}'
   ```

   `bash scripts/relever-empreintes-images.sh` fait les images d'un coup.

2. Lire ce qui change entre les deux versions — pas seulement le numéro.
3. Remplacer l'empreinte **et** le commentaire de version, dans le même commit.
4. Mettre ce tableau à jour.
5. Faire passer la CI entière. Une montée de version qui casse un gate est une
   montée de version qui attend.

## Ce que la CI refuse

`scripts/verifier-epinglage.sh` échoue si une action est désignée par
étiquette, ou si une image du gate l'est. Il est exécuté par le travail
« Sécurité ».

```
MUTABLE_CRITICAL_ACTIONS = 0
MUTABLE_RELEASE_IMAGES = 0
```

## Pourquoi pas Dependabot

Il conviendrait, et il pourra être branché : il sait proposer des empreintes.
Tant qu'il ne l'est pas, la procédure ci-dessus tient lieu de mécanisme, et le
contrôle automatique interdit qu'on l'oublie.
