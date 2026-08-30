import { Link } from "react-router";
import { coordonnees, aCompleter } from "./config";
import { AlertTriangle, ArrowLeft } from "lucide-react";

function Champ({ libelle, valeur }: { libelle: string; valeur: string | null }) {
  return (
    <p>
      <span className="font-medium">{libelle} : </span>
      {valeur ?? (
        <span className="text-amber-700 italic">à compléter par l'établissement</span>
      )}
    </p>
  );
}

export default function MentionsLegales() {
  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link to="/" className="inline-flex items-center text-sm text-slate-600 hover:underline">
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Retour à l'accueil
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">Mentions légales</h1>

        {aCompleter && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Certaines informations n'ont pas été renseignées au déploiement.
              Elles se configurent par les variables <code>VITE_ETABLISSEMENT</code>,{" "}
              <code>VITE_ETABLISSEMENT_ADRESSE</code>, <code>VITE_DIRECTEUR_PUBLICATION</code>,{" "}
              <code>VITE_CONTACT_DONNEES</code> et <code>VITE_HEBERGEUR</code>.
            </span>
          </div>
        )}

        <section className="space-y-2 text-sm text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">Éditeur</h2>
          <Champ libelle="Établissement" valeur={coordonnees.etablissement} />
          <Champ libelle="Adresse" valeur={coordonnees.adresse} />
          <Champ libelle="Directeur de la publication" valeur={coordonnees.directeurPublication} />
          <Champ libelle="Contact" valeur={coordonnees.contact} />
        </section>

        <section className="space-y-2 text-sm text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">Hébergement</h2>
          <Champ libelle="Hébergeur" valeur={coordonnees.hebergeur} />
        </section>

        <section className="space-y-2 text-sm text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">Objet du service</h2>
          <p>
            Cette application sert à rédiger, imprimer et corriger des évaluations
            à destination des élèves de l'établissement. Elle est réservée aux
            enseignants et aux élèves concernés.
          </p>
        </section>

        <section className="space-y-2 text-sm text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">Données personnelles</h2>
          <p>
            Le traitement des données est décrit sur la page{" "}
            <Link to="/confidentialite" className="text-blue-700 underline underline-offset-2">
              confidentialité
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
