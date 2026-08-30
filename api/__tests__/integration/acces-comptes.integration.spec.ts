/**
 * Qui obtient l'accès, et comment.
 *
 * `users.role` avait `teacher` pour valeur par défaut : `upsertUser` créait
 * l'enregistrement sans préciser de rôle, MySQL appliquait le défaut, et toute
 * personne capable d'ouvrir une session chez le fournisseur OAuth devenait
 * enseignante à sa première connexion. Rien ne le signalait — ni journal, ni
 * écran, ni approbation.
 *
 * Ces tests parlent à la vraie base parce que c'est la base qui portait la
 * faille : le défaut de colonne. Un double ne l'aurait jamais montré.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, unique, appelEnseignant, creerEnseignant } from "./harnais";
import { enregistrerConnexion, findUserByUnionId } from "../../queries/users";
import { users } from "@db/schema";
import { env } from "../../lib/env";

const crees: number[] = [];

async function connecter(unionId: string, nom = "Personne inconnue") {
  await enregistrerConnexion({ unionId, name: nom });
  const u = await findUserByUnionId(unionId);
  if (u) crees.push(u.id);
  return u;
}

afterAll(async () => {
  if (crees.length) await db.delete(users).where(inArray(users.id, crees));
});

describe("première connexion d'un compte inconnu", () => {
  it("ne donne aucun droit", async () => {
    const u = await connecter(unique("inconnu"));
    expect(u).toBeDefined();
    expect(u!.role).toBe("student");
    expect(u!.status).toBe("pending");
  });

  it("n'ouvre aucune route enseignant", async () => {
    const u = await connecter(unique("inconnu"));
    await expect(appelEnseignant(u!).authoring.listEvaluations()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("laisse une trace consultable par un administrateur", async () => {
    const unionId = unique("inconnu");
    await connecter(unionId, "Marie Dupont");
    const admin = await creerEnseignant("Administratrice", "admin");
    crees.push(admin.id);

    const comptes = await appelEnseignant(admin).access.listUsers();
    const trouve = comptes.find((c) => c.name === "Marie Dupont");
    expect(trouve, "le compte en attente doit être visible").toBeDefined();
    expect(trouve!.enAttente).toBe(true);
  });
});

describe("reconnexion", () => {
  it("ne restaure pas un accès révoqué", async () => {
    const unionId = unique("revoque");
    await connecter(unionId);
    const u = await findUserByUnionId(unionId);
    await db
      .update(users)
      .set({ role: "teacher", status: "disabled" })
      .where(eq(users.id, u!.id));

    await enregistrerConnexion({ unionId, name: "Nouveau nom" });

    const apres = await findUserByUnionId(unionId);
    expect(apres!.status).toBe("disabled");
    expect(apres!.role).toBe("teacher");
    // Le profil affiché, lui, se rafraîchit.
    expect(apres!.name).toBe("Nouveau nom");
  });

  it("ne promeut jamais un compte autorisé une seule fois", async () => {
    const unionId = unique("stable");
    await connecter(unionId);
    const u = await findUserByUnionId(unionId);
    await db.update(users).set({ role: "teacher", status: "active" }).where(eq(users.id, u!.id));

    await enregistrerConnexion({ unionId });

    const apres = await findUserByUnionId(unionId);
    expect(apres!.role).toBe("teacher");
    expect(apres!.status).toBe("active");
  });
});

describe("propriétaire déclaré", () => {
  const proprietaireInitial = env.ownerUnionId;
  beforeEach(() => {
    // `env` est figé au chargement : on écrit dessus le temps du test, comme le
    // ferait un déploiement où OWNER_UNION_ID est renseigné.
    (env as { ownerUnionId: string }).ownerUnionId = proprietaireInitial;
  });
  afterAll(() => {
    (env as { ownerUnionId: string }).ownerUnionId = proprietaireInitial;
  });

  it("est provisionné administrateur à sa première connexion", async () => {
    const unionId = unique("proprietaire");
    (env as { ownerUnionId: string }).ownerUnionId = unionId;

    const u = await connecter(unionId, "Propriétaire");
    expect(u!.role).toBe("admin");
    expect(u!.status).toBe("active");
  });

  it("est rétabli s'il a été déclaré après coup", async () => {
    const unionId = unique("proprietaire");
    await connecter(unionId, "Futur propriétaire");
    const avant = await findUserByUnionId(unionId);
    expect(avant!.status).toBe("pending");

    (env as { ownerUnionId: string }).ownerUnionId = unionId;
    await enregistrerConnexion({ unionId });

    const apres = await findUserByUnionId(unionId);
    expect(apres!.role).toBe("admin");
    expect(apres!.status).toBe("active");
  });
});

describe("autorisation par un administrateur", () => {
  it("ouvre l'accès enseignant à un compte en attente", async () => {
    const unionId = unique("candidat");
    await connecter(unionId);
    const candidat = await findUserByUnionId(unionId);
    const admin = await creerEnseignant("Admin", "admin");
    crees.push(admin.id);

    await appelEnseignant(admin).access.setAccess({
      userId: candidat!.id,
      role: "teacher",
      status: "active",
    });

    const apres = await findUserByUnionId(unionId);
    expect(apres!.role).toBe("teacher");
    expect(apres!.status).toBe("active");
    await expect(appelEnseignant(apres!).authoring.listEvaluations()).resolves.toBeDefined();
  });

  it("est refusée à un enseignant : le rôle ne se distribue pas entre pairs", async () => {
    const enseignant = await creerEnseignant("Enseignant ordinaire");
    crees.push(enseignant.id);
    const unionId = unique("candidat");
    await connecter(unionId);
    const candidat = await findUserByUnionId(unionId);

    await expect(
      appelEnseignant(enseignant).access.setAccess({
        userId: candidat!.id,
        role: "teacher",
        status: "active",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuse à un administrateur de se retirer ses propres droits", async () => {
    const admin = await creerEnseignant("Admin solitaire", "admin");
    crees.push(admin.id);
    await expect(
      appelEnseignant(admin).access.setAccess({
        userId: admin.id,
        role: "teacher",
        status: "active",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuse de retirer le dernier administrateur actif", async () => {
    // Une installation sans administrateur actif est ingouvernable : plus
    // personne ne peut autoriser qui que ce soit. On met donc de côté les
    // administrateurs que les autres suites ont laissés, le temps de se placer
    // dans cette situation.
    const enPlace = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.status, "active")));
    if (enPlace.length) {
      await db
        .update(users)
        .set({ status: "disabled" })
        .where(inArray(users.id, enPlace.map((a) => a.id)));
    }

    const premier = await creerEnseignant("Premier admin", "admin");
    crees.push(premier.id);
    const second = await creerEnseignant("Second admin", "admin");
    crees.push(second.id);

    // Ils sont deux : le second peut retirer le premier.
    await appelEnseignant(second).access.setAccess({
      userId: premier.id,
      role: "teacher",
      status: "active",
    });

    // Il ne reste que `second` : plus personne ne peut le rétrograder.
    await expect(
      appelEnseignant(second).access.setAccess({
        userId: second.id,
        role: "teacher",
        status: "active",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Même depuis un autre administrateur — ici le premier, qu'on rétablit.
    await db.update(users).set({ role: "admin" }).where(eq(users.id, premier.id));
    const premierRetabli = { ...premier, role: "admin" as const, status: "active" as const };
    await appelEnseignant(premierRetabli).access.setAccess({
      userId: second.id,
      role: "teacher",
      status: "active",
    });

    if (enPlace.length) {
      await db
        .update(users)
        .set({ status: "active" })
        .where(inArray(users.id, enPlace.map((a) => a.id)));
    }
  });
});
