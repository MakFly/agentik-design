import type { HermesScenario } from "./types";

export const HERMES_SCENARIOS: HermesScenario[] = [
  {
    id: "artisan",
    label: "Artisan, dépannage et interventions",
    shortLabel: "Artisan",
    category: "Plomberie, électricité, serrurerie, maintenance",
    pain: "Les demandes arrivent par téléphone, SMS et formulaire, avec peu de qualification.",
    promise: "Qualifier, prioriser, préparer le devis et notifier l'équipe sans donner de réponse risquée.",
    trigger: "Nouvelle demande client ou message manqué",
    defaultRequest:
      "Un client signale une fuite sous évier ce matin. Il demande un passage rapide, budget serré, adresse à confirmer.",
    tools: ["CRM léger", "Planning", "Modèle de devis", "Base tarifs"],
    automations: ["Qualification urgence", "Créneau proposé", "Brouillon devis", "Relance client"],
    approvalPolicy: "Validation humaine avant devis, déplacement coûteux ou promesse horaire ferme.",
    memoryPolicy: "Retenir uniquement préférences client, zones desservies et contraintes de tarif.",
    notify: ["Discord ops", "Telegram terrain"],
  },
  {
    id: "restaurant",
    label: "Restaurant et commerce local",
    shortLabel: "Restaurant",
    category: "Restaurant, traiteur, coffee shop, commerce de proximité",
    pain: "Avis, réservations, ruptures et demandes privées se mélangent dans la journée.",
    promise: "Trier les priorités, proposer une réponse et remonter les cas qui touchent la réputation.",
    trigger: "Avis client, message Instagram ou demande de réservation",
    defaultRequest:
      "Avis Google 2 étoiles: attente longue samedi soir, client contrarié, possible erreur sur addition.",
    tools: ["Boîte messages", "Planning salle", "Catalogue offres", "Base réponses"],
    automations: ["Résumé avis", "Réponse proposée", "Escalade réputation", "Bon geste commercial"],
    approvalPolicy: "Validation avant publication publique ou geste commercial supérieur à 20 euros.",
    memoryPolicy: "Retenir allergies, préférences VIP et incidents résolus, jamais les données carte.",
    notify: ["Discord direction", "Telegram manager"],
  },
  {
    id: "clinic",
    label: "Cabinet santé, bien-être et rendez-vous",
    shortLabel: "Cabinet",
    category: "Cabinet médical non urgent, kiné, dentaire, esthétique, bien-être",
    pain: "Le secrétariat perd du temps sur rendez-vous, documents et rappels non cliniques.",
    promise: "Préparer la réponse administrative, détecter l'urgence et imposer une validation stricte.",
    trigger: "Demande de rendez-vous, annulation ou document",
    defaultRequest:
      "Patiente demande un rendez-vous plus tôt et joint un message anxieux. Elle ne décrit pas d'urgence vitale.",
    tools: ["Agenda", "FAQ cabinet", "Rappels SMS", "Dossier administratif"],
    automations: ["Triage non médical", "Créneaux possibles", "Rappel document", "Alerte urgence"],
    approvalPolicy: "Toujours valider les réponses sensibles, aucun diagnostic ni conseil médical.",
    memoryPolicy: "Retenir préférences de rendez-vous et documents manquants, pas de données médicales détaillées.",
    notify: ["Discord secrétariat", "Telegram praticien"],
  },
  {
    id: "real-estate",
    label: "Immobilier et gestion locative",
    shortLabel: "Immobilier",
    category: "Agence, syndic, gestion locative, conciergerie",
    pain: "Les prospects et incidents locataires demandent qualification, pièces et suivi rapide.",
    promise: "Classer l'urgence, demander les pièces utiles, préparer le compte-rendu et l'escalade.",
    trigger: "Nouveau lead, incident locataire ou demande propriétaire",
    defaultRequest:
      "Locataire signale panne de chauffe-eau avec photos. Propriétaire veut être informé si le devis dépasse 300 euros.",
    tools: ["CRM biens", "Tickets incidents", "Prestataires", "Modèle compte-rendu"],
    automations: ["Qualification incident", "Demande pièces", "Assignation prestataire", "Compte-rendu"],
    approvalPolicy: "Validation avant engagement prestataire, devis ou message propriétaire sensible.",
    memoryPolicy: "Retenir biens, seuils d'approbation et prestataires autorisés.",
    notify: ["Discord gestion", "Telegram astreinte"],
  },
  {
    id: "retail",
    label: "E-commerce et retail PME",
    shortLabel: "Retail",
    category: "Boutique en ligne, retail spécialisé, SAV produit",
    pain: "Le SAV répétitif masque les commandes à risque et les opportunités de fidélisation.",
    promise: "Résumer le dossier, proposer action SAV, détecter remboursement ou litige à valider.",
    trigger: "Ticket SAV, retard livraison ou demande de retour",
    defaultRequest:
      "Cliente fidèle demande retour hors délai après retard transport. Elle menace de laisser un avis négatif.",
    tools: ["Shop", "Transporteur", "Politique retours", "Historique client"],
    automations: ["Statut commande", "Politique applicable", "Réponse SAV", "Escalade remboursement"],
    approvalPolicy: "Validation avant remboursement, avoir ou exception commerciale.",
    memoryPolicy: "Retenir historique relationnel et préférences, jamais données de paiement.",
    notify: ["Discord SAV", "Telegram responsable"],
  },
  {
    id: "services",
    label: "Services B2B et agences",
    shortLabel: "Services B2B",
    category: "Agence, conseil, expert-comptable, service récurrent",
    pain: "Les demandes clients dispersées deviennent des tâches floues sans propriétaire clair.",
    promise: "Transformer un message en brief actionnable, assigner, préparer réponse et suivi.",
    trigger: "Email client, demande Slack ou compte-rendu réunion",
    defaultRequest:
      "Client PME demande un point urgent sur retard de livrable, veut un plan clair avant demain matin.",
    tools: ["CRM", "Gestion tâches", "Base projet", "Modèle email"],
    automations: ["Brief synthétique", "Plan d'action", "Assignation", "Réponse client"],
    approvalPolicy: "Validation avant promesse de délai, budget ou changement de périmètre.",
    memoryPolicy: "Retenir contexte projet, décideurs et préférences de reporting.",
    notify: ["Discord projet", "Telegram account manager"],
  },
];

export function getScenario(id: string): HermesScenario {
  return HERMES_SCENARIOS.find((scenario) => scenario.id === id) ?? HERMES_SCENARIOS[0];
}
