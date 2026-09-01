/**
 * Saturation de la file du pool MySQL — P18.
 *
 * La file d'attente du pool est bornée (`DB_QUEUE_LIMIT`) : « il vaut mieux
 * attendre que perdre une copie » est vrai, « donc file infinie » ne l'est
 * pas. Ce test rejoue la saturation en petit — un pool d'une connexion, une
 * file de deux — et exige le comportement du contrat :
 *
 *   - une requête engagée dans la file n'est jamais abandonnée : elle attend
 *     sa connexion et aboutit ;
 *   - au plafond, le refus est un `503` avec `Retry-After`, jamais un `500` ;
 *   - une remise refusée puis rejouée aboutit sans double note ;
 *   - le pic de file est mesurable (`pool_queue_peak`), pour l'endurance.
 *
 * Les variables d'environnement sont posées AVANT tout import applicatif :
 * `env.ts` est parsé au chargement, et le pool naît de lui.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

process.env.DB_POOL_SIZE = "1";
process.env.DB_QUEUE_LIMIT = "2";

type Harnais = typeof import("./harnais");
type Connexion = typeof import("../../queries/connection");

let harnais: Harnais;
let connexion: Connexion;
let app: typeof import("../../boot").default;
let signSessionToken: typeof import("../../kimi/session").signSessionToken;

let prof: import("@db/schema").User;
let cookieProf: string;
let evaluationId: number;

const ORIGINE = "http://localhost:3000";

beforeAll(async () => {
  // Imports dynamiques : après la pose des variables d'environnement.
  connexion = await import("../../queries/connection");
  harnais = await import("./harnais");
  app = (await import("../../boot")).default;
  ({ signSessionToken } = await import("../../kimi/session"));

  prof = await harnais.creerEnseignant("Enseignant saturation");
  cookieProf = await signSessionToken({ unionId: prof.unionId, clientId: "test" });
  const ev = await harnais.creerEvaluation(prof, "Saturation");
  evaluationId = ev.evaluationId;
});

afterAll(async () => {
  await harnais.nettoyer([evaluationId], [prof.id]);
});

/**
 * Occupe l'unique connexion du pool, et remplit la file jusqu'à sa borne.
 * Rend une fonction qui relâche tout.
 */
async function saturerLePool() {
  const pool = connexion.getPool();
  // L'unique connexion du pool, tenue.
  const tenue = await pool.getConnection();
  // La file (2 places), remplie par deux acquisitions en attente.
  const enAttente = [pool.getConnection(), pool.getConnection()];
  // Laisse le pilote enregistrer les mises en file.
  await new Promise((r) => setTimeout(r, 50));
  return {
    relacher: async () => {
      // Séquentiel, nécessairement : il n'existe qu'une connexion. La
      // première attente la reçoit et la rend, puis la seconde.
      tenue.release();
      for (const attente of enAttente) (await attente).release();
    },
  };
}

describe("la file du pool est bornée, et le plafond se comporte", () => {
  it("refuse au plafond par un 503 Retry-After, jamais un 500, et sert ce qui est engagé", async () => {
    const { relacher } = await saturerLePool();

    // Pool plein, file pleine : la requête HTTP ne peut pas s'y asseoir.
    const refusee = await app.request(`${ORIGINE}/api/trpc/paper.listClasses`, {
      headers: { cookie: `kimi_sid=${cookieProf}` },
    });

    expect(refusee.status).toBe(503);
    expect(refusee.headers.get("Retry-After")).toBe("5");

    // La file se vide : les acquisitions engagées aboutissent — aucune
    // n'est abandonnée — et le service redevient disponible.
    await relacher();

    const rejouee = await app.request(`${ORIGINE}/api/trpc/paper.listClasses`, {
      headers: { cookie: `kimi_sid=${cookieProf}` },
    });
    expect(rejouee.status).toBe(200);
  });

  it("mesure le pic de la file : c'est lui qui calibre la borne", async () => {
    connexion.remettreAZeroFilePool();
    const { relacher } = await saturerLePool();
    const { profondeur, pic } = connexion.lireFilePool();
    expect(profondeur).toBe(2);
    expect(pic).toBe(2);
    await relacher();
    expect(connexion.lireFilePool().profondeur).toBe(0);
  });

  it("une remise refusée par saturation se rejoue sans double note", async () => {
    const { jeton, sessionId } = await harnais.ouvrirSession(
      evaluationId,
      harnais.unique("Sature"),
    );
    const eleve = harnais.appelEleve(jeton);
    const qs = await eleve.question.getForActiveSession();
    const reponses = qs
      .filter((q) => q.type === "qcm" || q.type === "true_false")
      .map((q) => ({
        questionId: q.id,
        answer: q.type === "qcm" ? "0" : "false",
      }));

    const { relacher } = await saturerLePool();
    const echec: unknown = await eleve.session
      .submit({ answers: reponses, timeSpent: 60 })
      .then(() => null, (e: unknown) => e);
    await relacher();

    // Le refus est bien la saturation — pas un plantage d'un autre genre.
    expect(echec).toBeInstanceOf(Error);
    expect(connexion.estSaturationPool(echec)).toBe(true);

    // Rejouée après la pointe : la remise aboutit, et une seule fois.
    const remise = await eleve.session.submit({ answers: reponses, timeSpent: 60 });
    expect(remise).toBeTruthy();

    const { eq } = await import("drizzle-orm");
    const { responses: tableReponses, sessions } = await import("@db/schema");
    const lignes = await harnais.db
      .select()
      .from(tableReponses)
      .where(eq(tableReponses.sessionId, sessionId));
    // Une ligne par question répondue, pas une de plus : pas de double note.
    expect(lignes.length).toBe(reponses.length);
    const [s] = await harnais.db.select().from(sessions).where(eq(sessions.id, sessionId));
    // Remise puis correction : la copie est close, une seule fois.
    expect(s.status).toBe("completed");
    expect(s.endedAt).not.toBeNull();
  });
});
