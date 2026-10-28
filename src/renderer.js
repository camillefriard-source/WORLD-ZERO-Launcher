const $ = id => document.getElementById(id);
let currentState = null;

function addLog(item) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${item.kind || ''}`;
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = `[${item.time || new Date().toLocaleTimeString('fr-FR')}]`;
  entry.append(time, document.createTextNode(item.message));
  $('log').appendChild(entry);
  $('log').scrollTop = $('log').scrollHeight;
}
function setProgress(value, label) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  $('progress-bar').style.width = `${v}%`;
  $('progress-value').textContent = `${v}%`;
  $('progress-label').textContent = label || 'TRAITEMENT…';
}
function setBusy(busy, caption = 'PRÉPARATION…') {
  $('play').disabled = busy || !currentState?.account;
  $('play-caption').textContent = busy ? caption : (currentState?.account ? 'LANCER WORLD ZERO' : 'CONNEXION REQUISE');
}
async function runButton(button, task, successMessage) {
  button.disabled = true;
  try { await task(); if (successMessage) addLog({ message: successMessage, kind: 'success' }); }
  catch (error) { addLog({ message: error.message || String(error), kind: 'error' }); }
  finally { button.disabled = false; await refreshState(); }
}
async function refreshState() {
  currentState = await window.worldZero.getState();
  $('server-address').textContent = currentState.config.serverAddress || 'À CONFIGURER';
  $('instance-path').textContent = currentState.instanceRoot;
  $('manifest-url').value = currentState.config.modpackManifestUrl || '';
  $('server-input').value = currentState.config.serverAddress || '';
  $('memory-min').value = currentState.config.memoryMin || '2G';
  $('memory-max').value = currentState.config.memoryMax || '4G';
  if (currentState.account) {
    $('account-name').textContent = currentState.account.name.toUpperCase();
    $('account-status').textContent = 'Compte Microsoft authentifié';
    $('avatar').textContent = currentState.account.name.slice(0, 1).toUpperCase();
    $('login').textContent = 'CONNECTÉ ✓';
    $('loader-state').textContent = 'AUTO-INSTALLATION';
  } else {
    $('account-name').textContent = 'NON CONNECTÉ';
    $('account-status').textContent = 'Authentification Microsoft requise';
    $('avatar').textContent = '?';
    $('login').textContent = 'SE CONNECTER ↗';
  }
  setBusy(false);
}
$('login').addEventListener('click', () => runButton($('login'), async () => {
  const account = await window.worldZero.login();
  addLog({ message: `Bienvenue, ${account.name}.`, kind: 'success' });
}, null));
$('install').addEventListener('click', () => runButton($('install'), async () => {
  setProgress(10, 'INSTALLATION DE NEOFORGE…');
  const result = await window.worldZero.install();
  $('loader-state').textContent = result.version;
  setProgress(100, 'NEOFORGE INSTALLÉ');
}, 'Installation terminée.'));
$('update').addEventListener('click', () => runButton($('update'), async () => {
  $('pack-state').textContent = 'SYNCHRONISATION…';
  const result = await window.worldZero.updatePack();
  $('pack-state').textContent = result.version || 'À JOUR';
  setProgress(100, 'MODPACK À JOUR');
}, 'Modpack synchronisé.'));
$('play').addEventListener('click', () => runButton($('play'), async () => {
  setBusy(true, 'LANCEMENT…');
  setProgress(5, 'PRÉPARATION DU JEU…');
  await window.worldZero.play();
  setProgress(100, 'JEU LANCÉ');
}, null));
$('settings-open').addEventListener('click', () => $('settings-modal').classList.remove('hidden'));
$('settings-close').addEventListener('click', () => $('settings-modal').classList.add('hidden'));
$('settings-modal').addEventListener('click', e => { if (e.target === $('settings-modal')) $('settings-modal').classList.add('hidden'); });
$('settings-save').addEventListener('click', () => runButton($('settings-save'), async () => {
  const config = await window.worldZero.saveConfig({
    modpackManifestUrl: $('manifest-url').value,
    serverAddress: $('server-input').value,
    memoryMin: $('memory-min').value,
    memoryMax: $('memory-max').value
  });
  $('settings-modal').classList.add('hidden');
  $('server-address').textContent = config.serverAddress || 'À CONFIGURER';
}, 'Paramètres enregistrés.'));
$('logout').addEventListener('click', () => runButton($('logout'), async () => {
  await window.worldZero.logout();
  $('settings-modal').classList.add('hidden');
}, 'Session effacée.'));
$('open-folder').addEventListener('click', () => window.worldZero.openInstance());
$('clear-log').addEventListener('click', () => $('log').replaceChildren());
$('copy-server').addEventListener('click', async () => {
  const address = $('server-address').textContent;
  try { await navigator.clipboard.writeText(address); addLog({ message: 'Adresse copiée dans le presse-papiers.', kind: 'success' }); }
  catch { addLog({ message: `Adresse du serveur : ${address}` }); }
});
window.worldZero.onLog(addLog);
window.worldZero.onProgress(data => setProgress(data.value, data.label));
window.worldZero.onGameStarted(data => { setBusy(false); addLog({ message: `Processus Minecraft démarré pour ${data.name}.`, kind: 'success' }); });
window.worldZero.onGameClosed(data => { setBusy(false); addLog({ message: `Minecraft fermé (code ${data.code}).` }); });
refreshState().catch(e => addLog({ message: e.message, kind: 'error' }));
