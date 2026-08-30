/**
 * api/lib/readiness.ts
 *
 * Deux questions différentes, longtemps confondues en une seule.
 *
 * « Le processus est-il vivant ? » — c'est ce que demande un orchestrateur pour
 * savoir s'il doit le redémarrer. La réponse ne doit dépendre de rien
 * d'extérieur : une base momentanément injoignable ne justifie pas de tuer un
 * serveur qui, lui, fonctionne.
 *
 * « Le service peut-il prendre du trafic ? » — c'est ce que demande un
 * répartiteur avant de lui envoyer des élèves. Là, tout compte : la base, le
 * schéma, le pool, le disque où s'écrivent les sujets, et l'outil d'impression.
 *
 * `/api/health` répondait à la première en laissant croire qu'il répondait à la
 * seconde : il rendait « ok » alors même que la base était tombée. Un
 * déploiement pouvait ainsi être déclaré sain et servir des erreurs.
 *
 * Aucune de ces réponses ne contient de secret : ni adresse de base, ni
 * identifiant, ni chemin absolu. On y lit ce qui va et ce qui ne va pas.
 */
import { access, constants, mkdir, statfs } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { getDb, getPool } from "../queries/connection";
import { isAmcAvailable } from "../paper/amc-runner";
import { paperRoot } from "../paper/paper-service";
import { env } from "./env";
import { EMPREINTE_GIT, VERSION_APPLICATION } from "./version";

export type EtatControle = "ok" | "degrade" | "hs";

export interface Controle {
  nom: string;
  etat: EtatControle;
  detail: string;
  /** Durée du contrôle, en millisecondes. */
  dureeMs: number;
}

export interface Disponibilite {
  pret: boolean;
  version: string;
  gitSha: string;
  controles: Controle[];
}

/** Espace disque minimal pour accepter du trafic : un tirage pèse quelques Mo. */
const DISQUE_MINIMAL_OCTETS = 200 * 1024 * 1024;

async function mesurer(
  nom: string,
  sonde: () => Promise<Omit<Controle, "nom" | "dureeMs">>,
): Promise<Controle> {
  const depart = Date.now();
  try {
    const r = await sonde();
    return { nom, ...r, dureeMs: Date.now() - depart };
  } catch (e) {
    return {
      nom,
      etat: "hs",
      // Le message d'une erreur de pilote peut contenir l'adresse de la base,
      // et celui d'une erreur de système de fichiers un chemin absolu : on ne
      // garde que le code, qui dit ce qui ne va pas sans dire où.
      detail: codeDErreur(e),
      dureeMs: Date.now() - depart,
    };
  }
}

/**
 * Ce qu'on peut dire d'une erreur sans en divulguer le contexte.
 *
 * « Error » ne renseignait personne. Le code — `ENOENT`, `EACCES`,
 * `ER_ACCESS_DENIED_ERROR` — dit ce qui ne va pas, et rien d'autre.
 */
export function codeDErreur(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  if (typeof code === "string" && code !== "") return code;
  return e instanceof Error ? e.name : "erreur inconnue";
}

async function baseDeDonnees(): Promise<Omit<Controle, "nom" | "dureeMs">> {
  await getDb().execute(sql`select 1`);
  return { etat: "ok", detail: "la base répond" };
}

/**
 * Le schéma attendu est-il là ?
 *
 * Un serveur qui démarre sur une base dont les migrations n'ont pas été
 * appliquées répond à tout, et échoue à la première écriture. Le journal des
 * migrations de Drizzle dit combien ont été appliquées.
 */
async function schema(): Promise<Omit<Controle, "nom" | "dureeMs">> {
  const [lignes] = (await getPool().query(
    "select count(*) as n from information_schema.tables where table_schema = database()",
  )) as unknown as [Array<{ n: number }>];
  const tables = Number(lignes[0]?.n ?? 0);

  const [journal] = (await getPool().query(
    "select count(*) as n from information_schema.tables " +
      "where table_schema = database() and table_name = '__drizzle_migrations'",
  )) as unknown as [Array<{ n: number }>];

  if (Number(journal[0]?.n ?? 0) === 0) {
    return {
      etat: "hs",
      detail: "aucun journal de migrations : la base n'a jamais été migrée",
    };
  }
  const [appliquees] = (await getPool().query(
    "select count(*) as n from `__drizzle_migrations`",
  )) as unknown as [Array<{ n: number }>];

  return {
    etat: tables >= 13 ? "ok" : "hs",
    detail: `${tables} tables, ${Number(appliquees[0]?.n ?? 0)} migration(s) appliquée(s)`,
  };
}

/**
 * Le pool a-t-il encore des connexions à donner ?
 *
 * Saturé, il ne rend pas d'erreur : il fait attendre. Un service qui fait
 * attendre indéfiniment est indisponible sans le dire.
 */
async function pool(): Promise<Omit<Controle, "nom" | "dureeMs">> {
  const depart = Date.now();
  const connexion = await getPool().getConnection();
  const attente = Date.now() - depart;
  connexion.release();
  return {
    etat: attente < 1_000 ? "ok" : "degrade",
    detail: `connexion obtenue en ${attente} ms sur ${env.dbPoolSize} disponibles`,
  };
}

/**
 * Le dossier des tirages est-il écrivable ? Sans lui, aucun sujet n'est imprimé.
 *
 * On le crée s'il manque : c'est le dossier de l'application, elle le crée de
 * toute façon au premier tirage. Le contrôle échouait sur son absence, si bien
 * qu'un déploiement neuf — ou un volume monté par-dessus — restait
 * indisponible pour toujours, sans que rien n'ait de raison de le réparer.
 */
async function dossierDesTirages(): Promise<Omit<Controle, "nom" | "dureeMs">> {
  const racine = paperRoot();
  await mkdir(racine, { recursive: true });
  await access(racine, constants.W_OK);
  return { etat: "ok", detail: "accessible en écriture" };
}

async function espaceDisque(): Promise<Omit<Controle, "nom" | "dureeMs">> {
  const stats = await statfs(paperRoot());
  const libre = stats.bsize * stats.bavail;
  const libreMo = Math.round(libre / (1024 * 1024));
  return {
    etat: libre >= DISQUE_MINIMAL_OCTETS ? "ok" : "hs",
    detail: `${libreMo} Mo disponibles`,
  };
}

/**
 * L'impression est-elle possible ?
 *
 * Son absence ne rend pas le service indisponible : une évaluation en ligne
 * fonctionne sans elle, et l'interface le signale au lieu d'échouer. C'est un
 * état dégradé, pas une panne.
 */
async function impression(): Promise<Omit<Controle, "nom" | "dureeMs">> {
  const dispo = await isAmcAvailable();
  return dispo
    ? { etat: "ok", detail: "auto-multiple-choice est installé" }
    : {
        etat: "degrade",
        detail: "auto-multiple-choice absent : l'impression des sujets est indisponible",
      };
}

export async function evaluerDisponibilite(): Promise<Disponibilite> {
  const controles = await Promise.all([
    mesurer("base", baseDeDonnees),
    mesurer("schema", schema),
    mesurer("pool", pool),
    mesurer("tirages", dossierDesTirages),
    mesurer("disque", espaceDisque),
    mesurer("impression", impression),
  ]);

  return {
    pret: controles.every((c) => c.etat !== "hs"),
    version: VERSION_APPLICATION,
    gitSha: EMPREINTE_GIT,
    controles,
  };
}
