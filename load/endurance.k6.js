/**
 * load/endurance.k6.js
 *
 * Test d'endurance : la même charge, longtemps.
 *
 * Ce que cherche ce scénario n'est pas une latence — l'acceptation s'en charge
 * — mais une dérive. Une fuite de mémoire, un pool qui ne rend pas ses
 * connexions, un compteur qui grossit sans jamais être vidé : rien de tout cela
 * ne se voit en cinq minutes. Une épreuve dure deux heures, et un serveur
 * d'établissement tourne des semaines entre deux redémarrages.
 *
 * La cadence est volontairement modeste et **constante** : une session par
 * seconde, soit trois mille six cents copies en une heure. Ce n'est pas une
 * pointe, c'est un régime. Ce qu'on regarde est la pente, pas le niveau.
 *
 *   docker run --rm -i --network host -e BASE_URL=http://localhost:3000 \
 *     -e DUREE=30m grafana/k6 run - < load/endurance.k6.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const EVALUATION_ID = Number(__ENV.EVALUATION_ID || 1);
const DUREE = __ENV.DUREE || "30m";
const CADENCE = Number(__ENV.CADENCE || 1);
/** Durée de composition d'un élève, en secondes. */
const COMPOSITION_S = Number(__ENV.COMPOSITION_S || 10);

const dureeRemise = new Trend("remise", true);
const echecMetier = new Rate("echec_metier");
const remises = new Counter("remises");
const refusQuota = new Counter("refus_quota_429");

export const options = {
  scenarios: {
    regime_soutenu: {
      executor: "constant-arrival-rate",
      rate: CADENCE,
      timeUnit: "1s",
      duration: DUREE,
      preAllocatedVUs: 40,
      maxVUs: 120,
    },
  },
  summaryTrendStats: ["min", "med", "p(90)", "p(95)", "p(99)", "max", "avg"],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate==0"],
    echec_metier: ["rate==0"],
    refus_quota_429: ["count==0"],
  },
};

function requete(methode, chemin, corps, jeton) {
  const entetes = { "Content-Type": "application/json", Origin: BASE };
  if (jeton) entetes["x-student-session-token"] = jeton;
  const url = `${BASE}/api/trpc/${chemin}`;
  const r =
    methode === "GET"
      ? http.get(`${url}?input=${encodeURIComponent(JSON.stringify({ json: corps }))}`, {
          headers: entetes,
        })
      : http.post(url, JSON.stringify({ json: corps }), { headers: entetes });
  if (r.status === 429) refusQuota.add(1);
  return r;
}

function donnees(reponse) {
  try {
    return JSON.parse(reponse.body)?.result?.data?.json;
  } catch {
    return null;
  }
}

export default function () {
  const nom = `Endurance ${__VU}-${__ITER}`;

  const ouverture = requete("POST", "session.start", {
    evaluationId: EVALUATION_ID,
    studentName: nom,
  });
  const session = donnees(ouverture);
  if (!session?.sessionToken) {
    echecMetier.add(true);
    return;
  }
  const jeton = session.sessionToken;

  const qs = donnees(requete("GET", "question.getForActiveSession", {}, jeton));
  if (!Array.isArray(qs) || qs.length === 0) {
    echecMetier.add(true);
    return;
  }

  const reponses = qs.map((q) => ({
    questionId: q.id,
    answer: q.type === "qcm" ? "0" : q.type === "true_false" ? "true" : "2",
  }));

  const pas = COMPOSITION_S / 6;
  for (let i = 0; i < 4; i += 1) {
    const q = qs[i % qs.length];
    requete("POST", "answer.saveDraft", { questionId: q.id, answer: reponses[i % qs.length].answer }, jeton);
    if (i % 2 === 1) {
      requete("POST", "session.heartbeat", {
        clientTime: Date.now(),
        focused: true,
        currentQuestionIndex: i,
        fingerprintHash: `endurance-${__VU}`,
      }, jeton);
    }
    sleep(pas);
  }

  const t0 = Date.now();
  const submit = requete("POST", "session.submit", { answers: reponses, timeSpent: 600 }, jeton);
  dureeRemise.add(Date.now() - t0);

  const resultat = donnees(submit);
  const ok = submit.status === 200 && resultat?.success === true;
  check(submit, { "copie remise": () => ok });
  echecMetier.add(!ok);
  if (ok) remises.add(1);
}
