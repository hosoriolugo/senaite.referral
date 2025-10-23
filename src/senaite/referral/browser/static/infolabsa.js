/* eslint-disable no-console */
/*!
 * infolabsa.js — versión segura con AUTODISABLE del anterior
 *
 * Modo seguro:
 *   - Por defecto NO hace nada.
 *   - Exponer __infolabsa__.enable()/disable() siempre.
 *   - En el PRIMER load tras desplegar este archivo:
 *       * Desactiva cualquier "infolabsa.enabled" previo.
 *       * Llama __infolabsa__.stop() si existiera de una versión anterior.
 *       * Marca migración y recarga UNA sola vez.
 *
 * Activar manualmente (cuando tú quieras):
 *   localStorage.setItem("infolabsa.enabled","1"); location.reload();
 * Desactivar:
 *   localStorage.removeItem("infolabsa.enabled");  location.reload();
 */
(function () {
  "use strict";

  // ====== Etapa 0: entorno seguro ======
  try {
    if (typeof window === "undefined" || !window.document) return;
  } catch (_e) { return; }

  // ====== Etapa 1: “matar” versión anterior una sola vez ======
  // Cambia el valor si vuelves a necesitar forzar este paso en otra actualización.
  var MIGRATION_TAG = "v2.0-autodisable-2025-10-22";
  try {
    var ls = window.localStorage;
    var alreadyMigrated = ls.getItem("infolabsa.migrated") === MIGRATION_TAG;

    if (!alreadyMigrated) {
      // Si existía un objeto anterior con método de parada, intentalo.
      try {
        if (window.__infolabsa__ && typeof window.__infolabsa__.stop === "function") {
          window.__infolabsa__.stop();
        }
      } catch (_eStop) {}

      // Desactiva cualquier activación previa y marca migración.
      try { ls.removeItem("infolabsa.enabled"); } catch (_e1) {}
      try { ls.setItem("infolabsa.migrated", MIGRATION_TAG); } catch (_e2) {}

      // Evita recargas en bucle:
      var reloadedOnce = ls.getItem("infolabsa.reloadedOnce") === "1";
      if (!reloadedOnce) {
        try { ls.setItem("infolabsa.reloadedOnce", "1"); } catch (_e3) {}
        // Recarga una sola vez para que el sitio arranque SIN el estado previo activado.
        try { location.reload(); return; } catch (_e4) {}
      }
    }
  } catch (_eMig) {
    // Si localStorage falla, seguimos; el archivo sigue siendo no-op por defecto.
  }

  // ====== Etapa 2: API pública SIEMPRE disponible ======
  function setLS(key, val){ try { localStorage.setItem(key, val); } catch(_e){} }
  function delLS(key){ try { localStorage.removeItem(key); } catch(_e){} }

  // Sobrescribe cualquier __infolabsa__ viejo con una API mínima y segura
  window.__infolabsa__ = {
    enable: function () { setLS("infolabsa.enabled","1"); try{ location.reload(); }catch(_e){} },
    disable: function () { delLS("infolabsa.enabled");  try{ location.reload(); }catch(_e){} },
    rescan: function () { /* no-op hasta que esté activado */ },
    // stop() existe por compatibilidad: no hay observers en esta versión.
    stop: function () { /* no-op en versión segura */ }
  };

  // ====== Etapa 3: si NO está activado, salimos (no-op) ======
  var enabled = false;
  try { enabled = localStorage.getItem("infolabsa.enabled") === "1"; } catch (_e) { enabled = false; }
  if (!enabled) return;

  // ====== Lógica pasiva cuando SÍ esté activado (sin observers/HOOKs AJAX) ======
  // Una sola lectura del DOM en /samples.
  var TABLE_SELECTORS = [
    "table.listing",
    "table.listing-table",
    "table#listing",
    ".listing-app table",
    ".app-listing table"
  ];

  // Patrones de texto habituales para OOR
  var OOR_TEXT_PATTERNS = [
    "fuera de rango", "out of range", "out-of-range", "oor",
    "fuera del rango", "range violation", "range_violation",
    "alerta crítica", "crítico", "critical", "panic", "panic high", "panic low"
  ];

  // Recursos/íconos que delatan alerta
  var OOR_ICON_HINTS = [
    "exclamation", "warning", "alert", "triangle",
    "exclamation_red.svg", "warning.svg", "icon-alert", "fa-exclamation"
  ];

  // Clases comunes usadas para marcar fuera de rango/alertas
  var OOR_CLASS_HINTS = [
    "fr-alert", "al-critical", "al-delta", "out-of-range", "range-violation",
    "state-oor", "state-outofrange", "is-oor", "has-oor"
  ];

  // Estados de revisión relevantes (filtra filas realmente "vivas")
  var SAMPLE_REVIEW_STATES_TO_CHECK = [
    "to_be_verified", "por verificar", "pendiente de verificar",
    "pending verification", "verified", "verificada", "verificado"
  ];

  function isDebug(){ try { return localStorage.getItem("infolabsa.debug") === "1"; } catch(_e){ return false; } }
  function log(){ if(!isDebug()) return; try { var a=[].slice.call(arguments); a.unshift("[infolabsa]"); console.log.apply(console,a); } catch(_e){} }
  function safe(fn){ try { fn(); } catch(e){ log("safe err", e); } }
  function isSamplesListPage(){ try { return /\/samples\/?(?:[?#]|$)/.test(location.pathname || ""); } catch(_e){ return false; } }

  function markRow(tr){
    try{
      tr.classList.add("row-flag-alert");
      tr.setAttribute("data-row-alert","1");
      tr.setAttribute("data-infolabsa-processed","1");
    } catch(e){ log("markRow err", e); }
  }

  function rowStateRelevant(tr){
    try{
      var text = (tr.innerText || "").toLowerCase();
      for (var i=0;i<SAMPLE_REVIEW_STATES_TO_CHECK.length;i++){
        if (text.indexOf(SAMPLE_REVIEW_STATES_TO_CHECK[i])>-1) return true;
      }
    } catch(_e){}
    return false;
  }

  // Detección robusta de "fuera de rango" SOLO en la fila/celdas
  function rowLooksOOR(tr, tbl){
    try{
      if (tr.classList.contains("row-flag-alert") || tr.getAttribute("data-row-alert")==="1") return true;
      if (tr.getAttribute("data-has-oor")==="1" || tr.querySelector('[data-oor="1"]')) return true;

      // 1) Clases de alerta en la propia fila o en sus celdas
      for (var c=0; c<OOR_CLASS_HINTS.length; c++){
        var cls = OOR_CLASS_HINTS[c];
        if (tr.classList.contains(cls)) return true;
        if (tr.querySelector("td."+cls+", td ."+cls+' , td [class*="'+cls+'"]')) return true;
      }

      // 2) Íconos dentro de la fila
      var imgs = tr.querySelectorAll("td img, td svg, td use");
      for (var i=0;i<imgs.length;i++){
        var el = imgs[i];
        var src = (el.getAttribute("src") || el.getAttribute("href") || "").toLowerCase();
        var alt = (el.getAttribute("alt") || el.getAttribute("title") || "").toLowerCase();
        for (var j=0;j<OOR_ICON_HINTS.length;j++){
          var k = OOR_ICON_HINTS[j];
          if ((src && src.indexOf(k)>-1) || (alt && alt.indexOf(k)>-1)) return true;
        }
      }

      // 3) Texto SOLO de las celdas de la fila
      var cells = tr.querySelectorAll("td");
      for (var t=0;t<OOR_TEXT_PATTERNS.length;t++){
        var pat = OOR_TEXT_PATTERNS[t];
        for (var k=0;k<cells.length;k++){
          var tx = (cells[k].innerText || "").toLowerCase();
          if (tx.indexOf(pat)>-1) return true;
        }
      }

      // 4) Columnas típicas de "estado" o "alerta"
      var likely = tr.querySelector('td[class*="state"], td[class*="status"], td[class*="alert"], td[class*="range"]');
      if (likely){
        var ltxt = (likely.innerText || "").toLowerCase();
        for (var t2=0;t2<OOR_TEXT_PATTERNS.length;t2++){
          if (ltxt.indexOf(OOR_TEXT_PATTERNS[t2])>-1) return true;
        }
        if (likely.querySelector('[data-oor="1"], .out-of-range, .fr-alert, .al-critical')) return true;
      }
    } catch(e){ log("rowLooksOOR err", e); }
    return false;
  }

  function processTable(tbl){
    var tbody = tbl.tBodies && tbl.tBodies[0];
    if (!tbody) return;
    var rows = Array.prototype.slice.call(tbody.rows || []);
    var marked = 0;
    for (var i=0;i<rows.length;i++){
      var tr = rows[i];
      if (tr.getAttribute("data-infolabsa-processed")==="1") continue;
      // Solo evaluamos filas "de datos" con estados relevantes
      if (!rowStateRelevant(tr)) { tr.setAttribute("data-infolabsa-processed","1"); continue; }
      if (rowLooksOOR(tr, tbl)) { markRow(tr); marked++; }
      else { tr.setAttribute("data-infolabsa-processed","1"); }
    }
    log("processTable: filas=", rows.length, "marcadas=", marked);
  }

  function scanAll(root){
    if (!isSamplesListPage()) return;
    root = root || document;
    var totalTables = 0;
    for (var s=0;s<TABLE_SELECTORS.length;s++){
      var sel = TABLE_SELECTORS[s];
      var tables = root.querySelectorAll(sel);
      totalTables += tables.length;
      for (var i=0;i<tables.length;i++){
        (function(tbl){ safe(function(){ processTable(tbl); }); })(tables[i]);
      }
    }
    log("scanAll: tablas=", totalTables);
  }

  function init(){
    if (!(document && document.body)) return;
    if (!isSamplesListPage()) { log("init: fuera de /samples (noop)"); return; }
    log("init @samples (enabled, modo seguro sin observers)");
    // una sola pasada, con pequeño delay para permitir que la tabla exista
    setTimeout(function(){ safe(function(){ scanAll(document); }); }, 100);
    // rescan manual por consola, si lo necesitas
    window.__infolabsa__.rescan = function(){ if (isSamplesListPage()) scanAll(document); };
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(function(){ safe(init); }, 0);
  } else {
    document.addEventListener("DOMContentLoaded", function(){ safe(init); });
  }
})();

// Marca filas con resultado fuera de rango
document.addEventListener('DOMContentLoaded', function () {
  // filas de la tabla de análisis en la vista de muestra
  const rows = document.querySelectorAll('table.contentstable tr.contentrow.parent');

  rows.forEach(tr => {
    const outOfRangeIcon = tr.querySelector(
      'img[title="Result out of range"], img[src*="exclamation_red.svg"]'
    );
    if (outOfRangeIcon) {
      tr.classList.add('row-flag-alert');     // tu CSS ya estiliza esta clase
      tr.setAttribute('data-row-alert', '1');  // por si usas el selector de atributo
      // (opcional) marca la cabecera de categoría
      const catName = tr.getAttribute('category');
      const catRow = document.querySelector(`tr.categoryrow[category="${catName}"]`);
      if (catRow) catRow.classList.add('row-flag-alert');
    }
  });
});

// === OOR highlighter (robusto + trazas) ===
(function () {
  const OOR_IMG_SEL = 'img[src*="exclamation_red.svg"], img[title*="out of range" i]';

  function markRow(tr) {
    if (!tr || tr.dataset.oorApplied === '1') return;
    tr.classList.add('row-flag-alert');
    tr.setAttribute('data-row-alert', '1');

    // Inyecta un marcador (para CSS :has(.oob-flag[data-oor="1"]))
    const td = tr.querySelector('td') || tr;
    if (td && !td.querySelector('.oob-flag[data-oor="1"]')) {
      const span = document.createElement('span');
      span.className = 'oob-flag';
      span.setAttribute('data-oor', '1');
      span.style.display = 'none';
      td.appendChild(span);
    }

    tr.dataset.oorApplied = '1';
  }

  function markFromIcons(root = document) {
    const imgs = root.querySelectorAll(OOR_IMG_SEL);
    let count = 0;
    imgs.forEach(img => {
      const tr = img.closest('tr');
      if (tr) {
        markRow(tr);
        count++;
        // (Opcional) marca fila de categoría si existe
        const catName = tr.getAttribute('category');
        if (catName) {
          const catRow =
            tr.closest('table')?.querySelector(`tr.categoryrow[category="${CSS.escape(catName)}"]`);
          if (catRow) markRow(catRow);
        }
      }
    });
    console.debug('[OOR] Íconos encontrados:', imgs.length, ' | Filas marcadas:', count);
  }

  // 1) Al cargar
  document.addEventListener('DOMContentLoaded', () => {
    console.debug('[OOR] DOMContentLoaded');
    markFromIcons();
  });

  // 2) Tras cada render Ajax (DataTables/listings). Si SENAITE dispara eventos, engánchate:
  document.addEventListener('listing:after-render', (e) => {
    console.debug('[OOR] listing:after-render', e.target);
    markFromIcons(e.target || document);
  }, true);

  // 3) Fallback: MutationObserver por si no hay evento custom
  const mo = new MutationObserver(muts => {
    let doit = false;
    for (const m of muts) {
      for (const n of m.addedNodes || []) {
        if (n.nodeType === 1) {
          if (n.matches?.('tr, table, tbody') || n.querySelector?.(OOR_IMG_SEL)) {
            doit = true;
            break;
          }
        }
      }
      if (doit) break;
    }
    if (doit) {
      // Debounce simple
      clearTimeout(mo._t);
      mo._t = setTimeout(() => markFromIcons(document), 50);
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
