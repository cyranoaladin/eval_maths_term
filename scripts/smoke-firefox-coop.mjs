/**
 * scripts/smoke-firefox-coop.mjs
 *
 * Firefox, en vrai, contre le vrai build — sans Playwright.
 *
 * Les parcours navigateur désactivent l'application de COOP dans leur Firefox,
 * parce que le pilote de Playwright s'y perd. Cette dérogation ne vaut que si
 * quelqu'un vérifie, ailleurs, que Firefox se comporte normalement quand
 * `Cross-Origin-Opener-Policy: same-origin` est bien appliqué. C'est ce que
 * fait ce script.
 *
 * Il pilote un Firefox du système par Marionette — le protocole d'automatisation
 * de Gecko lui-même, parlé en TCP, sans geckodriver, sans WebDriver, et surtout
 * sans une ligne de Playwright. Le navigateur est celui de la machine, pas la
 * variante corrigée que Playwright embarque.
 *
 * Deux compteurs, et ils doivent valoir zéro :
 *   FIREFOX_NATIVE_COOP_NAVIGATION_FAIL — une navigation a rendu une erreur
 *   FIREFOX_NATIVE_COOP_HANG            — une navigation n'a jamais rendu la main
 *
 * Usage : node scripts/smoke-firefox-coop.mjs [base] [navigations]
 */
import { connect } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:3200";
const OBJECTIF = Number(process.argv[3] ?? 100);
const PORT_MARIONETTE = 2929;

/** Ce qu'on visite. Des pages publiques : ce test regarde la navigation. */
const ROUTES = ["/", "/login", "/mentions-legales", "/confidentialite", "/results"];

/*
  Deux limites différentes, et la distinction compte.

  Marionette rend une erreur quand *lui* juge la page trop lente : c'est un
  échec, la chaîne fonctionne. Le défaut qu'on traque est autre — l'événement
  attendu ne vient jamais et l'appel ne rend pas la main. Notre propre limite,
  plus longue, sépare les deux.
*/
const LIMITE_MARIONETTE = 20_000;
const LIMITE_MURALE = 45_000;

let msgId = 0;
let socket;
let tampon = Buffer.alloc(0);
const enAttente = new Map();

function lire() {
  for (;;) {
    const sep = tampon.indexOf(0x3a); // ':'
    if (sep < 0) return;
    const taille = Number(tampon.subarray(0, sep).toString("ascii"));
    if (!Number.isFinite(taille)) throw new Error("cadre Marionette illisible");
    if (tampon.length < sep + 1 + taille) return;
    const charge = tampon.subarray(sep + 1, sep + 1 + taille).toString("utf8");
    tampon = tampon.subarray(sep + 1 + taille);
    const message = JSON.parse(charge);
    if (!Array.isArray(message)) continue; // la poignée de main d'ouverture
    const [, id, erreur, resultat] = message;
    const attente = enAttente.get(id);
    if (!attente) continue;
    enAttente.delete(id);
    if (erreur) attente.rejeter(new Error(erreur.message ?? JSON.stringify(erreur)));
    else attente.tenir(resultat);
  }
}

/** Envoie une commande et attend sa réponse, sans limite propre. */
function commande(nom, params = {}) {
  const id = ++msgId;
  const charge = JSON.stringify([0, id, nom, params]);
  const octets = Buffer.from(charge, "utf8");
  socket.write(`${octets.length}:`);
  socket.write(octets);
  return new Promise((tenir, rejeter) => enAttente.set(id, { tenir, rejeter }));
}

/** La même, mais qui distingue « erreur » de « ne revient jamais ». */
async function commandeBornee(nom, params, limite) {
  let minuterie;
  const bloquee = Symbol("bloquée");
  const garde = new Promise((tenir) => {
    minuterie = setTimeout(() => tenir(bloquee), limite);
  });
  try {
    const issue = await Promise.race([
      commande(nom, params).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e })),
      garde,
    ]);
    if (issue === bloquee) return { bloquee: true };
    return issue;
  } finally {
    clearTimeout(minuterie);
  }
}

const attendre = (ms) => new Promise((t) => setTimeout(t, ms));

async function main() {
  // ── L'en-tête est-il vraiment là ? Sans cela, le test ne prouve rien.
  const entetes = new Map();
  for (const route of ROUTES) {
    const r = await fetch(BASE + route, { redirect: "manual" });
    entetes.set(route, r.headers.get("cross-origin-opener-policy"));
  }
  const sansCoop = [...entetes].filter(([, v]) => v !== "same-origin");
  if (sansCoop.length > 0) {
    console.error("✗ COOP absente ou relâchée — ce test n'éprouverait rien :");
    for (const [route, valeur] of sansCoop) console.error(`    ${route} → ${valeur ?? "(absent)"}`);
    process.exit(1);
  }
  console.log(`✓ Cross-Origin-Opener-Policy: same-origin sur les ${ROUTES.length} routes visitées`);

  const profil = await mkdtemp(join(tmpdir(), "firefox-coop-"));
  await writeFile(
    join(profil, "user.js"),
    [
      `user_pref("marionette.port", ${PORT_MARIONETTE});`,
      `user_pref("browser.shell.checkDefaultBrowser", false);`,
      `user_pref("browser.startup.homepage_override.mstone", "ignore");`,
      `user_pref("datareporting.policy.dataSubmissionEnabled", false);`,
      `user_pref("toolkit.telemetry.enabled", false);`,
      `user_pref("app.update.enabled", false);`,
      // Et surtout : rien qui touche à COOP. C'est tout l'objet du test.
      "",
    ].join("\n"),
    "utf8",
  );

  const firefox = spawn(
    "firefox",
    ["--marionette", "--headless", "--no-remote", "--profile", profil, "about:blank"],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" } },
  );
  const journal = [];
  firefox.stdout.on("data", (d) => journal.push(String(d)));
  firefox.stderr.on("data", (d) => journal.push(String(d)));

  let echecs = 0;
  let blocages = 0;
  let faites = 0;
  const durees = [];

  try {
    // Marionette n'écoute qu'une fois le navigateur installé.
    for (let essai = 0; ; essai++) {
      try {
        socket = await new Promise((tenir, rejeter) => {
          const s = connect(PORT_MARIONETTE, "127.0.0.1");
          s.once("connect", () => tenir(s));
          s.once("error", rejeter);
        });
        break;
      } catch (e) {
        if (essai >= 60) throw new Error(`Marionette injoignable : ${e.message}\n${journal.join("")}`);
        await attendre(500);
      }
    }
    socket.on("data", (d) => {
      tampon = Buffer.concat([tampon, d]);
      lire();
    });

    await commande("WebDriver:NewSession", {
      capabilities: { alwaysMatch: { acceptInsecureCerts: true } },
    });
    await commande("WebDriver:SetTimeouts", { pageLoad: LIMITE_MARIONETTE, script: 10_000 });

    const version = await commande("WebDriver:ExecuteScript", {
      script: "return navigator.userAgent",
      args: [],
    });
    console.log(`  navigateur : ${version?.value ?? "inconnu"}`);
    console.log(`  ${OBJECTIF} navigations sur ${ROUTES.length} routes, COOP appliquée`);

    for (let i = 0; i < OBJECTIF; i++) {
      const route = ROUTES[i % ROUTES.length];
      const debut = Date.now();
      const issue = await commandeBornee("WebDriver:Navigate", { url: BASE + route }, LIMITE_MURALE);
      const duree = Date.now() - debut;
      faites++;

      if (issue.bloquee) {
        blocages++;
        console.log(`  ✗ ${String(i + 1).padStart(3)} ${route} — sans retour après ${LIMITE_MURALE} ms`);
        break; // la session est perdue : insister ne dirait rien de plus
      }
      if (!issue.ok) {
        echecs++;
        console.log(`  ✗ ${String(i + 1).padStart(3)} ${route} — ${issue.e.message}`);
        continue;
      }
      durees.push(duree);

      // La navigation a-t-elle abouti sur *notre* page ?
      const url = await commandeBornee("WebDriver:GetCurrentURL", {}, LIMITE_MURALE);
      if (url.bloquee) {
        blocages++;
        console.log(`  ✗ ${String(i + 1).padStart(3)} ${route} — l'adresse courante ne revient pas`);
        break;
      }
      if (!url.ok || !String(url.r?.value ?? "").startsWith(BASE)) {
        echecs++;
        console.log(`  ✗ ${String(i + 1).padStart(3)} ${route} — adresse inattendue : ${url.r?.value}`);
      }
      if ((i + 1) % 20 === 0) console.log(`    ${i + 1} navigations`);
    }

    await commandeBornee("WebDriver:DeleteSession", {}, 5_000);
  } finally {
    socket?.destroy();
    firefox.kill("SIGTERM");
    await attendre(1_000);
    if (firefox.exitCode === null) firefox.kill("SIGKILL");
    await rm(profil, { recursive: true, force: true });
  }

  const median = durees.length
    ? [...durees].sort((a, b) => a - b)[Math.floor(durees.length / 2)]
    : 0;
  console.log("");
  console.log(`  navigations effectuées : ${faites}`);
  console.log(`  médiane : ${median} ms`);
  console.log(`FIREFOX_NATIVE_COOP_NAVIGATION_FAIL = ${echecs}`);
  console.log(`FIREFOX_NATIVE_COOP_HANG = ${blocages}`);

  const verdict = echecs === 0 && blocages === 0 && faites >= OBJECTIF;
  console.log(`FIREFOX_NATIVE_COOP_SMOKE = ${verdict ? "PASS" : "FAIL"}`);
  process.exit(verdict ? 0 : 1);
}

await main();
