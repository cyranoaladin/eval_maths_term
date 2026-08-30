/**
 * Qui possède quoi, et qui peut ouvrir la porte.
 *
 * Deux couches se répondent : les gardes de propriété, qui refusent l'accès à
 * ce qui appartient à un collègue, et la gestion des comptes, qui décide de
 * qui entre. Les deux ont déjà eu des défauts silencieux — un enseignant
 * voyait les copies d'un autre, et le propriétaire déclaré de l'installation
 * pouvait rester enfermé dehors.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerEnseignant, creerEvaluation, db, nettoyer, unique } from "./harnais";
import { users as tableUsers } from "@db/schema";
import type { User } from "@db/schema";
import {
  assertOwnedStudent, assertQuestionAccessible, assertEvaluationAccessible,
} from "../../queries/ownership";
import { definirAcces, enregistrerConnexion, findUserByUnionId } from "../../queries/users";
import { env } from "../../lib/env";

let prof: User;
const OWNER_INITIAL = env.ownerUnionId;
const evaluationsCreees: number[] = [];
const comptes: number[] = [];

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant propriété");
});

afterEach(() => {
  (env as { ownerUnionId: string }).ownerUnionId = OWNER_INITIAL;
});

afterAll(async () => {
  for (const id of comptes) await db.delete(tableUsers).where(eq(tableUsers.id, id));
  await nettoyer(evaluationsCreees, [prof.id]);
});

/** Suit un compte créé par une connexion, pour l'effacer à la fin. */
async function connecter(unionId: string, nom = "Nouvelle venue") {
  await enregistrerConnexion({ unionId, name: nom });
  const compte = (await findUserByUnionId(unionId))!;
  comptes.push(compte.id);
  return compte;
}

describe("gardes de propriété", () => {
  it("nomme ce qui manque plutôt que de refuser en bloc", async () => {
    await expect(assertOwnedStudent(999_999_999, prof.id)).rejects.toThrow(/Élève introuvable/);
    await expect(assertQuestionAccessible(999_999_999, prof.id)).rejects.toThrow(
      /Question introuvable/,
    );
    await expect(assertEvaluationAccessible(999_999_999, prof.id)).rejects.toThrow();
  });

  it("remonte de la question à son évaluation", async () => {
    const ev = await creerEvaluation(prof, "Propriété");
    evaluationsCreees.push(ev.evaluationId);

    await expect(assertQuestionAccessible(ev.questionIds[0], prof.id)).resolves.toEqual({
      questionId: ev.questionIds[0],
      evaluationId: ev.evaluationId,
    });

    const voisin = await creerEnseignant("Enseignant voisin propriété");
    comptes.push(voisin.id);
    await expect(assertQuestionAccessible(ev.questionIds[0], voisin.id)).rejects.toThrow();
  });
});

describe("première connexion", () => {
  it("crée un compte sans droits", async () => {
    const compte = await connecter(unique("inconnu"));

    // Le rôle ne vient jamais du fournisseur : un inconnu attend qu'on
    // l'autorise, et n'ouvre rien en attendant.
    expect(compte).toMatchObject({ role: "student", status: "pending" });
  });

  it("rétablit le propriétaire déclaré, même s'il s'était vu retirer ses droits", async () => {
    const unionId = unique("patron");
    const compte = await connecter(unionId, "Propriétaire");
    expect(compte.status).toBe("pending");

    // La variable est renseignée après coup : la connexion suivante rétablit.
    (env as { ownerUnionId: string }).ownerUnionId = unionId;
    await enregistrerConnexion({ unionId, name: "Propriétaire" });

    const apres = (await findUserByUnionId(unionId))!;
    expect(apres).toMatchObject({ role: "admin", status: "active" });
  });

  it("laisse le propriétaire tel quel quand il l'est déjà", async () => {
    const unionId = unique("patron-actif");
    (env as { ownerUnionId: string }).ownerUnionId = unionId;
    await connecter(unionId, "Propriétaire actif");

    await enregistrerConnexion({ unionId, name: "Propriétaire actif" });

    const apres = (await findUserByUnionId(unionId))!;
    expect(apres).toMatchObject({ role: "admin", status: "active" });
  });

  it("met à jour le nom sans toucher aux droits", async () => {
    const unionId = unique("renomme");
    const avant = await connecter(unionId, "Ancien nom");
    await definirAcces(avant.id, "teacher", "active");

    await enregistrerConnexion({ unionId, name: "Nouveau nom" });

    const apres = (await findUserByUnionId(unionId))!;
    expect(apres.name).toBe("Nouveau nom");
    // Une reconnexion ne rétrograde pas un compte déjà autorisé.
    expect(apres).toMatchObject({ role: "teacher", status: "active" });
  });
});

describe("attribution des droits", () => {
  it("refuse d'agir sur un compte qui n'existe pas", async () => {
    await expect(definirAcces(999_999_999, "teacher", "active")).rejects.toThrow(
      /Compte introuvable/,
    );
  });

  it("refuse de retirer le dernier administrateur actif", async () => {
    // Les autres suites créent des administrateurs ; on part d'un état connu en
    // désactivant tous ceux qui existent, sauf celui qu'on éprouve.
    const seul = await creerEnseignant("Dernier administrateur", "admin");
    comptes.push(seul.id);
    const autres = await db
      .select()
      .from(tableUsers)
      .where(eq(tableUsers.role, "admin"));
    const desactives: number[] = [];
    for (const a of autres) {
      if (a.id !== seul.id && a.status === "active") {
        await db.update(tableUsers).set({ status: "disabled" }).where(eq(tableUsers.id, a.id));
        desactives.push(a.id);
      }
    }

    try {
      await expect(definirAcces(seul.id, "teacher", "active")).rejects.toThrow(
        /dernier administrateur actif/,
      );
      // Le désactiver revient au même : plus personne ne rouvrirait la porte.
      await expect(definirAcces(seul.id, "admin", "disabled")).rejects.toThrow(
        /dernier administrateur actif/,
      );

      // Dès qu'un second existe, le premier peut être retiré.
      const releve = await creerEnseignant("Administrateur de relève", "admin");
      comptes.push(releve.id);
      await expect(definirAcces(seul.id, "teacher", "active")).resolves.toBeUndefined();
    } finally {
      for (const id of desactives) {
        await db.update(tableUsers).set({ status: "active" }).where(eq(tableUsers.id, id));
      }
    }
  });
});
