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

# === INFOLABSA: añadido para detectar analitos fuera de rango y marcar la fila ===
from Products.CMFCore.utils import getToolByName


def _to_num(x):
    """Convierte a float soportando None, '' y comas decimales. Py2.7-safe."""
    try:
        if x in (None, u"", ""):
            return None
        try:
            num_types = (int, long, float)  # noqa: F821 en Py3, pero aquí es Py2
        except NameError:  # por si acaso
            num_types = (int, float)
        if isinstance(x, num_types):
            return float(x)
        return float(unicode(x).replace(",", "."))
    except Exception:
        return None


def _analysis_is_oof(a):
    """Devuelve True si el Analysis 'a' está fuera de rango.
    1) Intenta usar flags/etiquetas ya existentes (reusa tu lógica actual).
    2) Si no hay flag, compara valor vs ref_min/ref_max si existen.
    """
    # 1) Flags existentes (ajusta nombres si en tu instancia usas otros)
    for attr in ("getResultFlag", "getResultFlags", "result_flag"):
        if hasattr(a, attr):
            try:
                flag = getattr(a, attr)()
            except TypeError:
                flag = getattr(a, attr)
            txt = unicode(flag or u"").lower()
            if any(k in txt for k in (u"out", u"rango", u"range", u"crític", u"critic", u"alert")):
                return True

    # 2) Fallback numérico simple con min/max si están disponibles
    val = None
    for attr in ("getResult", "Result", "getResultValue"):
        if hasattr(a, attr):
            try:
                val = getattr(a, attr)()
            except TypeError:
                val = getattr(a, attr)
            break
    v = _to_num(val)

    lo = None
    hi = None
    for attr in ("getReferenceMinimum", "getMin", "getLower"):
        if hasattr(a, attr):
            try:
                lo = getattr(a, attr)()
            except TypeError:
                lo = getattr(a, attr)
            lo = _to_num(lo)
            break
    for attr in ("getReferenceMaximum", "getMax", "getUpper"):
        if hasattr(a, attr):
            try:
                hi = getattr(a, attr)()
            except TypeError:
                hi = getattr(a, attr)
            hi = _to_num(hi)
            break

    if v is not None and (lo is not None or hi is not None):
        if (lo is not None and v < lo) or (hi is not None and v > hi):
            return True

    return False
# === /INFOLABSA ===


@adapter(IListingView)
@implementer(IListingViewAdapter)
class SamplesListingViewAdapter(object):

    def __init__(self, listing, context):
        self.listing = listing
        self.context = context

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
                val = "&nbsp;|&nbsp;".join([val, item["replace"]["Shipment"]])
            item["replace"]["Shipment"] = val
            inbound = api.get_title(inbound)

        shipment = filter(None, [outbound, inbound])
        item["Shipment"] = " ".join(shipment)

        # Show an alert if the sample has been rejected at reference lab
        if api.get_review_status(obj) == "rejected_at_reference":
            msg = _("Sample rejected at reference laboratory")
            after = item["after"].get("getId", "")
            ico = self.get_glyphicon("alert", title=msg, color="red")
            item["after"]["getId"] = " ".join(filter(None, [after, ico]))

        # === INFOLABSA: sombrear fila si existe al menos un analito fuera de rango ===
        try:
            pc = getToolByName(self.context, "portal_catalog")
            uid = api.get_uid(obj)

            # Analyses del AR: getRequestUID es habitual; algunos usan getAnalysisRequestUID
            brains = pc(portal_type="Analysis", getRequestUID=uid)
            if not brains:
                brains = pc(portal_type="Analysis", getAnalysisRequestUID=uid)

            any_oof = False
            for b in brains:
                a = b.getObject()  # rendimiento: OK para tamaños de lista habituales
                if _analysis_is_oof(a):
                    any_oof = True
                    break

            if any_oof:
                # El listado utiliza 'class'/'state_class' para la <tr>
                row_cls = (item.get("class") or u"") + u" row-flag-alert"
                item["class"] = row_cls.strip()
                st_cls = (item.get("state_class") or u"") + u" row-flag-alert"
                item["state_class"] = st_cls.strip()
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
