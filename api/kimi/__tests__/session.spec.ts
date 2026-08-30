/**
 * Le jeton de session enseignant.
 *
 * C'est lui qui tient toute l'authentification côté enseignant : signé avec
 * `TEACHER_SESSION_SECRET`, valable douze heures. Un jeton forgé, expiré ou
 * signé avec un autre secret ne doit jamais ouvrir une session.
 */
import { describe, it, expect } from "vitest";
import * as jose from "jose";
import { signSessionToken, verifySessionToken } from "../session";

const charge = { unionId: "enseignant-test", clientId: "app-de-test" };

describe("signSessionToken / verifySessionToken", () => {
  it("signe puis relit un jeton", async () => {
    const jeton = await signSessionToken(charge);
    const lu = await verifySessionToken(jeton);
    expect(lu?.unionId).toBe("enseignant-test");
    expect(lu?.clientId).toBe("app-de-test");
  });

  it("refuse une chaîne qui n'est pas un jeton", async () => {
    expect(await verifySessionToken("pas-un-jeton")).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
  });

  it("refuse un jeton signé avec un autre secret", async () => {
    // Le cas qui compte : quelqu'un qui connaîtrait la structure mais pas le
    // secret ne doit pas pouvoir se fabriquer une session.
    const autreSecret = new TextEncoder().encode(
      "un-autre-secret-de-trente-deux-caracteres-au-moins",
    );
    const forge = await new jose.SignJWT(charge)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(autreSecret);
    expect(await verifySessionToken(forge)).toBeNull();
  });

  it("refuse un jeton expiré", async () => {
    const secret = new TextEncoder().encode(process.env.TEACHER_SESSION_SECRET!);
    const perime = await new jose.SignJWT(charge)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 86_400)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3_600)
      .sign(secret);
    expect(await verifySessionToken(perime)).toBeNull();
  });

  it("refuse un jeton dont la signature a été retouchée", async () => {
    const jeton = await signSessionToken(charge);
    const altere = `${jeton.slice(0, -3)}abc`;
    expect(await verifySessionToken(altere)).toBeNull();
  });
});
