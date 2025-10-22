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

  // ====== (Opcional) Lógica mínima y pasiva cuando SÍ esté activado ======
  // Sin observers ni hooks AJAX: una sola lectura del DOM en /samples.
  var TABLE_SELECTORS = [
    "table.listing",
    "table.listing-table",
    "table#listing",
    ".listing-app table",
    ".app-listing table"
  ];

  var OOR_TEXT_PATTERNS = [
    "fuera de rango", "out of range", "oor", "range violation", "out-of-range"
  ];
  var OOR_ICON_HINTS = ["exclamation", "warning", "exclamation_red.svg", "warning.svg"];

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

  function rowLooksOOR(tr){
    try{
      if (tr.classList.contains("row-flag-alert") || tr.getAttribute("data-row-alert")==="1") return true;
      if (tr.getAttribute("data-has-oor")==="1" || tr.querySelector('[data-oor="1"]')) return true;

      var imgs = tr.querySelectorAll("img, svg, use");
      for (var i=0;i<imgs.length;i++){
        var el = imgs[i];
        var src = (el.getAttribute("src") || el.getAttribute("href") || "").toLowerCase();
        var alt = (el.getAttribute("alt") || el.getAttribute("title") || "").toLowerCase();
        for (var j=0;j<OOR_ICON_HINTS.length;j++){
          var k = OOR_ICON_HINTS[j];
          if (src.indexOf(k)>-1 || alt.indexOf(k)>-1) return true;
        }
      }
      var text = (tr.innerText || "").toLowerCase();
      for (var t=0;t<OOR_TEXT_PATTERNS.length;t++){
        if (text.indexOf(OOR_TEXT_PATTERNS[t])>-1) return true;
      }
    } catch(e){ log("rowLooksOOR err", e); }
    return false;
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

  function processTable(tbl){
    var tbody = tbl.tBodies && tbl.tBodies[0];
    if (!tbody) return;
    var rows = Array.prototype.slice.call(tbody.rows || []);
    var marked = 0;
    for (var i=0;i<rows.length;i++){
      var tr = rows[i];
      if (tr.getAttribute("data-infolabsa-processed")==="1") continue;
      if (!rowStateRelevant(tr)) { tr.setAttribute("data-infolabsa-processed","1"); continue; }
      if (rowLooksOOR(tr)) { markRow(tr); marked++; }
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
    setTimeout(function(){ safe(function(){ scanAll(document); }); }, 50);
    // rescan manual por consola, si lo necesitas
    window.__infolabsa__.rescan = function(){ if (isSamplesListPage()) scanAll(document); };
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(function(){ safe(init); }, 0);
  } else {
    document.addEventListener("DOMContentLoaded", function(){ safe(init); });
  }
})();
