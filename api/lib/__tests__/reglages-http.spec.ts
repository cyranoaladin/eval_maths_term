/**
 * Les délais du serveur HTTP.
 *
 * Ce ne sont pas des nombres décoratifs : ils encodent une règle — le serveur
 * tient plus longtemps que le plus patient de ses clients. Un jour, quelqu'un
 * les baissera pour « libérer des connexions plus vite ». Ce test est là pour
 * lui dire ce qu'il casse.
 */
import { describe, it, expect } from "vitest";
import {
  CLIENT_LE_PLUS_PATIENT_MS,
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_MS,
} from "../reglages-http";

describe("délais de connexion", () => {
  it("tient plus longtemps que le plus patient des clients", () => {
    // Gecko garde une connexion inactive 115 s. Fermer avant lui, c'est lui
    // laisser réutiliser un tuyau clos : requête perdue, ou attente de plusieurs
    // minutes avant qu'il s'en aperçoive.
    expect(KEEP_ALIVE_MS).toBeGreaterThan(CLIENT_LE_PLUS_PATIENT_MS);
  });

  it("laisse le délai d'en-têtes au-dessus du délai d'inactivité", () => {
    // Sinon c'est lui qui coupe, et le premier réglage ne sert à rien.
    expect(HEADERS_TIMEOUT_MS).toBeGreaterThan(KEEP_ALIVE_MS);
  });

  it("reste très au-dessus du défaut de Node", () => {
    // Cinq secondes : le défaut, et la cause d'une remise de copie perdue sur
    // deux cents lors d'une mesure de charge.
    expect(KEEP_ALIVE_MS).toBeGreaterThan(5_000 * 10);
  });

  it("ne dépasse pas ce qu'un répartiteur tolère sans configuration", () => {
    // Au-delà de quelques minutes, une connexion inactive coûte plus qu'elle ne
    // rapporte, et certains répartiteurs la coupent d'autorité.
    expect(KEEP_ALIVE_MS).toBeLessThanOrEqual(300_000);
  });
});
