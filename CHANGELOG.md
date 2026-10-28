# Changelog

Les versions suivent le champ `version` de `.claude-plugin/plugin.json`. Une installation existante récupère une nouvelle version avec `claude plugin update prompt-memo`.

## 0.3.0

### Modifié
- Les suggestions de commandes et skills s'ouvrent juste au-dessus de la ligne du champ, par-dessus l'en-tête et les prompts du mémo, comme la liste du chat. Le mémo ne grandit que des lignes qui manquent quand il en a trop peu.

## 0.2.0

### Ajouté
- Taper `/` dans le champ du mémo liste les commandes et skills disponibles (la même liste que le chat), filtrés au fil de la frappe : clic pour compléter ; Entrée complète un début de nom seul dans le champ (le bouton `+` devient `→`).
- Les commandes et skills de plugin se trouvent aussi par leur nom court (`/code-review` → `/engineering:code-review`).

### Corrigé
- Après une complétion, la frappe suivante va à la fin du texte et non plus au milieu du mot complété.

## 0.1.0

- Première version : mémo de prompts par session au-dessus du champ de chat (ajouter, envoyer, insérer, modifier, supprimer, sélection multiple, prompts longs repliés).
