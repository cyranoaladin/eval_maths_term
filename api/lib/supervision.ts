/**
 * api/lib/supervision.ts
 *
 * Où partent les erreurs quand personne ne regarde le terminal.
 *
 * `SENTRY_DSN` figurait dans le contrat de configuration depuis le début, et
 * n'était lu nulle part : une erreur de production s'écrivait sur la sortie
 * standard du conteneur et n'allait pas plus loin. Un enseignant qui signale
 * « ça ne marche pas » un lundi matin ne laisse rien d'autre derrière lui.
 *
 * Ce qui part, et ce qui ne part jamais.
 *
 * Une copie d'élève est une donnée scolaire : nom, réponses, notes, incidents
 * de surveillance. Rien de tout cela n'a sa place chez un tiers. Un jeton de
 * session non plus — le transmettre reviendrait à donner l'accès avec le
 * rapport. On envoie donc l'erreur, sa pile, la route, et l'identifiant de
 * requête qui permet de retrouver la ligne correspondante dans les journaux du
 * serveur. Le reste est retiré avant l'envoi, pas filtré à l'arrivée.
 */
import * as Sentry from "@sentry/node";
import { env } from "./env";
import { EMPREINTE_GIT, VERSION_APPLICATION } from "./version";

/**
 * Clés dont la valeur ne doit jamais quitter le serveur.
 *
 * `session` n'y figure pas seul : `sessionId` est un entier qui ne désigne
 * personne, et c'est souvent la seule chose qui permette de relier un rapport à
 * une copie. `sessionToken`, lui, est déjà pris par `token`.
 */
const CLES_INTERDITES =
  /(token|secret|password|passwd|cookie|authorization|bearer|credential|dsn|api[-_]?key)/i;

/**
 * Champs qui portent une donnée scolaire. Le nom d'un élève n'est pas un
 * identifiant technique : il désigne une personne mineure.
 */
const CLES_SCOLAIRES =
  /(studentname|student_name|lastname|firstname|answer|justification|email|ipaddress|fingerprint)/i;

const REMPLACEMENT = "[retiré]";

/** Ce qui ressemble à un jeton, où qu'il se trouve dans une chaîne. */
const JETON_DANS_UN_TEXTE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
/** Une URL de connexion porte l'utilisateur et le mot de passe. */
const URL_AVEC_IDENTIFIANTS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi;

export function nettoyerTexte(texte: string): string {
  return texte
    .replace(JETON_DANS_UN_TEXTE, REMPLACEMENT)
    .replace(URL_AVEC_IDENTIFIANTS, (m) => `${m.split("://")[0]}://${REMPLACEMENT}@`);
}

/**
 * Retire d'un objet tout ce qui ne doit pas sortir, en profondeur.
 *
 * On ne se contente pas de masquer les clés connues : le texte lui-même est
 * relu, parce qu'un jeton se retrouve aussi bien dans un message d'erreur que
 * dans un champ nommé « token ».
 */
export function nettoyerValeur(valeur: unknown, profondeur = 0): unknown {
  if (profondeur > 8) return REMPLACEMENT;
  if (typeof valeur === "string") return nettoyerTexte(valeur);
  if (Array.isArray(valeur)) return valeur.map((v) => nettoyerValeur(v, profondeur + 1));
  if (valeur && typeof valeur === "object") {
    const sortie: Record<string, unknown> = {};
    for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
      if (CLES_INTERDITES.test(cle) || CLES_SCOLAIRES.test(cle)) {
        sortie[cle] = REMPLACEMENT;
        continue;
      }
      sortie[cle] = nettoyerValeur(v, profondeur + 1);
    }
    return sortie;
  }
  return valeur;
}

/** Prépare un événement pour l'envoi, ou l'abandonne. */
export function nettoyerEvenement(evenement: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  const nettoye = { ...evenement };

  // Le corps d'une requête contient les réponses de l'élève ; les en-têtes,
  // son jeton. Ni l'un ni l'autre n'aide à diagnostiquer.
  if (nettoye.request) {
    nettoye.request = {
      method: nettoye.request.method,
      url: nettoye.request.url ? nettoyerTexte(nettoye.request.url) : undefined,
    };
  }
  delete nettoye.user;
  delete nettoye.breadcrumbs;

  if (nettoye.extra) nettoye.extra = nettoyerValeur(nettoye.extra) as typeof nettoye.extra;
  if (nettoye.contexts) {
    nettoye.contexts = nettoyerValeur(nettoye.contexts) as typeof nettoye.contexts;
  }
  if (nettoye.tags) nettoye.tags = nettoyerValeur(nettoye.tags) as typeof nettoye.tags;
  if (nettoye.message) nettoye.message = nettoyerTexte(nettoye.message);
  if (nettoye.exception?.values) {
    nettoye.exception = {
      ...nettoye.exception,
      values: nettoye.exception.values.map((v) => ({
        ...v,
        value: v.value ? nettoyerTexte(v.value) : v.value,
      })),
    };
  }

  return nettoye;
}

let active = false;

/** Vrai si les erreurs partent réellement quelque part. */
export function supervisionActive(): boolean {
  return active;
}

/**
 * Branche la supervision, si une destination est configurée.
 *
 * Sans `SENTRY_DSN`, rien n'est envoyé et rien n'échoue : le journal structuré
 * reste la seule trace, ce qui est le cas d'un déploiement isolé.
 */
export function initialiserSupervision(): void {
  if (active || !env.sentryDsn) return;

  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    release: `${VERSION_APPLICATION}+${EMPREINTE_GIT}`,
    // Aucune donnée personnelle par défaut : adresse IP, en-têtes, corps.
    sendDefaultPii: false,
    // Pas de traces de performance : elles porteraient les mêmes données, pour
    // un besoin que le journal couvre déjà.
    tracesSampleRate: 0,
    beforeSend: (evenement) => nettoyerEvenement(evenement),
  });
  active = true;
}

/** Transmet une erreur à la supervision. Sans destination, ne fait rien. */
export function signalerErreur(
  message: string,
  donnees?: Record<string, unknown>,
): void {
  if (!active) return;
  Sentry.captureMessage(message, {
    level: "error",
    extra: donnees ? (nettoyerValeur(donnees) as Record<string, unknown>) : undefined,
  });
}

/** Vide la file d'envoi. À appeler avant de s'arrêter. */
export async function viderLaFileDeSupervision(delaiMs = 2_000): Promise<void> {
  if (!active) return;
  await Sentry.flush(delaiMs);
}
