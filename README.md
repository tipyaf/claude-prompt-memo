# prompt-memo

Un mod Claude Code qui garde, pour chaque session, une liste de prompts à lancer plus tard. Le mémo s'affiche en permanence juste au-dessus du champ de chat.

## Fonctionnement

- **Ajouter** : écris ou colle un prompt (plusieurs lignes possibles) dans le champ du mémo, puis Entrée ou `+`.
- **Commandes et skills** : comme dans le chat, taper `/` dans le champ du mémo liste les commandes et skills disponibles, filtrés au fil de la frappe. Clic sur une ligne pour compléter. Quand le champ ne contient qu'un début de nom (`/rev`), la suggestion surlignée est celle qu'Entrée (ou `⇥` à la place de `+`) prend : la première commande qui commence ainsi ; un skill de plugin se trouve aussi par le début de son nom court (`/code-rev` ou `/code-review` devient `/engineering:code-review`, après les commandes dont le nom complet commence ainsi), tandis qu'un nom complet tapé en entier est ajouté tel quel ; un `/mot` plus loin dans le texte (un chemin, par exemple) n'empêche pas Entrée d'ajouter le prompt. Seul le `/mot` en fin de texte est complété : le champ ne donne pas la position du curseur.
- **Actions par item** :
  - `↑ envoyer` lance le prompt dans le chat et le retire du mémo ;
  - `↵ insérer` le colle dans la zone de saisie, au curseur ;
  - `✎` le remet dans le champ pour le modifier (`✓` pour enregistrer, `Annuler` pour abandonner) ;
  - `✕` le supprime.
- **Clic** sur un item : le sélectionne (○ / ●). Avec une sélection, l'en-tête propose **Insérer** et **Envoyer** pour plusieurs prompts à la fois, séparés par une ligne vide.
- **Double-clic** sur un item : l'insère dans le chat et le retire du mémo.
- **Prompts longs** : une seule ligne, coupée avec `…`, pour que les actions restent visibles. `▸` / `▾` déplie ou replie le texte complet.
- **Replier / déplier** le mémo entier avec `▾ Mémo` dans l'en-tête.

Chaque session a son propre mémo : une nouvelle session ou un `/clear` repart d'une liste vide. Le mémo est gardé tant que l'app tourne, pas après un redémarrage.

## Installation

À l'invite d'une session Claude Code dans un terminal :

```
/plugin install prompt-memo --marketplace tipyaf/claude-prompt-memo
```

Réponds `y` pour ajouter la marketplace, puis choisis la portée de l'installation.

Depuis un shell :

```bash
claude plugin install prompt-memo --marketplace tipyaf/claude-prompt-memo
```

## Développement

```bash
claude --plugin-dir /chemin/vers/claude-prompt-memo
claude plugin validate .
claude plugin test .
```
