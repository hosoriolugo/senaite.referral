/* eslint-disable no-console */
(function () {
  "use strict";

  // ========== CONFIG ==========
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

  // Estados del listado de muestras que vale la pena revisar en servidor
  var SAMPLE_REVIEW_STATES_TO_CHECK = [
    "to_be_verified",          // backend
    "por verificar",           // UI ES
    "pendiente de verificar",  // UI ES variante
    "pending verification"     // UI EN
  ];

  // Límite de concurrencia para llamadas AJAX por fila
  var MAX_CONCURRENT = 3;

  // ========== UTILS ==========
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

  function isSamplesListPage() {
    try {
      return /\/samples(?:[/?#]|$)/.test(location.pathname);
    } catch (e) { return false; }
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

  function getAuthToken() {
    try {
      // Plone/SENAITE frecuentemente tiene este input en la página
      var el = document.querySelector('input[name="_authenticator"]');
      return el ? el.value : null;
    } catch (e) {
      return null;
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
    // Heurística por iconos incrustados en la MISMA fila
    var imgs = tr.querySelectorAll("img, svg, use");
    for (var i = 0; i < imgs.length; i++) {
      var el = imgs[i];
      var src = (el.getAttribute("src") || el.getAttribute("href") || "").toLowerCase();
      var alt = (el.getAttribute("alt") || el.getAttribute("title") || "").toLowerCase();
      if (OOR_ICON_HINTS.some(function (k) { return src.indexOf(k) > -1 || alt.indexOf(k) > -1; })) {
        return true;
      }
    }
    // Heurística por texto en la MISMA fila
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

  // ========== Backfill cliente para /samples ==========
  // Cache de UIDs ya evaluados para no repetir
  var checkedUIDs = new Set();
  // Cola simple con límite de concurrencia
  var queue = [];
  var running = 0;

  function enqueue(task) {
    queue.push(task);
    drain();
  }
  function drain() {
    while (running < MAX_CONCURRENT && queue.length) {
      var t = queue.shift();
      running++;
      t(function done() {
        running--;
        drain();
      });
    }
  }

  function statusCellText(tr) {
    try {
      // intenta encontrar la celda de estado por cabecera o por clase común
      // 1) por data-title (DataTables en Senaite suele poner el título en data-title)
      var td = tr.querySelector('td[data-title*="state" i], td[data-title*="estado" i]') ||
               tr.querySelector('td.state, td.review_state') ||
               tr.querySelector('td:nth-child(contains("state"))'); // fallback
      return (td ? td.innerText : tr.innerText || "").trim().toLowerCase();
    } catch (e) {
      return (tr.innerText || "").toLowerCase();
    }
  }

  function shouldCheckServerForRow(tr) {
    if (!isSamplesListPage()) return false;
    // Sólo nos interesa si NO se detectó ya OOR en la fila y el estado es "por verificar"
    if (rowLooksOOR(tr)) return false;
    var txt = statusCellText(tr);
    return SAMPLE_REVIEW_STATES_TO_CHECK.some(function (k) { return txt.indexOf(k) > -1; });
  }

  function getSampleURLFromRow(tr) {
    var a = tr && tr.querySelector("td a[href]");
    return a ? a.getAttribute("href") : null;
  }

  function buildAnalysesAjaxURL(sampleUrl) {
    // Ej: /clients/client-1/Q3E2510170001/table_lab_analyses/folderitems
    if (!sampleUrl) return null;
    var base = sampleUrl.replace(/\/+$/, "");
    return base + "/table_lab_analyses/folderitems";
  }

  function responseLooksOOR(json) {
    try {
      var s = JSON.stringify(json).toLowerCase();
      if (OOR_TEXT_PATTERNS.some(function (k) { return s.indexOf(k) > -1; })) return true;
      if (OOR_ICON_HINTS.some(function (k) { return s.indexOf(k) > -1; })) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function checkRowServerSide(tr) {
    var uid = getSampleUIDFromRow(tr);
    if (!uid || checkedUIDs.has(uid)) return;

    var sampleUrl = getSampleURLFromRow(tr);
    var ajaxUrl = buildAnalysesAjaxURL(sampleUrl);
    if (!ajaxUrl) return;

    var token = getAuthToken();

    enqueue(function (done) {
      log("AJAX OOR check:", uid, ajaxUrl);
      // Usamos jQuery si está (siempre lo carga SENAITE)
      var payload = token ? { _authenticator: token } : {};
      try {
        jQuery.ajax({
          url: ajaxUrl,
          type: "POST",
          data: payload,
          dataType: "json"
        }).done(function (json) {
          checkedUIDs.add(uid);
          if (responseLooksOOR(json)) {
            markRow(tr);
            tr.setAttribute("data-infolabsa-processed", "1");
            log("→ OOR detectado vía AJAX en", uid);
          } else {
            log("→ sin OOR en", uid);
          }
        }).fail(function (xhr, status) {
          log("AJAX fallo", status, ajaxUrl);
        }).always(function () {
          done();
        });
      } catch (e) {
        log("AJAX error", e);
        done();
      }
    });
  }

  // ========== Núcleo ==========
  function processTable(tbl) {
    if (!tbl) return;
    var tbody = tbl.tBodies && tbl.tBodies[0];
    if (!tbody) return;

    var rows = Array.prototype.slice.call(tbody.rows || []);
    if (rows.length === 0) return;

    var pre = Date.now();
    var markedByHeuristics = 0;

    // 1) Heurística local
    rows.forEach(function (tr) {
      if (rowLooksOOR(tr)) {
        markRow(tr);
        tr.setAttribute("data-infolabsa-processed", "1");
        markedByHeuristics++;
      }
    });
    log("processTable: filas=", rows.length, "marcadas x heurística=", markedByHeuristics);

    // 2) Helper del backend si existe (batch, más eficiente)
    if (hasHelper()) {
      var unresolved = rows.filter(function (tr) {
        return tr.getAttribute("data-infolabsa-processed") !== "1";
      });
      var uidMap = new Map();
      unresolved.forEach(function (tr) {
        var uid = getSampleUIDFromRow(tr);
        if (uid) {
          if (!uidMap.has(uid)) uidMap.set(uid, []);
          uidMap.get(uid).push(tr);
        }
      });
      var uids = Array.from(uidMap.keys());
      if (uids.length) {
        log("consultando helper con", uids.length, "uids");
        window.infolabsaGetOorSamples(uids)
          .then(function (result) {
            var oorSet = toSet(result);
            uids.forEach(function (uid) {
              var trs = uidMap.get(uid) || [];
              var isOOR = oorSet.has(uid);
              trs.forEach(function (tr) {
                if (isOOR) markRow(tr);
                tr.setAttribute("data-infolabsa-processed", "1");
              });
            });
            log("helper: completado en", (Date.now() - pre) + "ms");
          })
          .catch(function (err) { log("helper error", err); });
      }
      return; // si hay helper no hace falta seguir
    }

    // 3) SIN helper → sólo /samples y sólo “por verificar”: fetch liviano por fila, con concurrencia limitada
    if (isSamplesListPage()) {
      rows.forEach(function (tr) {
        if (tr.getAttribute("data-infolabsa-processed") === "1") return;
        if (shouldCheckServerForRow(tr)) {
          checkRowServerSide(tr);
        }
      });
    }
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
    try { requestAnimationFrame(function(){ scanAll(document); }); }
    catch (e) { setTimeout(function(){ scanAll(document); }, 0); }
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
      observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
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
          scanAll(document);
        }
      });
      jQuery(document).on("listing:rendered", function () {
        log("evento listing:rendered → scan + rescans diferidos");
        scanAll(document);
        rescanSoon();
      });
      log("ajax hook: listo");
    } catch (e) { log("ajax hook: error", e); }
  }

  function init() {
    // Sólo actuamos en listados/DOM cargado
    if (!(document && document.body)) return;
    log("init");
    scanAll(document);
    rescanSoon();
    startObserver();
    hookAjaxComplete();
    window.__infolabsa__ = { rescan: function () { scanAll(document); rescanSoon(); }, _debug: { TABLE_SELECTORS: TABLE_SELECTORS } };
    log("__infolabsa__ listo");
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 0);
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
