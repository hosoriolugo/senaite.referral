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

from collections import OrderedDict
import copy

from bika.lims.api import UID_CATALOG
from plone.registry.interfaces import IRegistry
from senaite.core.api.workflow import update_workflow
from senaite.core.registry import get_registry_record
from senaite.core.registry import set_registry_record
from senaite.core.setuphandlers import setup_core_catalogs
from senaite.core.setuphandlers import setup_other_catalogs
from senaite.core.workflow import ANALYSIS_WORKFLOW
from senaite.core.workflow import SAMPLE_WORKFLOW
from senaite.referral import logger
from senaite.referral.catalog.inbound_sample_catalog import \
    InboundSampleCatalog
from senaite.referral.catalog.shipment_catalog import ShipmentCatalog
from senaite.referral.config import AJAX_TRANSITIONS
from senaite.referral.config import PRODUCT_NAME
from senaite.referral.config import PROFILE_ID
from senaite.referral.config import UNINSTALL_ID
from zope.component import getUtility

# --- i18n helper con import perezoso (evita ciclos en el arranque) ---
def _tx(portal, msgid):
    """Traduce msgid usando el dominio 'senaite.referral' y el REQUEST del sitio.
    Importa zope.i18n y messageFactory solo cuando se llama (no a nivel de módulo).
    """
    try:
        from zope.i18n import translate
        from senaite.referral import messageFactory as _
    except Exception:
        # Si por alguna razón falla el import en arranque temprano, devuelve msgid
        return msgid
    req = getattr(portal, 'REQUEST', None)
    try:
        return translate(_(msgid), domain='senaite.referral', context=req)
    except Exception:
        return msgid


CATALOGS = (
    InboundSampleCatalog,
    ShipmentCatalog,
)

# Tuples of (catalog, index_name, index_attribute, index_type)
INDEXES = [
    (UID_CATALOG, "remote_uid", "remote_uid", "FieldIndex")
]

# Tuples of (catalog, column_name)
COLUMNS = [
]

# Tuples of (folder_id, folder_title_msgid, portal_type)
# IMPORTANTE: el 2º elemento es el msgid en inglés (debe existir en el .po)
PORTAL_FOLDERS = [
    ("external_labs", u"External laboratories", "ExternalLaboratoryFolder"),
    ("shipments", u"Shipments", "ShipmentFolder"),
]

NAVTYPES = [
    "ExternalLaboratoryFolder",
    "ShipmentFolder",
]

WORKFLOWS_TO_UPDATE = {
    SAMPLE_WORKFLOW: {
        "states": {
            "sample_received": {
                "transitions": ["ship"],
            },
            "shipped": {
                "title": "Referred",
                "description": "Sample is referred to reference laboratory",
                "transitions": (
                    "verify",
                    "invalidate_at_reference",
                    "receive_at_reference",
                    "reject_at_reference",
                    "recall_from_shipment"
                ),
                "permissions_copy_from":  "invalid",
            },
            "received_at_reference": {
                "title": "Received at reference lab",
                "description": "Sample received at reference laboratory",
                "transitions": (
                    "verify",
                    "reject_at_reference",
                    "invalidate_at_reference",
                ),
                "permissions_copy_from":  "invalid",
            },
            "rejected_at_reference": {
                "title": "Rejected at reference lab",
                "description": "Sample rejected at reference laboratory",
                "transitions": ("recall_from_shipment",),
                "permissions_copy_from": "invalid",
            },
            "invalidated_at_reference": {
                "title": "Invalidated at reference lab",
                "description": "Sample invalidated at reference laboratory",
                "transitions": ("invalidate",),
                "permissions_copy_from": "published",
            },
        },
        "transitions": {
            "ship": {
                "title": "Add to shipment",
                "new_state": "shipped",
                "action": "Add to shipment",
                "guard": {
                    "guard_permissions": "",
                    "guard_roles": "",
                    "guard_expr": "python:here.guard_handler('ship')",
                }
            },
            "receive_at_reference": {
                "title": "Receive sample (at reference lab)",
                "new_state": "received_at_reference",
                "action": "Received at reference lab",
                "guard": {
                    "guard_permissions": "",
                    "guard_roles": "",
                    "guard_expr": "python:here.guard_handler('receive_at_reference')",
                }
            },
            "reject_at_reference": {
                "title": "Reject sample (at reference lab)",
                "new_state": "rejected_at_reference",
                "action": "Reject at reference lab",
                "guard": {
                    "guard_permissions": "",
                    "guard_roles": "",
                    "guard_expr": "python:here.guard_handler('reject_at_reference')",
                }
            },
            "invalidate_at_reference": {
                "title": "Invalidate sample (at reference lab)",
                "new_state": "invalidated_at_reference",
                "action": "Invalidate at reference lab",
                "guard": {
                    "guard_permissions": "",
                    "guard_roles": "",
                    "guard_expr": "python:here.guard_handler('invalidate_at_reference')",
                }
            },
            "recall_from_shipment": {
                "title": "Recall from shipment",
                "new_state": "",
                "action": "Recall from shipment",
                "guard": {
                    "guard_permissions": "",
                    "guard_roles": "",
                    "guard_expr": "python:here.guard_handler('recall_from_shipment')",
                }
            },
        }
    },
    ANALYSIS_WORKFLOW: {
        "states": {
            "unassigned": {
                "transitions": ["refer"],
            },
            "referred": {
                "title": "Referred",
                "description": "Analysis is referred to reference laboratory",
                "transitions": ("submit",),
                "permissions_copy_from": "rejected",
            }
        },
        "transitions": {
            "refer": {
                "title": "Refer the analysis to a reference laboratory",
                "new_state": "referred",
                "action": "Refer to reference laboratory",
                "guard": {
                    "guard_permissions": "",
                    "guard_roles": "",
                    "guard_expr": "python:here.guard_handler('refer')",
                }
            },
        }
    }
}

ID_FORMATTING = [
    {
        "portal_type": "OutboundSampleShipment",
        "form": "{lab_code}{year}{alpha:2a3d}",
        "prefix": "outboundsampleshipment",
        "sequence_type": "generated",
        "counter_type": "",
        "split_length": 2,
    },
]


def setup_handler(context):
    """Generic setup handler
    """
    if context.readDataFile('senaite.referral.install.txt') is None:
        return

    logger.info("setup handler [BEGIN]".format(PRODUCT_NAME.upper()))
    portal = context.getSite()  # noqa

    # 1) Carpetas del portal (crear/normalizar con título traducido)
    add_portal_folders(portal)

    # 2) Tipos visibles en navegación
    setup_navigation_types(portal)

    # 3) Workflows (dejamos tal cual para minimizar cambios)
    setup_workflows(portal)

    # 4) Arreglo seguro: fijar títulos de acciones del FTI ExternalLaboratory
    _fix_external_lab_actions(portal)

    # 5) ID formatting
    setup_id_formatting(portal)

    # 6) Catálogos
    setup_catalogs(portal)

    logger.info("{} setup handler [DONE]".format(PRODUCT_NAME.upper()))


def pre_install(portal_setup):
    logger.info("{} pre-install handler [BEGIN]".format(PRODUCT_NAME.upper()))
    context = portal_setup._getImportContext(PROFILE_ID)  # noqa
    portal = context.getSite()

    qi = portal.portal_quickinstaller
    if not qi.isProductInstalled("senaite.lims"):
        profile_name = "profile-senaite.lims:default"
        portal_setup.runAllImportStepsFromProfile(profile_name)

    logger.info("{} pre-install handler [DONE]".format(PRODUCT_NAME.upper()))


def post_install(portal_setup):
    logger.info("{} install handler [BEGIN]".format(PRODUCT_NAME.upper()))
    # context = portal_setup._getImportContext(PROFILE_ID)  # noqa
    # portal = context.getSite()  # noqa
    logger.info("{} install handler [DONE]".format(PRODUCT_NAME.upper()))


def post_uninstall(portal_setup):
    logger.info("{} uninstall handler [BEGIN]".format(PRODUCT_NAME.upper()))
    # context = portal_setup._getImportContext(UNINSTALL_ID)  # noqa
    # portal = context.getSite()  # noqa
    logger.info("{} uninstall handler [DONE]".format(PRODUCT_NAME.upper()))


def add_portal_folders(portal):
    """Crea carpetas con título traducido y normaliza si existen con msgid en inglés.
    """
    logger.info("Adding portal folders ...")
    for folder_id, folder_title_msgid, portal_type in PORTAL_FOLDERS:
        obj = portal.get(folder_id)
        title_tx = _tx(portal, folder_title_msgid)

        if obj is None:
            portal.invokeFactory(portal_type, folder_id, title=title_tx)
            obj = portal[folder_id]
            obj.reindexObject()
            continue

        # Si existe y tiene el msgid crudo, normaliza al traducido
        try:
            current_title = obj.Title()
        except Exception:
            current_title = getattr(obj, 'title', u'')
        if current_title == folder_title_msgid and current_title != title_tx:
            try:
                obj.setTitle(title_tx)
            except Exception:
                setattr(obj, 'title', title_tx)
            obj.reindexObject()

    logger.info("Adding portal folders [DONE]")


def setup_navigation_types(portal):
    registry = getUtility(IRegistry)
    key = "plone.displayed_types"
    display_types = registry.get(key, ())

    new_display_types = set(display_types)
    new_display_types.update(NAVTYPES)
    registry[key] = tuple(new_display_types)


def setup_workflows(portal):
    """Aplicamos los cambios de workflow tal cual (sin localizar aquí para
    minimizar el impacto). Si luego quieres localizarlos también, lo hacemos aparte.
    """
    logger.info("Setup workflows ...")
    for wf_id, settings in WORKFLOWS_TO_UPDATE.items():
        update_workflow(wf_id, **settings)
    logger.info("Setup workflows [DONE]")


def _fix_external_lab_actions(portal):
    """Traduce títulos de acciones 'inbound_shipments'/'outbound_shipments'
    del FTI ExternalLaboratory. Se ejecuta en setup_handler (sitio ya listo).
    """
    try:
        ptool = portal.portal_types
    except Exception:
        return
    fti_id = 'ExternalLaboratory'
    if fti_id not in ptool.objectIds():
        return

    fti = ptool[fti_id]
    actions = list(getattr(fti, '_actions', []) or [])
    changed = False

    for a in actions:
        aid = getattr(a, 'id', None)
        if aid == 'inbound_shipments':
            title_tx = _tx(portal, u"Inbound Shipments")
            if getattr(a, 'title', None) != title_tx:
                a.title = title_tx
                changed = True
        elif aid == 'outbound_shipments':
            title_tx = _tx(portal, u"Outbound Shipments")
            if getattr(a, 'title', None) != title_tx:
                a.title = title_tx
                changed = True

    if changed:
        try:
            fti._p_changed = True
        except Exception:
            pass


def setup_id_formatting(portal, format_definition=None):
    if not format_definition:
        logger.info("Setting up ID formatting ...")
        for formatting in ID_FORMATTING:
            setup_id_formatting(portal, format_definition=formatting)
        logger.info("Setting up ID formatting [DONE]")
        return

    bs = portal.bika_setup
    p_type = format_definition.get("portal_type", None)
    if not p_type:
        return

    form = format_definition.get("form", "")
    if not form:
        logger.info("Param 'form' for portal type {} not set [SKIP")
        return

    logger.info("Applying format '{}' for {}".format(form, p_type))
    ids = list()
    for record in bs.getIDFormatting():
        if record.get('portal_type', '') == p_type:
            continue
        ids.append(record)
    ids.append(format_definition)
    bs.setIDFormatting(ids)


def setup_catalogs(portal):
    logger.info("Setup referral catalogs ...")
    setup_core_catalogs(portal, catalog_classes=CATALOGS)
    setup_other_catalogs(portal, indexes=INDEXES, columns=COLUMNS)
    logger.info("Setup referral catalogs [DONE]")


def setup_ajax_transitions(portal):
    logger.info("Setup ajax transitions ...")
    key = "listing_active_ajax_transitions"
    transitions = get_registry_record("listing_active_ajax_transitions") or []
    transitions.extend(list(AJAX_TRANSITIONS))
    transitions = list(OrderedDict.fromkeys(transitions))
    set_registry_record(key, transitions)
    logger.info("Setup ajax transitions [DONE]")
