/**
 * load/acceptance-200.k6.js
 *
 * Test d'acceptation du critère 20 de PLAN.md :
 * « k6 : 200 élèves concurrents, p95 < 500 ms, 0 erreur. »
 *
 * Deux cents élèves composent **en même temps** : chacun ouvre sa session, lit
 * ses énoncés, enregistre ses brouillons au fil de sa réflexion, signale sa
 * présence, puis rend sa copie. Ils sont tous actifs simultanément du début à
 * la fin du scénario.
 *
 * Ce qui n'est pas fait, délibérément : synchroniser les deux cents remises sur
 * la même milliseconde. Une salle d'examen ne se comporte pas ainsi, et ce
 * serait mesurer autre chose que ce que le critère demande. Ce cas extrême est
 * couvert à part par `load/burst-submit.k6.js`, comme limite de capacité
 * connue.
 *
 * Le décalage entre élèves est **déterministe** — dérivé du numéro
 * d'utilisateur virtuel — pour que deux exécutions soient comparables.
 *
 *   docker run --rm -i --network host -e BASE_URL=http://localhost:3000 \
 *     grafana/k6 run - < load/acceptance-200.k6.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const VUS = Number(__ENV.VUS || 200);
const EVALUATION_ID = Number(__ENV.EVALUATION_ID || 1);

/** Durée de composition avant de rendre, en secondes. */
const COMPOSITION_S = Number(__ENV.COMPOSITION_S || 20);
/** Étendue du décalage entre élèves, en secondes. */
const ETALEMENT_S = Number(__ENV.ETALEMENT_S || 15);

const dureeRemise = new Trend("remise", true);
const echecMetier = new Rate("echec_metier");
const remises = new Counter("remises");
const sessionsOuvertes = new Counter("sessions_ouvertes");
const refusQuota = new Counter("refus_quota_429");

export const options = {
  scenarios: {
    salle_examen: {
      executor: "per-vu-iterations",
      vus: VUS,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  summaryTrendStats: ["min", "med", "p(50)", "p(90)", "p(95)", "p(99)", "max", "avg"],
  thresholds: {
    // Le seuil contractuel, sur l'ensemble des requêtes.
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate==0"],
    echec_metier: ["rate==0"],
    refus_quota_429: ["count==0"],
  },
};

const enTetes = { "Content-Type": "application/json", Origin: BASE };

function requete(methode, chemin, entree, jeton) {
  const h = { ...enTetes };
  if (jeton) h["x-student-session-token"] = jeton;
  const tags = { operation: chemin };
  if (methode === "GET") {
    const url = entree
      ? `${BASE}/api/trpc/${chemin}?input=${encodeURIComponent(JSON.stringify({ json: entree }))}`
      : `${BASE}/api/trpc/${chemin}`;
    return http.get(url, { headers: h, tags });
  }
  return http.post(`${BASE}/api/trpc/${chemin}`, JSON.stringify({ json: entree }), {
    headers: h,
    tags,
  });
}

const donnees = (r) => {
  try {
    return JSON.parse(r.body)?.result?.data?.json ?? null;
  } catch {
    return null;
  }
};

/** Décalage propre à chaque élève, reproductible d'une exécution à l'autre. */
function decalage() {
  // Un pas premier réparti les élèves sans les regrouper par paquets.
  return ((__VU * 37) % (ETALEMENT_S * 10)) / 10;
}

export default function () {
  // Entrée en salle : tout le monde ne clique pas à la même seconde.
  sleep(decalage() / 3);

  const info = requete("GET", "question.getPublicInfo", { evaluationId: EVALUATION_ID });
  check(info, { "informations publiques": (r) => r.status === 200 });

  const start = requete("POST", "session.start", {
    evaluationId: EVALUATION_ID,
    studentName: `Acceptation ${__VU}`,
  });
  if (start.status === 429) {
    refusQuota.add(1);
    echecMetier.add(true);
    return;
  }
  const session = donnees(start);
  if (!session?.sessionToken) {
    echecMetier.add(true);
    return;
  }
  sessionsOuvertes.add(1);
  const jeton = session.sessionToken;

  const qs = donnees(requete("GET", "question.getForActiveSession", null, jeton));
  if (!Array.isArray(qs) || qs.length === 0) {
    echecMetier.add(true);
    return;
  }

  // Composition : l'élève réfléchit, écrit, revient sur ses réponses. Un
  // battement de présence part régulièrement, comme dans le navigateur.
  const reponses = qs.map((q) => ({
    questionId: q.id,
    answer: q.type === "qcm" ? "0" : q.type === "true_false" ? "true" : "2",
  }));
  const pas = COMPOSITION_S / 8;
  for (let i = 0; i < 6; i++) {
    const q = qs[i % qs.length];
    requete("POST", "answer.saveDraft", {
      questionId: q.id,
      answer: q.type === "qcm" ? "0" : q.type === "true_false" ? "true" : "2",
    }, jeton);
    if (i % 2 === 1) {
      requete("POST", "session.heartbeat", {
        clientTime: Date.now(),
        focused: true,
        currentQuestionIndex: i,
        fingerprintHash: `acceptation-${__VU}`,
      }, jeton);
    }
    sleep(pas);
  }

  // Fin de composition : les copies ne partent pas toutes au même instant.
  sleep(decalage());

  const t0 = Date.now();
  const submit = requete("POST", "session.submit", { answers: reponses, timeSpent: 900 }, jeton);
  dureeRemise.add(Date.now() - t0);

  const resultat = donnees(submit);
  const ok = submit.status === 200 && resultat?.success === true;
  check(submit, { "copie remise": () => ok });
  echecMetier.add(!ok);
  if (ok) remises.add(1);
}
