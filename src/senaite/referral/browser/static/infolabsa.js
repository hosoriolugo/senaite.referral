/* eslint-disable no-console */
(function () {
  "use strict";

  var TABLE_SELECTORS = [
    "table.listing",
    "table.listing-table",
    "table#listing",
    "table.table",
    // por si la app de listado envuelve con un contenedor react:
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

  var OOR_ICON_HINTS = ["exclamation", "warning"];

  function isDebug() {
    try {
      return window && window.localStorage && localStorage.getItem("infolabsa.debug") === "1";
    } catch (e) {
      return false;
    }
  }

  function log() {
    if (!isDebug()) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[infolabsa]");
    console.log.apply(console, args);
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function markRow(tr) {
    if (!tr) return;
    if (!tr.classList.contains("row-flag-alert")) {
      tr.classList.add("row-flag-alert");
    }
    if (tr.getAttribute("data-row-alert") !== "1") {
      tr.setAttribute("data-row-alert", "1");
    }
  }

  function getSampleUIDFromRow(tr) {
    if (!tr) return null;
    var attrCandidates = ["data-uid","data-sample-uid","data-uid-sample","data-sampleuid","data-uid"];
    for (var i = 0; i < attrCandidates.length; i++) {
      var v = tr.getAttribute(attrCandidates[i]);
      if (v) return v;
    }
    try {
      var firstLink = tr.querySelector("td a[href]");
      if (firstLink) {
        var href = firstLink.getAttribute("href") || "";
        var parts = href.split(/[\/#?]/).filter(Boolean);
        if (parts.length) return parts[parts.length - 1];
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function rowLooksOOR(tr) {
    if (!tr) return false;
    if (tr.classList.contains("row-flag-alert") || tr.getAttribute("data-row-alert") === "1") {
      return true;
    }
    if (tr.getAttribute("data-has-oor") === "1" || tr.querySelector('[data-oor="1"]')) {
      return true;
    }
    var imgs = tr.querySelectorAll("img, svg, use");
    for (var i = 0; i < imgs.length; i++) {
      var el = imgs[i];
      var src = (el.getAttribute("src") || el.getAttribute("href") || "").toLowerCase();
      var alt = (el.getAttribute("alt") || el.getAttribute("title") || "").toLowerCase();
      if (OOR_ICON_HINTS.some(function (k) { return src.indexOf(k) > -1 || alt.indexOf(k) > -1; })) {
        return true;
      }
    }
    var text = (tr.innerText || "").toLowerCase();
    if (OOR_TEXT_PATTERNS.some(function (k) { return text.indexOf(k) > -1; })) {
      return true;
    }
    return false;
  }

  function hasHelper() {
    return typeof window.infolabsaGetOorSamples === "function";
  }

  function toSet(x) {
    if (!x) return new Set();
    if (x instanceof Set) return x;
    if (Array.isArray(x)) return new Set(x);
    try { return new Set(Object.values(x)); }
    catch (e) { return new Set(); }
  }

  function processTable(tbl) {
    if (!tbl) return;
    var tbody = tbl.tBodies && tbl.tBodies[0];
    if (!tbody) return;

    var rows = Array.prototype.slice.call(tbody.rows || []);
    if (rows.length === 0) return;

    var pre = Date.now();
    var markedByHeuristics = 0;

    rows.forEach(function (tr) {
      if (rowLooksOOR(tr)) {
        markRow(tr);
        tr.setAttribute("data-infolabsa-processed", "1");
        markedByHeuristics++;
      }
    });

    log("processTable: filas=", rows.length, "marcadas x heurística=", markedByHeuristics);

    if (!hasHelper()) {
      return;
    }

    var unresolved = rows.filter(function (tr) {
      return tr.getAttribute("data-infolabsa-processed") !== "1";
    });
    if (unresolved.length === 0) {
      log("processTable: nada pendiente para helper (", Date.now() - pre, "ms )");
      return;
    }

    var uidMap = new Map();
    unresolved.forEach(function (tr) {
      var uid = getSampleUIDFromRow(tr);
      if (uid) {
        if (!uidMap.has(uid)) uidMap.set(uid, []);
        uidMap.get(uid).push(tr);
      }
    });

    var uids = Array.from(uidMap.keys());
    if (uids.length === 0) {
      log("processTable: sin UIDs para consultar");
      return;
    }

    log("consultando helper con", uids.length, "uids");

    window.infolabsaGetOorSamples(uids)
      .then(function (result) {
        var oorSet = toSet(result);
        var resolved = 0, flagged = 0;
        uids.forEach(function (uid) {
          var trs = uidMap.get(uid) || [];
          var isOOR = oorSet.has(uid);
          trs.forEach(function (tr) {
            if (isOOR) {
              markRow(tr);
              flagged++;
            }
            tr.setAttribute("data-infolabsa-processed", "1");
            resolved++;
          });
        });
        log("helper: resueltas", resolved, "marcadas", flagged, "en", (Date.now() - pre) + "ms");
      })
      .catch(function (err) {
        log("helper error", err);
      });
  }

  var scanAll = debounce(function (root) {
    root = root || document;
    var totalTables = 0;
    TABLE_SELECTORS.forEach(function (sel) {
      var tables = root.querySelectorAll(sel);
      totalTables += tables.length;
      Array.prototype.forEach.call(tables, processTable);
    });
    log("scanAll: tablas encontradas=", totalTables);
  }, 150);

  // Rescan “seguro” post-pintado
  function rescanSoon() {
    // 1) siguiente frame
    try {
      requestAnimationFrame(function(){ scanAll(document); });
    } catch (e) {
      setTimeout(function(){ scanAll(document); }, 0);
    }
    // 2) extra por si hay renders diferidos
    setTimeout(function(){ scanAll(document); }, 300);
    setTimeout(function(){ scanAll(document); }, 800);
  }

  var observer = new MutationObserver(function (mutations) {
    var added = 0;
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.addedNodes && m.addedNodes.length) added += m.addedNodes.length;
    }
    if (added) {
      log("observer: nodos añadidos=", added);
      scanAll(document);
      rescanSoon();
    }
  });

  function startObserver() {
    try {
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true
      });
      log("observer: iniciado");
    } catch (e) { log("observer: fallo al iniciar", e); }
  }

  function hookAjaxComplete() {
    if (!window.jQuery) { log("ajax hook: jQuery no disponible"); return; }
    try {
      jQuery(document).ajaxComplete(function (_evt, _xhr, settings) {
        var url = (settings && settings.url) || "";
        log("ajaxComplete:", url);
        if (/\/folderitems(\?|$)/.test(url)) {
          log("ajaxComplete: match folderitems → scan + rescans diferidos");
          scanAll(document);
          rescanSoon();
        } else {
          // otros ajax también pueden inyectar filas
          scanAll(document);
        }
      });

      // evento custom de algunos listados
      jQuery(document).on("listing:rendered", function () {
        log("evento listing:rendered → scan + rescans diferidos");
        scanAll(document);
        rescanSoon();
      });
      log("ajax hook: listo");
    } catch (e) { log("ajax hook: error", e); }
  }

  function init() {
    log("init");
    scanAll(document);
    rescanSoon();
    startObserver();
    hookAjaxComplete();
    // Exponer utilidades
    window.__infolabsa__ = {
      rescan: function () { scanAll(document); rescanSoon(); },
      _debug: { TABLE_SELECTORS: TABLE_SELECTORS }
    };
    log("__infolabsa__ listo");
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 0);
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
