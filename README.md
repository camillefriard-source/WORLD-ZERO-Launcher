# WORLD ZERO Launcher (prototype Windows)

Launcher Electron avec interface post-apocalyptique, authentification Microsoft via MSMC, installation de NeoForge, synchronisation d'un manifeste HTTPS et lancement via Minecraft Launcher Core.

## Ce que ce projet fait
- Connexion Microsoft par une fenêtre de connexion, sans demander ni enregistrer le mot de passe dans l'interface du launcher.
- Téléchargement de l'installateur NeoForge depuis le dépôt Maven officiel et tentative d'installation client dans une instance isolée.
- Mise à jour des fichiers listés dans un manifeste JSON HTTPS, vérifiés par SHA-256.
- Lancement du profil NeoForge avec Minecraft Launcher Core.
- Interface sombre, journal, paramètres, dossier d'instance et création d'un installateur Windows NSIS.

## Limites à connaître
C'est un prototype source, pas un binaire signé et pas encore un pack public prêt à distribuer. Le flux Microsoft dépend de MSMC (bibliothèque tierce) et des exigences actuelles des services Xbox/Minecraft. Il faut tester la connexion avec un compte qui possède Minecraft Java.
L'installation automatisée de NeoForge peut nécessiter un ajustement selon les changements de l'installateur NeoForge. Le launcher détecte le profil créé, mais doit être validé sur une installation Windows propre.
Le manifeste est vide par défaut : tu dois héberger les mods et fichiers du pack sur ton propre serveur HTTPS ou hébergeur de fichiers et remplir les SHA-256. Ne distribue pas les `.jar` des mods sans respecter leurs licences.
Le statut du serveur n'est pas testé automatiquement ; le champ affiche uniquement l'adresse configurée.
La session n'est conservée qu'en mémoire. Après fermeture du launcher, il faut se reconnecter.
Les ressources visuelles de fond utilisent une image distante Unsplash. Pour une version distribuée, remplace-la par une image que tu as le droit d'utiliser et embarque-la localement.

## Prérequis
- Windows 10/11 64 bits
- Node.js LTS (incluant npm)
- Java 21 installé et accessible avec la commande `java`
- Un compte Microsoft qui possède Minecraft Java Edition
- Une URL HTTPS pour héberger le manifeste et les fichiers du modpack

## Lancer en mode développeur
1. Décompresse le ZIP dans un dossier, par exemple `C:\WORLD-ZERO-Launcher`.
2. Installe Node.js LTS depuis le site officiel : https://nodejs.org/
3. Installe Java 21 depuis Microsoft OpenJDK ou Adoptium.
4. Ouvre le dossier du projet dans l'Explorateur.
5. Clique dans la barre d'adresse du dossier, tape `cmd`, puis Entrée.
6. Exécute :
   ```powershell
   npm install
   npm start
   ```
7. Clique sur ⚙ et configure l'URL HTTPS du manifeste.
8. Clique sur « Se connecter », puis utilise la fenêtre Microsoft.
9. Clique sur « Installer / réparer » pour installer NeoForge.
10. Clique sur « Mettre à jour le pack » pour synchroniser les fichiers, puis sur « Jouer ».

## Construire l'installateur Windows
Dans un terminal ouvert à la racine du projet :
```powershell
npm install
npm run dist
```
Le programme d'installation est produit dans `dist/` si la compilation se termine correctement.

## Manifeste du modpack
Utilise `pack-manifest.example.json` comme modèle. Exemple :
```json
{
  "name": "WORLD ZERO",
  "version": "0.1.0",
  "minecraft": "1.21.1",
  "loader": "NeoForge",
  "files": [
    {
      "path": "mods/nom-du-mod.jar",
      "url": "https://exemple.fr/fichiers/nom-du-mod.jar",
      "sha256": "64_CARACTERES_HEXADECIMAUX_REELS",
      "side": "client",
      "required": true
    }
  ]
}
```
Le champ `sha256` doit être le hash réel du fichier téléchargé, en SHA-256 hexadécimal. Le launcher refuse les URL non-HTTPS, les chemins qui sortent du dossier de l'instance et les fichiers sans hash. Il n'utilise pas le champ `side` pour filtrer actuellement : le manifeste doit donc ne contenir que les fichiers destinés au client.

Pour calculer le hash d'un fichier sous Windows :
```powershell
Get-FileHash .\nom-du-mod.jar -Algorithm SHA256
```

## Structure
- `src/main.js` : processus principal, auth, installateur NeoForge, téléchargement vérifié et lancement.
- `src/preload.js` : pont IPC limité et sécurisé.
- `src/index.html` : interface.
- `src/style.css` : thème graphique.
- `src/renderer.js` : actions de l'interface.
- `config.json` : configuration par défaut.
- `pack-manifest.example.json` : exemple de manifeste.

## Sécurité
- Le rendu Electron utilise `contextIsolation`, `sandbox` et `nodeIntegration: false`.
- Les URL de manifeste et de fichiers doivent être HTTPS.
- Le téléchargement vérifie les SHA-256 avant d'écrire les fichiers.
- Les chemins de destination sont contrôlés pour éviter les sorties du dossier d'instance.
- Le launcher n'est pas encore signé numériquement. Windows SmartScreen peut afficher un avertissement pour un programme que tu compiles toi-même.
- Ne demande jamais aux joueurs de t'envoyer leur mot de passe Microsoft ou leurs jetons d'authentification.

## Sources utiles
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- NeoForge client installation: https://docs.neoforged.net/user/docs/client/
- Minecraft Launcher Core: https://www.npmjs.com/package/minecraft-launcher-core
- MSMC: https://www.npmjs.com/package/msmc

## Icône et installateur Windows (.exe)

Le projet inclut l'icône `assets/world-zero.ico` (plusieurs tailles intégrées) et sa version PNG. Electron Builder utilise cette icône pour l'application, l'installateur et le désinstallateur. L'installateur crée un raccourci sur le Bureau et dans le menu Démarrer.

Depuis PowerShell, ouvre le dossier du projet puis lance :

```powershell
npm.cmd install
npm.cmd run dist
```

Si la compilation réussit, cherche `WORLD_ZERO_Launcher_Setup_1.0.0.exe` dans le dossier `dist` du projet. Le fichier `.exe` est créé sur ton PC au moment de cette compilation : ce ZIP contient le projet source et l'icône, pas un installateur déjà compilé. Une connexion Internet est nécessaire lors de l'installation des dépendances. Windows peut afficher un avertissement SmartScreen car l'installateur n'est pas signé numériquement.
