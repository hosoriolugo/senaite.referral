/* eslint-disable no-console */
/*!
 * infolabsa.js — versión segura (sin observers ni hooks AJAX)
 * - Desactivado por defecto: no hace nada salvo exponer enable()/disable()
 * - No usa MutationObserver ni ajaxComplete (evita bucles y sobrecarga)
 * - Solo hace un escaneo pasivo una vez al cargar /samples
 *
 * Activar:   localStorage.setItem("infolabsa.enabled","1"); location.reload();
 * Desactivar:localStorage.removeItem("infolabsa.enabled");  location.reload();
 */
(function () {
  "use strict";

  // ====== FEATURE FLAG (inactivo por defecto) ======
  function isEnabled() {
    try { return localStorage.getItem("infolabsa.enabled") === "1"; }
    catch (e) { return false; }
  }
  // Expón controles siempre, pero no ejecutes lógica si está desactivado
  window.__infolabsa__ = {
    enable: function(){
      try { localStorage.setItem("infolabsa.enabled","1"); location.reload(); } catch(e){}
    },
    disable: function(){
      try { localStorage.removeItem("infolabsa.enabled"); location.reload(); } catch(e){}
    },
    // para pruebas manuales en consola
    rescan: function(){ /* no-op hasta que esté activado */ }
  };
  if (!isEnabled()) return;

  // ====== CONFIG (conservador) ======
  var TABLE_SELECTORS = [
    "table.listing",
    "table.listing-table",
    "table#listing",
    ".listing-app table",
    ".app-listing table"
  ];

  // Patrones muy simples para “fuera de rango”
  var OOR_TEXT_PATTERNS = [
    "fuera de rango",
    "out of range",
    "oor",
    "range violation",
    "out-of-range"
  ];
  var OOR_ICON_HINTS = ["exclamation", "warning", "exclamation_red.svg", "warning.svg"];

  // Estados relevantes de muestra (solo español/inglés más comunes)
  var SAMPLE_REVIEW_STATES_TO_CHECK = [
    "to_be_verified",
    "por verificar",
    "pendiente de verificar",
    "pending verification",
    "verified",
    "verificada",
    "verificado"
  ];

  // ====== UTILS ======
  function isDebug() {
    try { return localStorage.getItem("infolabsa.debug") === "1"; } catch (e) { return false; }
  }
  function log(){ if(isDebug()) { var a=[].slice.call(arguments); a.unshift("[infolabsa]"); try{console.log.apply(console,a);}catch(e){} } }
  function safe(fn){ try { fn(); } catch(e){ log("safe err", e); } }

  function isSamplesListPage() {
    try { return /\/samples\/?(?:[?#]|$)/.test(location.pathname || ""); }
    catch(e){ return false; }
  }

  function markRow(tr){
    try{
      if (!tr) return;
      tr.classList.add("row-flag-alert");
      tr.setAttribute("data-row-alert","1");
      tr.setAttribute("data-infolabsa-processed","1");
    }catch(e){ log("markRow err",e); }
  }

  function rowLooksOOR(tr){
    try{
      if (!tr) return false;
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
    }catch(e){ log("rowLooksOOR err",e); }
    return false;
  }

  function rowStateRelevant(tr){
    try{
      var text = (tr.innerText || "").toLowerCase();
      for (var i=0;i<SAMPLE_REVIEW_STATES_TO_CHECK.length;i++){
        if (text.indexOf(SAMPLE_REVIEW_STATES_TO_CHECK[i])>-1) return true;
      }
    }catch(e){}
    return false;
  }

  // ====== Núcleo (solo DOM, cero AJAX, una sola pasada) ======
  function processTable(tbl){
    if (!tbl) return;
    var tbody = tbl.tBodies && tbl.tBodies[0];
    if (!tbody) return;

    var rows = Array.prototype.slice.call(tbody.rows || []);
    if (!rows.length) return;

    var marked = 0;
    for (var i=0;i<rows.length;i++){
      var tr = rows[i];
      if (tr.getAttribute("data-infolabsa-processed")==="1") continue;

      if (!rowStateRelevant(tr)) { tr.setAttribute("data-infolabsa-processed","1"); continue; }

      if (rowLooksOOR(tr)) {
        markRow(tr);
        marked++;
      } else {
        tr.setAttribute("data-infolabsa-processed","1");
      }
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
      for (var i=0;i<tables.length;i++) safe(function(tbl){ return function(){ processTable(tbl); }; }(tables[i]));
    }
    log("scanAll: tablas=", totalTables);
  }

  function init(){
    if (!(document && document.body)) return;
    if (!isSamplesListPage()) { log("init: fuera de /samples (noop)"); return; }
    log("init @samples (enabled, modo seguro)");
    // ÚNICA pasada: no se re-engancha a nada
    // pequeño deferral para dejar que la tabla esté en el DOM
    setTimeout(function(){ safe(function(){ scanAll(document); }); }, 50);

    // expón rescan manual, por si el usuario quiere forzarlo en consola:
    window.__infolabsa__.rescan = function(){ if (isSamplesListPage()) { scanAll(document); } };
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(function(){ safe(init); }, 0);
  } else {
    document.addEventListener("DOMContentLoaded", function(){ safe(init); });
  }
})();
