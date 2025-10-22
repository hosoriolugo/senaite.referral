/* eslint-disable no-console */
(function (jQ) {
  "use strict";

  // Evita doble inicialización si Plone reinyecta el script
  if (window.__infolabsa_bootstrapped__) return;
  window.__infolabsa_bootstrapped__ = true;

  var $ = jQ; // jQuery de Plone
  var TABLE_SELECTORS = [
    "table.listing",
    "table.listing-table",
    "table#listing",
    "table.table",
    "#listing-table"
  ];

  var OOR_TEXT_PATTERNS = [
    "fuera de rango",
    "out of range",
    "oor",
    "range violation",
    "out-of-range"
  ];

  var OOR_ICON_HINTS = [
    "exclamation",
    "warning"
  ];

  function debounce(fn, wait) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function dlog() {
    try {
      if (window && window.localStorage && localStorage.getItem("infolabsa.debug") === "1") {
        var args = Array.prototype.slice.call(arguments);
        args.unshift("[infolabsa]");
        console.log.apply(console, args);
      }
    } catch (e) { /* ignore */ }
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

    var attrCandidates = [
      "data-uid",
      "data-sample-uid",
      "data-uid-sample",
      "data-sampleuid"
    ];
    for (var i = 0; i < attrCandidates.length; i++) {
      var v = tr.getAttribute(attrCandidates[i]);
      if (v) return v;
    }

    try {
      var firstLink = tr.querySelector("td a[href]");
      if (firstLink) {
        var href = firstLink.getAttribute("href") || "";
        var parts = href.split(/[\/#?]/).filter(Boolean);
        if (parts.length) {
          return parts[parts.length - 1];
        }
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
    try {
      return new Set(Object.values(x));
    } catch (e) {
      return new Set();
    }
  }

  function processTable(tbl) {
    if (!tbl) return;

    var tbody = tbl.tBodies && tbl.tBodies[0];
    if (!tbody) return;

    var rows = Array.prototype.slice.call(tbody.rows || []);
    if (rows.length === 0) return;

    rows.forEach(function (tr) {
      if (rowLooksOOR(tr)) {
        markRow(tr);
        tr.setAttribute("data-infolabsa-processed", "1");
      }
    });

    if (!hasHelper()) {
      return;
    }

    var unresolved = rows.filter(function (tr) {
      return tr.getAttribute("data-infolabsa-processed") !== "1";
    });
    if (unresolved.length === 0) return;

    var uidMap = new Map();
    unresolved.forEach(function (tr) {
      var uid = getSampleUIDFromRow(tr);
      if (uid) {
        if (!uidMap.has(uid)) uidMap.set(uid, []);
        uidMap.get(uid).push(tr);
      }
    });

    var uids = Array.from(uidMap.keys());
    if (uids.length === 0) return;

    window.infolabsaGetOorSamples(uids)
      .then(function (result) {
        var oorSet = toSet(result);
        uids.forEach(function (uid) {
          var trs = uidMap.get(uid) || [];
          var isOOR = oorSet.has(uid);
          trs.forEach(function (tr) {
            if (isOOR) {
              markRow(tr);
            }
            tr.setAttribute("data-infolabsa-processed", "1");
          });
        });
      })
      .catch(function (err) {
        dlog("helper error", err);
      });
  }

  var scanAll = debounce(function (root) {
    root = root || document;
    TABLE_SELECTORS.forEach(function (sel) {
      var tables = root.querySelectorAll(sel);
      Array.prototype.forEach.call(tables, processTable);
    });
    dlog("scanAll() ejecutado");
  }, 80);

  // ---------- TIMING / ENGANCHES ----------

  // a) Enganche AJAX: cada vez que se rellena un listing via folderitems
  function hookAjaxComplete() {
    if (!window.jQuery) return;
    try {
      $(document).ajaxComplete(function (_evt, _xhr, settings) {
        var url = (settings && settings.url) || "";
        if (/\/view\/folderitems(\?|$)/.test(url) || /\/folderitems(\?|$)/.test(url)) {
          dlog("ajaxComplete -> folderitems");
          scanAll(document);
        }
      });

      // Algunos listados emiten este custom event al finalizar
      $(document).on("listing:rendered", function () {
        dlog("listing:rendered");
        scanAll(document);
      });

      // Por si el sitio usa ajaxStop al terminar “lotes” de llamadas
      $(document).on("ajaxStop", debounce(function () {
        dlog("ajaxStop");
        scanAll(document);
      }, 50));
    } catch (e) { /* ignore */ }
  }

  // b) MutationObserver (solo en el contenedor principal para rendimiento)
  var observer = null;
  function startObserver() {
    try {
      var target = document.querySelector("#content-core") || document.getElementById("content") || document.body;
      if (!target || !window.MutationObserver) return;
      observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.addedNodes && m.addedNodes.length) {
            // Re-escanea si aparece alguna de las tablas objetivo
            for (var j = 0; j < m.addedNodes.length; j++) {
              var node = m.addedNodes[j];
              if (!(node instanceof HTMLElement)) continue;
              if (TABLE_SELECTORS.some(function (sel) {
                return node.matches && node.matches(sel) || (node.querySelector && node.querySelector(sel));
              })) {
                dlog("MutationObserver -> nueva tabla");
                scanAll(document);
                return;
              }
            }
          }
        }
      });
      observer.observe(target, { childList: true, subtree: true });
      dlog("MutationObserver activo");
    } catch (e) { /* ignore */ }
  }

  // c) Init (ready) + prueba de vida opcional
  function initBadge() {
    if (document.getElementById("infolabsa-test-badge")) return;
    var badge = document.createElement("div");
    badge.id = "infolabsa-test-badge";
    badge.style.position = "fixed";
    badge.style.right = "8px";
    badge.style.bottom = "8px";
    badge.style.padding = "6px 10px";
    badge.style.background = "#111";
    badge.style.color = "#fff";
    badge.style.font = "12px/1 sans-serif";
    badge.style.zIndex = "99999";
    badge.style.borderRadius = "6px";
    badge.style.opacity = ".75";
    badge.textContent = "INFOLABSA JS activo";
    document.body.appendChild(badge);
  }

  function init() {
    dlog("init()");
    // Primera pasada por si el HTML inicial ya trae la tabla
    scanAll(document);
    // Observa re-renderizaciones dinámicas
    startObserver();
    // Re-aplica tras cada respuesta AJAX
    hookAjaxComplete();

    // Deja un test-badge si debug está activo
    try { if (localStorage.getItem("infolabsa.debug") === "1") initBadge(); } catch (e) {}
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 0);
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }

  // API manual para depurar desde consola
  window.__infolabsa__ = {
    rescan: function () { scanAll(document); }
  };

})(window.jQuery);
