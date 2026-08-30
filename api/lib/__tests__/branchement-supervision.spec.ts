/**
 * Le branchement de la supervision.
 *
 * Le nettoyage est éprouvé à côté ; ici, c'est la mise en service qui est en
 * cause : sans destination configurée, rien ne doit partir et rien ne doit
 * échouer — c'est le cas d'un établissement qui héberge seul. Avec une
 * destination, ce qui part doit d'abord passer par le nettoyage.
 *
 * Le SDK est remplacé : ce qu'on éprouve, c'est ce que nous lui demandons.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const init = vi.fn();
const captureMessage = vi.fn();
const flush = vi.fn().mockResolvedValue(true);

vi.mock("@sentry/node", () => ({ init, captureMessage, flush }));

const DSN = "https://cle-de-test@supervision.invalide/42";

/** Le module retient son état : chaque cas repart d'une copie neuve. */
async function chargerSupervision(dsn: string) {
  vi.resetModules();
  const { env } = await import("../env");
  (env as { sentryDsn?: string }).sentryDsn = dsn;
  return import("../supervision");
}

beforeEach(() => {
  init.mockClear();
  captureMessage.mockClear();
  flush.mockClear();
});

afterEach(async () => {
  vi.resetModules();
  const { env } = await import("../env");
  (env as { sentryDsn?: string }).sentryDsn = "";
});

describe("sans destination configurée", () => {
  it("ne branche rien et ne se plaint pas", async () => {
    const s = await chargerSupervision("");

    s.initialiserSupervision();

    expect(init).not.toHaveBeenCalled();
    expect(s.supervisionActive()).toBe(false);
  });

  it("laisse passer un signalement sans rien envoyer", async () => {
    const s = await chargerSupervision("");
    s.initialiserSupervision();

    s.signalerErreur("copie non enregistrée", { sessionId: 7 });
    await s.viderLaFileDeSupervision();

    expect(captureMessage).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });
});

describe("avec une destination", () => {
  it("branche le SDK sans données personnelles ni traces", async () => {
    const s = await chargerSupervision(DSN);

    s.initialiserSupervision();

    expect(s.supervisionActive()).toBe(true);
    const options = init.mock.calls[0][0];
    expect(options.dsn).toBe(DSN);
    // Adresse IP, en-têtes, corps : rien de tout cela par défaut.
    expect(options.sendDefaultPii).toBe(false);
    // Les traces de performance porteraient les mêmes données scolaires.
    expect(options.tracesSampleRate).toBe(0);
    // La version permet de rattacher une erreur à l'artefact déployé.
    expect(options.release).toMatch(/.+\+.+/);
  });

  it("ne se branche qu'une fois", async () => {
    const s = await chargerSupervision(DSN);

    s.initialiserSupervision();
    s.initialiserSupervision();

    expect(init).toHaveBeenCalledTimes(1);
  });

  it("fait passer tout événement par le nettoyage avant l'envoi", async () => {
    const s = await chargerSupervision(DSN);
    s.initialiserSupervision();
    const beforeSend = init.mock.calls[0][0].beforeSend;

    const nettoye = beforeSend({
      message: "échec pour Aïcha Benkhelifa",
      extra: { studentName: "Aïcha Benkhelifa", sessionId: 12 },
    });

    expect(nettoye.extra.studentName).toBe("[retiré]");
    // L'identifiant de copie survit : sans lui, un rapport ne se rattache à rien.
    expect(nettoye.extra.sessionId).toBe(12);
  });

  it("nettoie aussi ce qu'on lui joint à la main", async () => {
    const s = await chargerSupervision(DSN);
    s.initialiserSupervision();

    s.signalerErreur("remise refusée", { sessionToken: "eyJhbGciOi.abcdefgh.ijklmnop", sessionId: 3 });

    const [message, options] = captureMessage.mock.calls[0];
    expect(message).toBe("remise refusée");
    expect(options.level).toBe("error");
    expect(options.extra).toEqual({ sessionToken: "[retiré]", sessionId: 3 });
  });

  it("signale sans données jointes quand il n'y en a pas", async () => {
    const s = await chargerSupervision(DSN);
    s.initialiserSupervision();

    s.signalerErreur("arrêt inattendu");

    expect(captureMessage.mock.calls[0][1].extra).toBeUndefined();
  });

  it("vide la file avant que le serveur ne ferme", async () => {
    const s = await chargerSupervision(DSN);
    s.initialiserSupervision();

    await s.viderLaFileDeSupervision(500);

    // Sans cette attente, les dernières erreurs d'un arrêt partent à la poubelle.
    expect(flush).toHaveBeenCalledWith(500);
  });
});
