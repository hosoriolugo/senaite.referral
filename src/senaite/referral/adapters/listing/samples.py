# -*- coding: utf-8 -*-
#
# This file is part of SENAITE.REFERRAL.
#
# SENAITE.REFERRAL is free software: you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by the Free
# Software Foundation, version 2.
#
# This program is distributed in the hope that it will be useful, but WITHOUT
# ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
# FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
# details.
#
# You should have received a copy of the GNU General Public License along with
# this program; if not, write to the Free Software Foundation, Inc., 51
# Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
#
# Copyright 2021-2022 by it's authors.
# Some rights reserved, see README and LICENSE.

import collections

from senaite.app.listing import utils as listing_utils
from senaite.app.listing.interfaces import IListingView
from senaite.app.listing.interfaces import IListingViewAdapter
from senaite.referral import check_installed
from senaite.referral import messageFactory as _
from zope.component import adapter
from zope.interface import implementer

from bika.lims import api
from bika.lims.utils import get_link_for

# === INFOLABSA: detección de analitos fuera de rango y marcado de fila ===
from Products.CMFCore.utils import getToolByName


def _num(x):
    """float seguro (None/''/coma decimal). Py2.7-safe."""
    try:
        if x in (None, u"", ""):
            return None
        try:
            num_types = (int, long, float)  # noqa: F821 (Py2)
        except NameError:
            num_types = (int, float)
        if isinstance(x, num_types):
            return float(x)
        return float(unicode(x).replace(",", "."))  # noqa
    except Exception:
        return None


def _pick(obj, *names):
    """Devuelve el primer atributo/callable existente con valor no vacío."""
    for name in names:
        if not hasattr(obj, name):
            continue
        try:
            val = getattr(obj, name)
            val = val() if callable(val) else val
        except Exception:
            continue
        if val not in (None, "", u""):
            return val
    return None


def _flag_text_true(txt):
    t = unicode(txt or u"").lower()  # noqa
    keys = (
        u"out of range", u"out-of-range", u"fuera de rango", u"range violation",
        u"oor", u"critical", u"crítico", u"panic", u"alert"
    )
    return any(k in t for k in keys)


def _analysis_is_oof(a):
    """Detección robusta compatible con senaite.patient/impress."""
    # 1) Banderas booleanas típicas
    if any(bool(_pick(a, n)) for n in (
        "isOutOfRange", "getOutOfRange", "getResultOutOfRange",
        "result_out_of_range", "out_of_range"
    )):
        return True

    # 2) Flags de texto
    flag = _pick(a, "getResultFlag", "getResultFlags", "result_flag")
    if _flag_text_true(flag):
        return True

    # 3) Chequeo numérico con min/max + alert/panic si hay
    v = _num(_pick(a, "getResult", "Result", "getResultValue"))
    if v is None:
        return False

    lo = _num(_pick(a, "getReferenceMinimum", "getMin", "getLower"))
    hi = _num(_pick(a, "getReferenceMaximum", "getMax", "getUpper"))

    alo = _num(_pick(a, "getAlertMinimum", "getAlertLower"))
    ahi = _num(_pick(a, "getAlertMaximum", "getAlertUpper"))

    plo = _num(_pick(a, "getPanicMinimum", "getPanicLower"))
    phi = _num(_pick(a, "getPanicMaximum", "getPanicUpper"))

    def outside(x, lo_, hi_):
        if lo_ is not None and x < lo_:
            return True
        if hi_ is not None and x > hi_:
            return True
        return False

    # pánico > alerta > referencia
    if any(outside(v, lo_, hi_) for (lo_, hi_) in (
        (plo, phi), (alo, ahi), (lo, hi),
    )):
        return True

    return False
# === /INFOLABSA ===


@adapter(IListingView)
@implementer(IListingViewAdapter)
class SamplesListingViewAdapter(object):

    def __init__(self, listing, context):
        self.listing = listing
        self.context = context
        # ✅ micro-cache por petición: UID de Sample -> bool (tiene OOR)
        self._infolabsa_oor_cache = {}

    @check_installed(None)
    def before_render(self):
        # Additional columns
        self.add_columns()
        self.add_review_states()

    @check_installed(None)
    def folder_item(self, obj, item, index):
        obj = api.get_object(obj)

        # Outbound shipment
        outbound_uid = obj.getRawOutboundShipment()
        outbound = self.listing.get_object_by_uid(outbound_uid)
        if outbound:
            link = get_link_for(outbound)
            ico = self.get_glyphicon("export")
            item.setdefault("replace", {})
            item["replace"]["Shipment"] = "{}{}".format(ico, link)
            outbound = api.get_title(outbound)

        # Inbound shipment
        inbound_uid = obj.getRawInboundShipment()
        inbound = self.listing.get_object_by_uid(inbound_uid)
        if inbound:
            link = get_link_for(inbound)
            ico = self.get_glyphicon("import")
            val = "{}{}".format(ico, link)
            if outbound:
                prev = item.get("replace", {}).get("Shipment", "")
                val = "&nbsp;|&nbsp;".join(filter(None, [val, prev]))
            item.setdefault("replace", {})
            item["replace"]["Shipment"] = val
            inbound = api.get_title(inbound)

        shipment = filter(None, [outbound, inbound])
        item["Shipment"] = " ".join(shipment)

        # Show an alert if the sample has been rejected at reference lab
        if api.get_review_status(obj) == "rejected_at_reference":
            msg = _("Sample rejected at reference laboratory")
            after = item.get("after", {}).get("getId", "")
            ico = self.get_glyphicon("alert", title=msg, color="red")
            item.setdefault("after", {})
            item["after"]["getId"] = " ".join(filter(None, [after, ico]))

        # === INFOLABSA: sombrear fila si existe al menos un analito fuera de rango ===
        try:
            uid = api.get_uid(obj)

            # ✅ short-circuit por caché
            cached = self._infolabsa_oor_cache.get(uid, None)
            if cached is not None:
                any_oof = bool(cached)
            else:
                any_oof = False

                # A) Short-circuit por APIs agregadas (como hace senaite.patient/impress)
                if any(bool(_pick(obj, n)) for n in (
                    # nombres habituales en AR/Sample
                    "hasOutOfRange", "getOutOfRange", "isOutOfRange",
                    "getAnalysesOutOfRange", "getOutOfRangeAnalyses", "getOORCount",
                    "getResultOutOfRange",
                )):
                    val = _pick(obj, "getOORCount", "getAnalysesOutOfRange",
                                "getOutOfRangeAnalyses") or True
                    try:
                        # lista/conteo o booleano
                        try:
                            from numbers import Number
                            is_number = isinstance(val, Number)
                        except Exception:
                            try:
                                is_number = isinstance(val, (int, long))  # noqa
                            except Exception:
                                is_number = False
                        if isinstance(val, (list, tuple, set)):
                            any_oof = len(val) > 0
                        elif is_number:
                            any_oof = val > 0
                        else:
                            any_oof = bool(val)
                    except Exception:
                        any_oof = True

                analyses_objs = []
                # B) Si no hubo short-circuit, intenta sacar los análisis del objeto
                if not any_oof:
                    for getter in ("getAnalyses", "analyses", "getAnalysesFull"):
                        if hasattr(obj, getter):
                            try:
                                res = getattr(obj, getter)()
                                if res:
                                    try:
                                        res = list(res)
                                    except Exception:
                                        pass
                                    for a in res:
                                        try:
                                            analyses_objs.append(
                                                a.getObject() if hasattr(a, "getObject") else a
                                            )
                                        except Exception:
                                            pass
                            except Exception:
                                pass
                            if analyses_objs:
                                break

                # C) Catálogo: primero una consulta EXACTA como en el detalle,
                #    luego fallbacks con llaves alternativas e índices OOR
                if not any_oof and not analyses_objs:
                    ac = None
                    try:
                        ac = api.get_tool("senaite_catalog_analysis")
                    except Exception:
                        try:
                            from senaite.core.catalog import ANALYSIS_CATALOG
                            ac = api.get_tool(ANALYSIS_CATALOG)
                        except Exception:
                            ac = None

                    brains = []

                    # --- C1) Consulta 1: EXACTA (igual a LabAnalysesTable) ---
                    if ac is not None:
                        try:
                            brains = ac(
                                portal_type="Analysis",
                                getAncestorsUIDs=[uid],
                                getPointOfCapture="lab",
                                sort_on="sortable_title",
                                sort_order="ascending",
                                review_state=[
                                    "registered", "unassigned", "assigned",
                                    "to_be_verified", "verified", "published", "referred",
                                ],
                            )
                        except Exception:
                            brains = []

                    # --- C2) Si sigue vacío, usar llaves alternativas + índices OOR ---
                    if not brains:
                        qkeys = (
                            {"getAncestorsUIDs": [uid]},
                            {"getRequestUID": uid},
                            {"getAnalysisRequestUID": uid},
                            {"getSampleUID": uid},
                        )
                        bool_filters = (
                            {"result_out_of_range": True},
                            {"out_of_range": True},
                            {"has_out_of_range": True},
                        )

                        def extend_brains(catalog, base):
                            seen = set()
                            # primero con filtros OOR (si el índice existe)
                            for extra in bool_filters:
                                for q in qkeys:
                                    qq = base.copy()
                                    qq.update(q)
                                    qq.update(extra)
                                    try:
                                        for b in catalog(**qq):
                                            if b.UID not in seen:
                                                brains.append(b)
                                                seen.add(b.UID)
                                    except Exception:
                                        pass
                            # luego sin filtros (compatibilidad)
                            for q in qkeys:
                                qq = base.copy()
                                qq.update(q)
                                try:
                                    for b in catalog(**qq):
                                        if b.UID not in seen:
                                            brains.append(b)
                                            seen.add(b.UID)
                                except Exception:
                                    pass

                        if ac is not None:
                            extend_brains(ac, {
                                "portal_type": "Analysis",
                                "sort_on": "sortable_title",
                                "sort_order": "ascending",
                            })

                        # Fallback final con portal_catalog
                        if not brains:
                            try:
                                pc = getToolByName(self.context, "portal_catalog")
                                extend_brains(pc, {"portal_type": "Analysis"})
                            except Exception:
                                pass

                    # Convertir brains a objetos
                    for b in brains or []:
                        try:
                            a = b.getObject()
                        except Exception:
                            a = None
                        if a is not None:
                            analyses_objs.append(a)

                # D) Evaluación final
                if not any_oof:
                    for a in analyses_objs:
                        if _analysis_is_oof(a):
                            any_oof = True
                            break

                # ✅ guarda en caché (true/false) para este UID
                self._infolabsa_oor_cache[uid] = bool(any_oof)

            # E) Marcar fila
            if any_oof:
                for key in ("class", "state_class", "row_class",
                            "review_state_class", "table_row_class"):
                    cur = item.get(key) or u""
                    item[key] = (cur + u" row-flag-alert").strip()

                # atributo data para CSS/diagnóstico
                item.setdefault("attributes", {})
                item["attributes"]["data-row-alert"] = "1"

                # marcador oculto + barrita de cortesía
                item.setdefault("after", {})
                prev = item["after"].get("getId", u"")
                item["after"]["getId"] = u" ".join(filter(None, [
                    prev, u'<span class="oob-flag" data-oor="1" title="Out of range"></span>'
                ]))

                item.setdefault("before", {})
                pre = item["before"].get("getId", u"")
                item["before"]["getId"] = u" ".join(filter(None, [
                    u'<span style="display:inline-block;width:4px;height:1em;'
                    u'background:#ffb3ad;margin-right:4px;vertical-align:middle;"></span>',
                    pre
                ]))
        except Exception:
            # Nunca romper el listado por un fallo de chequeo
            pass
        # === /INFOLABSA ===

        return item

    def get_glyphicon(self, name, **kwargs):
        """Returns an html element that represents the glyphicon with the name
        """
        attrs = " ".join([kwargs[key] for key in kwargs.keys()])
        span = '<span class="glyphicon glyphicon-{}" ' \
               'style="padding-right:3px" {}></span>'
        return span.format(name, attrs)

    def add_review_states(self):
        """Adds referral-specific review states (filter buttons) in the listing
        """
        # Use 'invalid' review state as the template
        invalid = filter(lambda o: o["id"] == "invalid",
                         self.listing.review_states)[0]
        default_columns = invalid.get("columns")
        default_actions = invalid.get("custom_transitions", [])

        # New review_state "shipped"
        shipped = {
            "id": "shipped",
            "title": _("Referred"),
            "contentFilter": {
                "review_state": (
                    "shipped",
                    "rejected_at_reference",
                    "received_at_reference",
                ),
                "sort_on": "created",
                "sort_order": "descending"},
            "transitions": [],
            "custom_transitions": list(default_actions),
            "columns": list(default_columns),
        }
        listing_utils.add_review_state(
            listing=self.listing,
            review_state=shipped,
            after="invalid")

        # New review_state "rejected_at_reference"
        rejected_at_reference = {
            "id": "rejected_at_reference",
            "title": _("Rejected at reference"),
            "contentFilter": {
                "review_state": ("rejected_at_reference", ),
                "sort_on": "created",
                "sort_order": "descending"},
            "transitions": [],
            "custom_transitions": list(default_actions),
            "columns": list(default_columns),
        }
        listing_utils.add_review_state(
            listing=self.listing,
            review_state=rejected_at_reference,
            after="shipped")

        # Update "rejected" review state to include those that have been
        # rejected by the reference laboratory
        for rv in self.listing.review_states:
            if rv.get("id") == "rejected":
                statuses = rv["contentFilter"].get("review_state")
                if not isinstance(statuses, (list, tuple)):
                    statuses = [statuses]
                statuses.append("rejected_at_reference")
                rv["contentFilter"]["review_state"] = list(set(statuses))

    def add_columns(self):
        """Adds referral-specific columns in the listing
        """
        custom_columns = collections.OrderedDict((
            ("Shipment", {
                "title": _("Shipment"),
                "sortable": False,
                "toggle": True,
                "after": "getAnalysesNum",
            }),
        ))

        # Add the columns, but for "shipped" status only
        rv_keys = map(lambda r: r["id"], self.listing.review_states)
        for column_id, column_values in custom_columns.items():
            listing_utils.add_column(
                listing=self.listing,
                column_id=column_id,
                column_values=column_values,
                after=column_values.get("after", None),
                review_states=rv_keys)
