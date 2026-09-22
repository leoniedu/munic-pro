// Options page glue: renders Status, and wires the Backup/Import/Clear
// buttons to situacao-options-store.js.
//
// Deliberately holds no storage API call of its own — every read/write
// goes through window.__municProSituacaoOptionsStore, which lives in the
// one directory scripts/check-network.sh sanctions for the browser's
// structured-storage database. This file only uses plain DOM,
// Blob/URL.createObjectURL (a download, same mechanism as
// situacao-export.js) and FileReader (reading the user-chosen import
// file) — none of which need a declared permission.
(function () {
  'use strict';

  const S = window.__municProSituacaoOptionsStore;

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()} ${hh}:${min}`;
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of children || []) node.appendChild(c);
    return node;
  }

  function renderStatus(status) {
    const container = document.getElementById('munic-pro-status-corpo');
    container.textContent = '';

    if (status.nRows === 0 && status.nRuns === 0) {
      container.appendChild(el('p', { class: 'munic-pro-vazio' },
        [document.createTextNode(
          'Nada guardado ainda nesta instalação — nenhuma leitura foi feita.',
        )]));
      return;
    }

    const resumo = el('p', {}, [document.createTextNode(
      `${status.nRuns} leitura(s), ${status.nRows} linha(s) de histórico.`,
    )]);
    container.appendChild(resumo);

    const datas = el('p', {}, [document.createTextNode(
      `Primeira leitura: ${fmtDate(status.firstReading)} · ` +
      `Última leitura: ${fmtDate(status.lastReading)}`,
    )]);
    container.appendChild(datas);

    if (status.ufCounts.length > 0) {
      const table = el('table', {}, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'UF' }),
            el('th', { text: 'Linhas' }),
          ]),
        ]),
        el('tbody', {}, status.ufCounts.map((u) => el('tr', {}, [
          el('td', { text: u.uf }),
          el('td', { text: String(u.n) }),
        ]))),
      ]);
      container.appendChild(table);
    }
  }

  async function refreshStatus() {
    const status = await S.getStatus();
    renderStatus(status);
    return status;
  }

  function showMsg(elId, kind, text) {
    const node = document.getElementById(elId);
    node.textContent = text;
    node.className = `munic-pro-options-msg ${kind}`;
  }

  function clearMsg(elId) {
    const node = document.getElementById(elId);
    node.textContent = '';
    node.className = '';
  }

  function downloadJson(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function timestampSlug() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('falha ao ler o arquivo'));
      reader.readAsText(file);
    });
  }

  async function onExportar() {
    const btn = document.getElementById('munic-pro-btn-exportar');
    btn.disabled = true;
    try {
      const json = await S.exportSnapshotJson();
      downloadJson(`munic2026_${timestampSlug()}.json`, json);
    } catch (err) {
      showMsg('munic-pro-import-msg', 'erro', `Falha ao exportar: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  async function onImportar() {
    const input = document.getElementById('munic-pro-arquivo-import');
    const file = input.files && input.files[0];
    clearMsg('munic-pro-import-msg');
    if (!file) {
      showMsg('munic-pro-import-msg', 'erro', 'Escolha um arquivo de Backup JSON primeiro.');
      return;
    }
    const btn = document.getElementById('munic-pro-btn-importar');
    btn.disabled = true;
    try {
      const text = await readFileAsText(file);
      const result = await S.importSnapshotJson(text);
      showMsg('munic-pro-import-msg', 'ok',
        `Importação concluída: ${result.rowsAdded} linha(s) e ` +
        `${result.runsAdded} leitura(s) adicionadas; ` +
        `${result.rowsSkipped} linha(s) e ${result.runsSkipped} ` +
        'leitura(s) já existiam e foram ignoradas.');
      await refreshStatus();
      input.value = '';
    } catch (err) {
      showMsg('munic-pro-import-msg', 'erro', err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function onLimpar() {
    const status = await refreshStatus();
    if (status.nRows === 0 && status.nRuns === 0) {
      showMsg('munic-pro-limpar-msg', 'aviso', 'Não há nada guardado para apagar.');
      return;
    }
    const confirmado = window.confirm(
      `Isso vai apagar ${status.nRuns} leitura(s) e ${status.nRows} ` +
      'linha(s) de histórico guardadas nesta instalação, sem volta. ' +
      'Considere exportar um Backup JSON antes.\n\n' +
      'Confirma a limpeza completa do histórico?',
    );
    if (!confirmado) return;

    const btn = document.getElementById('munic-pro-btn-limpar');
    btn.disabled = true;
    try {
      await S.clearAll();
      showMsg('munic-pro-limpar-msg', 'ok', 'Histórico apagado.');
      await refreshStatus();
    } catch (err) {
      showMsg('munic-pro-limpar-msg', 'erro', `Falha ao limpar: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  document.getElementById('munic-pro-btn-exportar').addEventListener('click', onExportar);
  document.getElementById('munic-pro-btn-importar').addEventListener('click', onImportar);
  document.getElementById('munic-pro-btn-limpar').addEventListener('click', onLimpar);

  refreshStatus();
})();
