/* eslint-disable no-console */
(function () {
  "use strict";

  // ====== FEATURE FLAG (inactivo por defecto) ======
  function isEnabled() {
    try { return localStorage.getItem("infolabsa.enabled") === "1"; }
    catch (e) { return false; }
  }
  if (!isEnabled()) {
    // Exponemos un pequeño control para que puedas activarlo sin reinstalar
    window.__infolabsa__ = {
      enable: function(){ try { localStorage.setItem("infolabsa.enabled","1"); location.reload(); } catch(e){} },
      disable: function(){ try { localStorage.removeItem("infolabsa.enabled"); location.reload(); } catch(e){} }
    };
    return; // 🚫 No hacemos nada si está deshabilitado
  }

  // ====== CONFIG ======
  var TABLE_SELECTORS = [
    "table.listing",
    "table.listing-table",
    "table#listing",
    "table.table",
    ".listing-app table",
    ".app-listing table"
  ];

  var OOR_TEXT_PATTERNS = [
    "fuera de rango",
    "out of range",
    "oor",
    "range violation",
    "out-of-range"
  ];
  var OOR_ICON_HINTS = ["exclamation", "warning", "exclamation_red.svg", "warning.svg"];

  // Estados relevantes (pendiente y verificada)
  var SAMPLE_REVIEW_STATES_TO_CHECK = [
    "to_be_verified", "por verificar", "pendiente de verificar", "pending verification",
    "verified", "verificada", "verificadas", "verificado"
  ];

  // ====== UTILS ======
  function isDebug() {
    try { return localStorage.getItem("infolabsa.debug") === "1"; } catch (e) { return false; }
  }
  function log(){ if(isDebug()) { var a=[].slice.call(arguments); a.unshift("[infolabsa]"); try{console.log.apply(console,a);}catch(e){} } }
  function debounce(fn, wait){ var t; return function(){ var ctx=this, args=arguments; clearTimeout(t); t=setTimeout(function(){ try{fn.apply(ctx,args);}catch(e){log("debounce err",e);} }, wait); }; }
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

  // ====== Núcleo (solo DOM, cero AJAX) ======
  function processTable(tbl){
    if (!tbl) return;
    if (!isSamplesListPage()) return;

    var tbody = tbl.tBodies && tbl.tBodies[0];
    if (!tbody) return;

    var rows = Array.prototype.slice.call(tbody.rows || []);
    if (!rows.length) return;

    var marked = 0;
    for (var i=0;i<rows.length;i++){
      var tr = rows[i];
      if (tr.getAttribute("data-infolabsa-processed")==="1") continue;

      // Solo nos interesa si el estado de la muestra es relevante
      if (!rowStateRelevant(tr)) { tr.setAttribute("data-infolabsa-processed","1"); continue; }

      // Heurística local (iconos/texto en la fila) → sin tocar analitos
      if (rowLooksOOR(tr)) {
        markRow(tr);
        marked++;
      } else {
        tr.setAttribute("data-infolabsa-processed","1");
      }
    }
    log("processTable: filas=", rows.length, "marcadas=", marked);
  }

  var scanAll = debounce(function(root){
    if (!isSamplesListPage()) return;
    root = root || document;
    var totalTables = 0;
    for (var s=0;s<TABLE_SELECTORS.length;s++){
      var sel = TABLE_SELECTORS[s];
      var tables = root.querySelectorAll(sel);
      totalTables += tables.length;
      for (var i=0;i<tables.length;i++) safe(function(){ processTable(tables[i]); });
    }
    log("scanAll: tablas=", totalTables);
  }, 120);

  function rescanSoon(){
    if (!isSamplesListPage()) return;
    try { requestAnimationFrame(function(){ scanAll(document); }); } catch(e){ setTimeout(function(){ scanAll(document); },0); }
    setTimeout(function(){ scanAll(document); }, 250);
    setTimeout(function(){ scanAll(document); }, 700);
  }

  function startObserver(){
    try{
      var observer = new MutationObserver(function(muts){
        if (!isSamplesListPage()) return;
        var added=0;
        for (var i=0;i<muts.length;i++){
          var m = muts[i];
          if (m.addedNodes && m.addedNodes.length) added += m.addedNodes.length;
        }
        if (added){
          log("observer added=", added);
          scanAll(document);
          rescanSoon();
        }
      });
      observer.observe(document.documentElement || document.body, { childList:true, subtree:true });
      log("observer: iniciado");
    }catch(e){ log("observer err",e); }
  }

  function hookAjaxComplete(){
    if (!window.jQuery) { log("ajax hook: jQuery no disponible"); return; }
    try{
      jQuery(document).ajaxComplete(function(_evt,_xhr,settings){
        var url = (settings && settings.url) || "";
        if (isSamplesListPage() && /\/folderitems(\?|$)/.test(url)) {
          log("ajaxComplete: folderitems @samples");
          scanAll(document);
          rescanSoon();
        }
      });
      jQuery(document).on("listing:rendered", function(){
        if (!isSamplesListPage()) return;
        log("listing:rendered");
        scanAll(document);
        rescanSoon();
      });
      log("ajax hook: listo");
    }catch(e){ log("ajax hook err",e); }
  }

  function init(){
    if (!(document && document.body)) return;
    if (!isSamplesListPage()) { log("init: fuera de /samples (noop)"); return; }
    log("init @samples (enabled)");
    scanAll(document);
    rescanSoon();
    startObserver();
    hookAjaxComplete();
    window.__infolabsa__ = window.__infolabsa__ || {};
    window.__infolabsa__.rescan = function(){ if (isSamplesListPage()) { scanAll(document); rescanSoon(); } };
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(function(){ safe(init); }, 0);
  } else {
    document.addEventListener("DOMContentLoaded", function(){ safe(init); });
  }
})();
