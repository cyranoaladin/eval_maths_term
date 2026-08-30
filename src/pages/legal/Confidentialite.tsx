import { Link } from "react-router";
import { coordonnees } from "./config";
import { ArrowLeft } from "lucide-react";

export default function Confidentialite() {
  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link to="/" className="inline-flex items-center text-sm text-slate-600 hover:underline">
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Retour à l'accueil
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">
          Protection des données personnelles
        </h1>

        <section className="space-y-2 text-sm text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">Ce qui est enregistré</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Identité</strong> : nom, prénom, et adresse électronique si
              elle figure dans la liste importée par l'enseignant.
            </li>
            <li>
              <strong>Copies et notes</strong> : réponses données, points obtenus,
              commentaires de correction.
            </li>
            <li>
              <strong>Épreuves en ligne uniquement</strong> : adresse IP,
              caractéristiques du navigateur sous forme d'empreinte, et
              événements de surveillance (changements d'onglet, copier-coller).
              Ces éléments ne sont pas collectés pour les épreuves sur papier.
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-sm text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">Pourquoi</h2>
          <p>
            Organiser les évaluations, les corriger, restituer les résultats, et
            garantir l'équité des épreuves passées en ligne. Aucune donnée n'est
            utilisée à des fins commerciales ni cédée à un tiers.
          </p>
        </section>

        <section className="space-y-2 text-sm text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">Sous-traitants</h2>
          <p>
            Lorsque la correction assistée est activée, la <em>réponse rédigée</em>{" "}
            d'un élève est transmise au service d'intelligence artificielle
            configuré par l'établissement, afin d'être évaluée.{" "}
            <strong>Ni le nom ni aucune autre donnée identifiante n'accompagne
            cette transmission.</strong> La rédaction assistée de questions, elle,
            ne transmet aucune donnée d'élève : elle porte sur un thème du programme.
          </p>
        </section>

        <section className="space-y-2 text-sm text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">Durée de conservation</h2>
          <p>
            Les copies et les notes sont conservées le temps requis par
            l'établissement pour le suivi de la scolarité. Les données de
            surveillance des épreuves en ligne n'ont d'utilité que le temps de
            statuer sur l'épreuve concernée.
          </p>
        </section>

        <section className="space-y-2 text-sm text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">Vos droits</h2>
          <p>
            Vous pouvez demander l'accès à vos données, leur rectification, ou
            leur effacement. L'enseignant responsable de la classe peut produire
            un export complet depuis l'application.
          </p>
          <p>
            L'effacement prend la forme d'une <strong>anonymisation</strong> :
            l'identité est retirée, les résultats de l'évaluation sont conservés,
            l'établissement étant tenu de garder trace des évaluations rendues.
            Après cette opération, plus aucune donnée ne permet de vous identifier.
          </p>
          <p>
            {coordonnees.contact ? (
              <>
                Pour exercer ces droits :{" "}
                <span className="font-medium">{coordonnees.contact}</span>
              </>
            ) : (
              <span className="text-amber-700 italic">
                Adresse de contact à compléter par l'établissement.
              </span>
            )}
          </p>
        </section>

        <p className="text-xs text-slate-500 pt-2">
          Voir aussi les{" "}
          <Link to="/mentions-legales" className="text-blue-700 hover:underline">
            mentions légales
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
