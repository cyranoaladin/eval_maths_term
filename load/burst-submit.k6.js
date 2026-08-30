/**
 * load/burst-submit.k6.js
 *
 * Test de résistance : deux cents copies rendues au même instant.
 *
 * Ce n'est **pas** le test d'acceptation du critère 20 — celui-ci est
 * `load/acceptance-200.k6.js`. Une salle d'examen ne rend pas deux cents copies
 * dans la même milliseconde ; ce scénario mesure une limite de capacité en
 * pointe extrême, utile à connaître et documentée comme telle.
 *
 * Il sert aussi de courbe de contention : le même geste à des niveaux
 * croissants de simultanéité dit si le système sature progressivement ou
 * s'effondre à un palier.
 *
 *   docker run --rm -i --network host -e VUS=50 -e ETALEMENT=0 \
 *     grafana/k6 run - < load/courbe-contention.k6.js
 *
 * ETALEMENT : secondes sur lesquelles répartir les remises. 0 = toutes dans la
 * même seconde (variante A), quelques secondes = arrivée réaliste (variante B).
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const VUS = Number(__ENV.VUS || 200);
const ETALEMENT = Number(__ENV.ETALEMENT || 0);
const EVALUATION_ID = Number(__ENV.EVALUATION_ID || 1);

const dureeRemise = new Trend("remise", true);
const echec = new Rate("echec_metier");
const remises = new Counter("remises");

export const options = {
  scenarios: {
    palier: { executor: "per-vu-iterations", vus: VUS, iterations: 1, maxDuration: "5m" },
  },
  summaryTrendStats: ["min", "med", "p(50)", "p(90)", "p(95)", "p(99)", "max", "avg"],
  thresholds: { echec_metier: ["rate<0.01"] },
};

const enTetes = { "Content-Type": "application/json", Origin: BASE };

function mutation(chemin, entree, jeton) {
  const h = { ...enTetes };
  if (jeton) h["x-student-session-token"] = jeton;
  return http.post(`${BASE}/api/trpc/${chemin}`, JSON.stringify({ json: entree }), {
    headers: h, tags: { operation: chemin },
  });
}

function query(chemin, jeton) {
  const h = { ...enTetes };
  if (jeton) h["x-student-session-token"] = jeton;
  return http.get(`${BASE}/api/trpc/${chemin}`, { headers: h, tags: { operation: chemin } });
}

const donnees = (r) => {
  try { return JSON.parse(r.body)?.result?.data?.json ?? null; } catch { return null; }
};

export default function () {
  const start = mutation("session.start", {
    evaluationId: EVALUATION_ID,
    studentName: `Palier ${VUS}-${__VU}`,
  });
  const session = donnees(start);
  if (!session?.sessionToken) { echec.add(true); return; }
  const jeton = session.sessionToken;

  const qs = donnees(query("question.getForActiveSession", jeton));
  if (!Array.isArray(qs) || qs.length === 0) { echec.add(true); return; }

  // Toutes les copies convergent vers le même instant : c'est la fin d'épreuve,
  // le moment où tout le monde rend en même temps.
  if (ETALEMENT > 0) sleep((__VU % (ETALEMENT * 10)) / 10);

  const t0 = Date.now();
  const submit = mutation("session.submit", {
    answers: qs.map((q) => ({
      questionId: q.id,
      answer: q.type === "qcm" ? "0" : q.type === "true_false" ? "true" : "2",
    })),
    timeSpent: 300,
  }, jeton);
  dureeRemise.add(Date.now() - t0);

  const resultat = donnees(submit);
  const ok = submit.status === 200 && resultat?.success === true;
  check(submit, { "copie remise": () => ok });
  echec.add(!ok);
  if (ok) remises.add(1);
}
