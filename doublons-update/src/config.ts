import { type ImmutableObject } from 'seamless-immutable'

// Configuration du widget. On garde une structure minimale : le nom du
// champ à mettre à jour et la valeur cible sont paramétrables ici pour
// éviter de les coder en dur dans le widget si jamais le nom du champ
// change un jour.
export interface Config {
  fieldName: string   // nom du champ à mettre à jour, ex: "Doublons"
  fieldValue: string  // valeur à appliquer, ex: "OUI"
}

export type IMConfig = ImmutableObject<Config>
