/**
 * Le journal, la version, et le refus de démarrer sur une configuration fausse.
 *
 * Ces trois-là s'observent au chargement du module : le niveau de journal est
 * figé à l'import, la version vient de constantes posées à la construction, et
 * la configuration est validée une fois pour toutes. Chaque cas repart donc
 * d'un module neuf.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { randomBytes } from "node:crypto";

/** Un secret plausible, tiré à chaque appel. */
const secretDeTest = () => randomBytes(36).toString("base64");

const ENV_INITIAL = { ...process.env };

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...ENV_INITIAL };
});

async function journalAvecNiveau(niveau: string) {
  vi.resetModules();
  process.env.LOG_LEVEL = niveau;
  const { logger } = await import("../logger");
  return logger;
}

describe("niveau de journal", () => {
  it("écrit les quatre niveaux quand on demande le plus bavard", async () => {
    const logger = await journalAvecNiveau("debug");
    const sorties = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };

    logger.debug("mise au point");
    logger.info("information");
    logger.warn("avertissement");
    logger.error("erreur");

    for (const sortie of Object.values(sorties)) expect(sortie).toHaveBeenCalledOnce();
    // Chaque ligne est un objet JSON : c'est ce qui la rend lisible par une
    // machine, et c'est le format que la production agrège.
    const ligne = JSON.parse(sorties.info.mock.calls[0][0] as string);
    expect(ligne).toMatchObject({ level: "info", msg: "information" });
    expect(ligne.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("tait ce qui est sous le seuil", async () => {
    const logger = await journalAvecNiveau("warn");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logger.debug("mise au point");
    logger.info("information");
    logger.warn("avertissement");

    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("refuse un niveau inconnu au démarrage plutôt que de le deviner", async () => {
    vi.resetModules();
    process.env = { ...ENV_INITIAL, LOG_LEVEL: "bavardage" } as NodeJS.ProcessEnv;

    // Un niveau mal orthographié dans un fichier de configuration doit se voir
    // au démarrage, pas se traduire par un journal silencieux en production.
    await expect(import("../logger")).rejects.toThrow(/LOG_LEVEL/);
  });

  it("joint la pile d'une erreur, et le texte de ce qui n'en est pas une", async () => {
    const logger = await journalAvecNiveau("error");
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.errorWithStack("remise perdue", new Error("connexion coupée"), { sessionId: 7 });
    logger.errorWithStack("cas étrange", "un texte jeté");

    const premiere = JSON.parse(erreur.mock.calls[0][0] as string);
    expect(premiere.sessionId).toBe(7);
    expect(premiere.stack).toContain("connexion coupée");
    expect(JSON.parse(erreur.mock.calls[1][0] as string).stack).toBe("un texte jeté");
  });
});

describe("version de l'application", () => {
  it("annonce « développement » hors construction", async () => {
    vi.resetModules();
    const { VERSION_APPLICATION, EMPREINTE_GIT } = await import("../version");
    expect(VERSION_APPLICATION).toBe("développement");
    expect(EMPREINTE_GIT).toBe("développement");
  });

  it("reprend ce que la construction a posé", async () => {
    vi.resetModules();
    vi.stubGlobal("__VERSION_APPLICATION__", "1.0.0-rc2");
    vi.stubGlobal("__EMPREINTE_GIT__", "90fb380");

    const { VERSION_APPLICATION, EMPREINTE_GIT } = await import("../version");

    // C'est ce couple qui rattache une erreur de production à un artefact.
    expect(VERSION_APPLICATION).toBe("1.0.0-rc2");
    expect(EMPREINTE_GIT).toBe("90fb380");
  });
});

describe("refus de démarrer", () => {
  /** Recharge la configuration avec les variables données. */
  async function chargerAvec(surcharges: Record<string, string | undefined>) {
    vi.resetModules();
    process.env = { ...ENV_INITIAL, ...surcharges } as NodeJS.ProcessEnv;
    return import("../env");
  }

  it("nomme la variable fautive plutôt que d'échouer plus loin", async () => {
    await expect(chargerAvec({ APP_ID: undefined })).rejects.toThrow(
      /Variables d'environnement invalides[\s\S]*APP_ID/,
    );
  });

  it("refuse une production sans adresse publique", async () => {
    // Sans elle, la redirection OAuth se fabriquerait à partir d'un en-tête
    // fourni par le client.
    await expect(
      chargerAvec({ NODE_ENV: "production", PUBLIC_BASE_URL: undefined }),
    ).rejects.toThrow(/Configuration de production refusée[\s\S]*PUBLIC_BASE_URL/);
  });

  it("accepte une production correctement décrite", async () => {
    const { env } = await chargerAvec({
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://atelier.exemple.fr",
      // Tirés à l'instant : rien de ce fichier n'ouvre quoi que ce soit.
      APP_SECRET: secretDeTest(),
      TEACHER_SESSION_SECRET: secretDeTest(),
      STUDENT_SESSION_SECRET: secretDeTest(),
    });
    expect(env.isProduction).toBe(true);
    expect(env.publicBaseUrl).toBe("https://atelier.exemple.fr");
  });
});
