/**
 * La disponibilité ne doit pas se déclarer en panne pour une raison qu'elle
 * peut réparer.
 *
 * Le contrôle du dossier des tirages échouait sur son absence. Or ce dossier
 * est celui de l'application, créé de toute façon au premier tirage : un
 * déploiement neuf — ou un volume monté par-dessus — restait donc indisponible
 * pour toujours, sans que rien n'ait de raison de le réparer. La CI l'a montré
 * dès son premier passage : le serveur de production ne devenait jamais
 * disponible, et les parcours navigateur ne démarraient pas.
 */
import { describe, it, expect, afterAll } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { env } from "../env";
import { codeDErreur, evaluerDisponibilite } from "../readiness";

const initial = env.paperOutputDir;
const dossier = join(tmpdir(), `tirages-absents-${process.pid}`);

afterAll(() => {
  (env as { paperOutputDir: string }).paperOutputDir = initial;
  rmSync(dossier, { recursive: true, force: true });
});

describe("disponibilité", () => {
  it("crée le dossier des tirages s'il manque, au lieu de se déclarer hors service", async () => {
    rmSync(dossier, { recursive: true, force: true });
    expect(existsSync(dossier)).toBe(false);
    (env as { paperOutputDir: string }).paperOutputDir = dossier;

    const bilan = await evaluerDisponibilite();
    const tirages = bilan.controles.find((c) => c.nom === "tirages")!;

    expect(tirages.etat).toBe("ok");
    expect(existsSync(dossier)).toBe(true);
  }, 30_000);

  it("ne rend aucun contrôle sans durée ni détail", async () => {
    const bilan = await evaluerDisponibilite();
    expect(bilan.controles).toHaveLength(6);
    for (const c of bilan.controles) {
      expect(c.detail, c.nom).not.toBe("");
      expect(typeof c.dureeMs, c.nom).toBe("number");
    }
  }, 30_000);
});

describe("ce qu'une panne laisse voir", () => {
  /*
    Le message d'une erreur de système de fichiers porte un chemin absolu, celui
    d'un pilote de base l'adresse du serveur et parfois l'utilisateur. On n'en
    garde que le code : il dit ce qui ne va pas sans dire où. « Error » tout
    court, ce qui était rendu jusque-là, ne renseignait personne.
  */
  it("garde le code d'une erreur système", () => {
    const erreur = Object.assign(new Error("EACCES: permission denied, mkdir '/data/paper-exams'"), {
      code: "EACCES",
    });
    expect(codeDErreur(erreur)).toBe("EACCES");
  });

  it("garde le code d'une erreur de pilote de base", () => {
    const erreur = Object.assign(
      new Error("Access denied for user 'eval'@'10.0.0.4' (using password: YES)"),
      { code: "ER_ACCESS_DENIED_ERROR" },
    );
    expect(codeDErreur(erreur)).toBe("ER_ACCESS_DENIED_ERROR");
  });

  it("se rabat sur le nom quand il n'y a pas de code", () => {
    expect(codeDErreur(new TypeError("chemin illisible /home/exploitant/x"))).toBe("TypeError");
  });

  it("ne laisse jamais passer un chemin ni un identifiant", () => {
    const cas: unknown[] = [
      Object.assign(new Error("mkdir '/var/lib/mysql'"), { code: "EACCES" }),
      new Error("mysql://eval:motdepasse@10.0.0.4:3306/eval_maths"),
      "chaîne brute /home/quelquun",
    ];
    for (const e of cas) {
      const rendu = codeDErreur(e);
      expect(rendu).not.toMatch(/\/|@|mysql:/);
    }
  });
});
