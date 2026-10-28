const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let minecraftProcess = null;
let xboxSession = null;
let minecraftAccount = null;
let launchBusy = false;

const configPath = path.join(app.getPath('userData'), 'config.json');
const instanceRoot = path.join(app.getPath('userData'), 'instance');
const managedPath = path.join(instanceRoot, '.worldzero-managed.json');
const defaultConfig = require('../config.json');

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
function log(message, kind = 'info') {
  const safe = String(message).slice(0, 1200);
  send('log', { message: safe, kind, time: new Date().toLocaleTimeString('fr-FR') });
}
function readConfig() {
  try { return { ...defaultConfig, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }; }
  catch { return { ...defaultConfig }; }
}
function writeConfig(value) {
  const merged = { ...defaultConfig, ...value };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 760, minWidth: 900, minHeight: 620,
    backgroundColor: '#0b0e0d',
    title: 'WORLD ZERO',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}
function configureAutoUpdates() {
  if (!app.isPackaged) return;

  // GitHub Releases doit contenir latest.yml et les fichiers produits par electron-builder.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log('Recherche de mises à jour du launcher…');
  });
  autoUpdater.on('update-available', info => {
    log(`Mise à jour ${info.version} trouvée. Téléchargement en cours…`);
  });
  autoUpdater.on('update-not-available', () => {
    log('WORLD ZERO Launcher est à jour.', 'success');
  });
  autoUpdater.on('download-progress', progress => {
    send('progress', {
      value: Math.round(progress.percent || 0),
      label: `Mise à jour du launcher : ${Math.round(progress.percent || 0)} %`
    });
  });
  autoUpdater.on('update-downloaded', async info => {
    log(`Mise à jour ${info.version} téléchargée.`, 'success');
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Mise à jour WORLD ZERO disponible',
      message: `La version ${info.version} est prête à être installée.`,
      detail: 'Enregistre ta partie et ferme Minecraft avant de redémarrer le launcher.',
      buttons: ['Redémarrer et installer', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (result.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', error => {
    // Une erreur de mise à jour ne doit pas empêcher le launcher de démarrer.
    log(`Mise à jour impossible : ${error.message}`, 'warn');
  });

  // Ne bloque pas le démarrage si GitHub est inaccessible.
  autoUpdater.checkForUpdates().catch(error => {
    log(`Vérification des mises à jour impossible : ${error.message}`, 'warn');
  });
}

app.whenReady().then(() => {
  createWindow();
  configureAutoUpdates();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function httpsGet(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { reject(new Error('URL invalide')); return; }
    if (parsed.protocol !== 'https:') { reject(new Error('Seules les URL HTTPS sont autorisées.')); return; }
    const req = https.get(parsed, { headers: { 'User-Agent': 'WORLD-ZERO-Launcher/0.1' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, parsed).toString();
        httpsGet(next, redirects - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume(); reject(new Error(`Téléchargement refusé (HTTP ${res.statusCode}).`)); return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.setTimeout(30000, () => req.destroy(new Error('Délai dépassé pendant le téléchargement.')));
    req.on('error', reject);
  });
}
async function downloadTo(url, destination, expectedSha256) {
  const { body } = await httpsGet(url);
  if (body.length > 1024 * 1024 * 1024) throw new Error('Fichier trop volumineux (limite 1 Go).');
  if (expectedSha256) {
    const actual = crypto.createHash('sha256').update(body).digest('hex').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedSha256) || actual !== expectedSha256.toLowerCase()) {
      throw new Error(`Le contrôle SHA-256 a échoué pour ${path.basename(destination)}.`);
    }
  }
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temp = destination + '.download';
  await fsp.writeFile(temp, body);
  await fsp.rename(temp, destination);
  return body.length;
}
function safeTarget(relative) {
  if (typeof relative !== 'string' || !relative.trim()) throw new Error('Chemin de fichier absent dans le manifeste.');
  const normalized = relative.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.split('/').some(p => p === '..' || p === '.')) {
    throw new Error(`Chemin interdit dans le manifeste : ${relative}`);
  }
  const target = path.resolve(instanceRoot, normalized);
  if (!target.startsWith(path.resolve(instanceRoot) + path.sep)) throw new Error('Chemin de fichier non autorisé.');
  return target;
}
async function readManifest() {
  const cfg = readConfig();
  if (!cfg.modpackManifestUrl) throw new Error('Configure d’abord l’URL HTTPS du manifeste du modpack dans Paramètres.');
  const { body } = await httpsGet(cfg.modpackManifestUrl);
  let manifest;
  try { manifest = JSON.parse(body.toString('utf8')); }
  catch { throw new Error('Le manifeste reçu n’est pas un JSON valide.'); }
  if (!manifest || !Array.isArray(manifest.files)) throw new Error('Le manifeste doit contenir une liste "files".');
  if (manifest.minecraft && manifest.minecraft !== cfg.minecraftVersion) {
    throw new Error(`Le manifeste vise Minecraft ${manifest.minecraft}, mais le launcher est configuré pour ${cfg.minecraftVersion}.`);
  }
  for (const file of manifest.files) {
    if (!file.url || !file.path || !/^https:\/\//i.test(file.url)) throw new Error('Chaque fichier doit avoir un chemin et une URL HTTPS.');
    safeTarget(file.path);
    if (!file.sha256 || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
      throw new Error(`SHA-256 manquant ou invalide dans le manifeste : ${file.path}`);
    }
  }
  return manifest;
}
async function updateModpack() {
  const manifest = await readManifest();
  const old = (() => { try { return JSON.parse(fs.readFileSync(managedPath, 'utf8')); } catch { return { files: [] }; } })();
  const oldPaths = new Set((old.files || []).map(f => f.path));
  const nextPaths = new Set(manifest.files.map(f => f.path));
  await fsp.mkdir(instanceRoot, { recursive: true });
  let done = 0;
  const total = manifest.files.length;
  send('progress', { value: 0, label: 'Vérification du modpack…' });
  for (const item of manifest.files) {
    const target = safeTarget(item.path);
    let valid = false;
    try {
      const data = await fsp.readFile(target);
      valid = crypto.createHash('sha256').update(data).digest('hex').toLowerCase() === item.sha256.toLowerCase();
    } catch {}
    if (!valid) {
      log(`Téléchargement : ${item.path}`);
      await downloadTo(item.url, target, item.sha256);
    } else {
      log(`À jour : ${item.path}`);
    }
    done++;
    send('progress', { value: total ? Math.round(done / total * 100) : 100, label: `Modpack : ${done}/${total}` });
  }
  // Supprime seulement les fichiers gérés par la version précédente du launcher.
  for (const previous of oldPaths) {
    if (!nextPaths.has(previous)) {
      try { await fsp.unlink(safeTarget(previous)); log(`Ancien fichier supprimé : ${previous}`); } catch {}
    }
  }
  await fsp.writeFile(managedPath, JSON.stringify({ version: manifest.version || 'inconnue', files: manifest.files.map(f => ({ path: f.path, sha256: f.sha256 })) }, null, 2));
  log(`Modpack ${manifest.name || 'WORLD ZERO'} ${manifest.version || ''} prêt.`, 'success');
  return manifest;
}
function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stderr = '';
    child.stdout?.on('data', d => log(d.toString().trim()));
    child.stderr?.on('data', d => { stderr += d.toString(); log(d.toString().trim(), 'warn'); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Le programme s’est terminé avec le code ${code}. ${stderr.slice(-500)}`)));
  });
}
async function checkJava() {
  try {
    await runProcess('java', ['-version']);
    return true;
  } catch {
    throw new Error('Java n’a pas été trouvé. Installe Java 21 (Microsoft OpenJDK ou Adoptium), puis relance le launcher.');
  }
}
async function latestNeoForgeInstaller(mcVersion, branch) {
  const { body } = await httpsGet('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
  const xml = body.toString('utf8');
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
  const candidates = versions.filter(v => v.startsWith(branch + '.') && v.includes('.')).filter(v => {
    // NeoForge 1.21.x uses the 21.1.x branch; config keeps MC and branch separate.
    return true;
  });
  if (!candidates.length) throw new Error(`Aucune version NeoForge trouvée pour la branche ${branch}.`);
  const version = candidates[candidates.length - 1];
  return { version, url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar` };
}
async function installNeoForge() {
  const cfg = readConfig();
  await checkJava();
  await fsp.mkdir(instanceRoot, { recursive: true });
  const info = await latestNeoForgeInstaller(cfg.minecraftVersion, cfg.neoforgeBranch);
  const installer = path.join(app.getPath('userData'), `neoforge-${info.version}-installer.jar`);
  log(`Téléchargement de l’installateur NeoForge ${info.version}…`);
  await downloadTo(info.url, installer);
  log('Installation de NeoForge dans l’instance WORLD ZERO…');
  await runProcess('java', ['-jar', installer, '--installClient', '--gameDir', instanceRoot]);
  const versionsDir = path.join(instanceRoot, 'versions');
  let found = null;
  try {
    const names = await fsp.readdir(versionsDir);
    const candidates = names.filter(n => n.toLowerCase().includes('neoforge') && n.includes(cfg.minecraftVersion));
    if (candidates.length) found = candidates[candidates.length - 1];
  } catch {}
  if (!found) {
    // Some installer versions name the profile without the MC version prefix.
    try {
      const names = await fsp.readdir(versionsDir);
      const candidates = names.filter(n => n.toLowerCase().includes('neoforge'));
      if (candidates.length) found = candidates[candidates.length - 1];
    } catch {}
  }
  if (!found) throw new Error('NeoForge semble installé, mais le launcher n’a pas trouvé son profil dans le dossier versions. Consulte les logs.');
  await fsp.writeFile(path.join(instanceRoot, '.worldzero-neoforge.json'), JSON.stringify({ version: found, minecraft: cfg.minecraftVersion, neoForge: info.version }, null, 2));
  log(`NeoForge installé : ${found}`, 'success');
  return { version: found, neoForge: info.version };
}
async function loginMicrosoft() {
  log('Ouverture de la fenêtre de connexion Microsoft officielle…');
  const auth = new Auth('select_account');
  // MSMC opens its own Microsoft sign-in window. Passwords are never requested by this app.
  xboxSession = await auth.launch('electron', { width: 520, height: 720, resizable: true });
  const account = await xboxSession.getMinecraft();
  const entitlements = await account.entitlements().catch(() => []);
  const ownsJava = entitlements.includes('game_minecraft') || entitlements.includes('product_minecraft');
  if (!ownsJava && !account.profile?.id) throw new Error('Aucun profil Minecraft Java valide trouvé sur ce compte.');
  minecraftAccount = account;
  log(`Connecté : ${account.profile?.name || 'joueur Minecraft'}`, 'success');
  return { name: account.profile?.name || 'Joueur', uuid: account.profile?.id || null };
}
async function launchGame() {
  if (launchBusy) throw new Error('Le lancement est déjà en cours.');
  if (!minecraftAccount || !xboxSession) throw new Error('Connecte-toi d’abord avec ton compte Microsoft.');
  launchBusy = true;
  try {
    const cfg = readConfig();
    await checkJava();
    let installed;
    try { installed = JSON.parse(await fsp.readFile(path.join(instanceRoot, '.worldzero-neoforge.json'), 'utf8')); }
    catch { installed = await installNeoForge(); }
    await updateModpack();
    const token = await xboxSession.getMinecraft();
    const launcher = new Client();
    const options = {
      authorization: token.mclc(),
      root: instanceRoot,
      version: { number: installed.version, type: 'release' },
      memory: { min: cfg.memoryMin || '2G', max: cfg.memoryMax || '4G' }
    };
    launcher.on('debug', msg => log(msg));
    launcher.on('data', msg => log(msg));
    launcher.on('progress', p => send('progress', { value: p.task ? 50 : 0, label: p.type || 'Préparation de Minecraft…' }));
    log('Préparation et lancement de Minecraft…');
    minecraftProcess = await launcher.launch(options);
    minecraftProcess.on('close', code => {
      log(`Minecraft s’est fermé (code ${code}).`);
      minecraftProcess = null;
      send('game-closed', { code });
    });
    send('game-started', { name: minecraftAccount.profile?.name || 'Joueur' });
    log('Minecraft a été lancé.', 'success');
  } finally {
    launchBusy = false;
  }
}
ipcMain.handle('get-state', async () => {
  const cfg = readConfig();
  return {
    config: cfg,
    account: minecraftAccount ? { name: minecraftAccount.profile?.name || 'Joueur' } : null,
    instanceRoot,
    java: 'Java 21 requis',
    running: Boolean(minecraftProcess)
  };
});
ipcMain.handle('login', async () => loginMicrosoft());
ipcMain.handle('install', async () => installNeoForge());
ipcMain.handle('update-pack', async () => updateModpack());
ipcMain.handle('play', async () => launchGame());
ipcMain.handle('save-config', async (_event, value) => {
  if (!value || typeof value !== 'object') throw new Error('Paramètres invalides.');
  const current = readConfig();
  const next = { ...current };
  if (typeof value.modpackManifestUrl === 'string') {
    const url = value.modpackManifestUrl.trim();
    if (url && !url.startsWith('https://')) throw new Error('Le manifeste doit utiliser HTTPS.');
    next.modpackManifestUrl = url;
  }
  if (typeof value.serverAddress === 'string') next.serverAddress = value.serverAddress.trim().slice(0, 255);
  if (['2G','3G','4G','5G','6G','8G'].includes(value.memoryMax)) next.memoryMax = value.memoryMax;
  if (['1G','2G','3G','4G'].includes(value.memoryMin)) next.memoryMin = value.memoryMin;
  writeConfig(next);
  return next;
});
ipcMain.handle('open-instance', async () => shell.openPath(instanceRoot));
ipcMain.handle('open-link', async (_event, url) => {
  if (typeof url !== 'string' || !['https://'].some(p => url.startsWith(p))) throw new Error('Lien refusé.');
  return shell.openExternal(url);
});
ipcMain.handle('logout', async () => {
  xboxSession = null;
  minecraftAccount = null;
  log('Session effacée de la mémoire du launcher.');
  return true;
});
