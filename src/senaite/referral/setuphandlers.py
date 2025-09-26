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
import copy  # noqa

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

# --- i18n helper con import perezoso (evita ciclos de import en el arranque) ---
def _tx(portal, msgid):
    """Traduce msgid con dominio 'senaite.referral' forzando el idioma del sitio."""
    try:
        from zope.i18n import translate
        from senaite.referral import messageFactory as _
    except Exception:
        return msgid
    # Forzar idioma del sitio: funciona incluso si no hay REQUEST durante instalación
    try:
        langtool = getattr(portal, 'portal_languages', None)
        lang = langtool.getDefaultLanguage() if langtool else 'es'
        if not lang:
            lang = 'es'
    except Exception:
        lang = 'es'
    try:
        return translate(_(msgid), domain='senaite.referral', target_language=lang)
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

    # 3) Workflows (aplicar cambios base)
    setup_workflows(portal)

    # 4) Normalizar labels pendientes: acciones y workflows
    _fix_action_titles_everywhere(portal)
    _fix_workflow_labels(portal)

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
    logger.info("{} install handler [DONE]".format(PRODUCT_NAME.upper()))


def post_uninstall(portal_setup):
    logger.info("{} uninstall handler [BEGIN]".format(PRODUCT_NAME.upper()))
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

        # Si existe, normaliza si está vacío o todavía en inglés (msgid)
        try:
            current_title = obj.Title()
        except Exception:
            current_title = getattr(obj, 'title', u'') or u''

        should_normalize = (
            not current_title or
            current_title.strip().lower() == folder_title_msgid.lower()
        )
        if should_normalize and current_title != title_tx:
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
    minimizar el impacto). Luego normalizamos con _fix_workflow_labels.
    """
    logger.info("Setup workflows ...")
    for wf_id, settings in WORKFLOWS_TO_UPDATE.items():
        update_workflow(wf_id, **settings)
    logger.info("Setup workflows [DONE]")


# --- Fijación de títulos en FTIs y portal_actions -----------------------------

_ACTION_ID_TO_MSGID = {
    # ids comunes a traducir
    'inbound_shipments':  u'Inbound Shipments',
    'outbound_shipments': u'Outbound Shipments',
    'samples':            u'Samples',
    'comments':           u'Comments',
}

def _fix_action_titles_everywhere(portal):
    """Traduce y persiste títulos de acciones tanto en FTIs como en portal_actions."""
    _fix_fti_action_titles(portal)
    _fix_portal_actions_titles(portal)

def _fix_fti_action_titles(portal):
    try:
        ptool = portal.portal_types
    except Exception:
        return

    for fti_id in ptool.objectIds():
        fti = ptool[fti_id]
        actions = list(getattr(fti, '_actions', []) or [])
        changed = False
        for a in actions:
            aid = getattr(a, 'id', None)
            if not aid:
                continue
            if aid in _ACTION_ID_TO_MSGID:
                title_tx = _tx(portal, _ACTION_ID_TO_MSGID[aid])
                if getattr(a, 'title', None) != title_tx:
                    a.title = title_tx
                    changed = True
        if changed:
            try:
                fti._p_changed = True
            except Exception:
                pass

def _fix_portal_actions_titles(portal):
    try:
        atool = portal.portal_actions
    except Exception:
        return

    for cat_id in atool.objectIds():
        cat = getattr(atool, cat_id, None)
        if not cat:
            continue
        changed = False
        for act in list(getattr(cat, 'objectValues', lambda: [])() or []):
            aid = getattr(act, 'id', None)
            if not aid:
                continue
            if aid in _ACTION_ID_TO_MSGID:
                title_tx = _tx(portal, _ACTION_ID_TO_MSGID[aid])
                if getattr(act, 'title', None) != title_tx:
                    try:
                        act.title = title_tx
                        changed = True
                    except Exception:
                        pass
        if changed:
            try:
                cat._p_changed = True
            except Exception:
                pass


# --- Normalización de labels de workflow -------------------------------------

def _fix_workflow_labels(portal):
    """Normaliza títulos/descr. de estados y títulos/acciones de transiciones
    en SAMPLE_WORKFLOW y ANALYSIS_WORKFLOW. Solo reescribe si están vacíos
    o iguales al msgid en inglés (no pisa cambios manuales)."""

    def _maybe_set(obj, attr, new_value, msgid):
        old = getattr(obj, attr, u'') or u''
        try:
            old_cmp = old.strip().lower()
        except Exception:
            old_cmp = u''
        if (not old) or (old_cmp == msgid.lower()):
            if old != new_value:
                setattr(obj, attr, new_value)
                return True
        return False

    wf_tool = getattr(portal, 'portal_workflow', None)
    if not wf_tool:
        return

    # === SAMPLE_WORKFLOW ===
    wf = wf_tool.getWorkflowById(SAMPLE_WORKFLOW)
    if wf:
        changed = False
        # Estados
        state_map = {
            'shipped': {
                'title':       (u'Referred', _tx(portal, u'Referred') or u'Remitida'),
                'description': (u'Sample is referred to reference laboratory',
                                _tx(portal, u'Sample is referred to reference laboratory') or
                                u'La muestra ha sido remitida al laboratorio de referencia'),
            },
            'received_at_reference': {
                'title':       (u'Received at reference lab',
                                _tx(portal, u'Received at reference lab') or
                                u'Recibida en el laboratorio de referencia'),
                'description': (u'Sample received at reference laboratory',
                                _tx(portal, u'Sample received at reference laboratory') or
                                u'Muestra recibida en el laboratorio de referencia'),
            },
            'rejected_at_reference': {
                'title':       (u'Rejected at reference lab',
                                _tx(portal, u'Rejected at reference lab') or
                                u'Rechazada en el laboratorio de referencia'),
                'description': (u'Sample rejected at reference laboratory',
                                _tx(portal, u'Sample rejected at reference laboratory') or
                                u'Muestra rechazada en el laboratorio de referencia'),
            },
            'invalidated_at_reference': {
                'title':       (u'Invalidated at reference lab',
                                _tx(portal, u'Invalidated at reference lab') or
                                u'Invalidada en el laboratorio de referencia'),
                'description': (u'Sample invalidated at reference laboratory',
                                _tx(portal, u'Sample invalidated at reference laboratory') or
                                u'Muestra invalidada en el laboratorio de referencia'),
            },
        }
        for sid, defs in state_map.items():
            st = wf.states.get(sid)
            if not st:
                continue
            for attr, (msgid, es_text) in defs.items():
                changed |= _maybe_set(st, attr, es_text, msgid)

        # Transiciones (title y nombre visible / actbox_name)
        trans_map = {
            'ship': (
                (u'Add to shipment',  _tx(portal, u'Add to shipment')  or u'Agregar al envío', 'title'),
                (u'Add to shipment',  _tx(portal, u'Add to shipment')  or u'Agregar al envío', 'actbox_name'),
            ),
            'receive_at_reference': (
                (u'Receive sample (at reference lab)',
                 _tx(portal, u'Receive sample (at reference lab)') or
                 u'Recibir muestra (en lab. de referencia)', 'title'),
                (u'Received at reference lab',
                 _tx(portal, u'Received at reference lab') or
                 u'Recibida en el lab. de referencia', 'actbox_name'),
            ),
            'reject_at_reference': (
                (u'Reject sample (at reference lab)',
                 _tx(portal, u'Reject sample (at reference lab)') or
                 u'Rechazar muestra (en lab. de referencia)', 'title'),
                (u'Reject at reference lab',
                 _tx(portal, u'Reject at reference lab') or
                 u'Rechazar en lab. de referencia', 'actbox_name'),
            ),
            'invalidate_at_reference': (
                (u'Invalidate sample (at reference lab)',
                 _tx(portal, u'Invalidate sample (at reference lab)') or
                 u'Invalidar muestra (en lab. de referencia)', 'title'),
                (u'Invalidate at reference lab',
                 _tx(portal, u'Invalidate at reference lab') or
                 u'Invalidar en el lab. de referencia', 'actbox_name'),
            ),
            'recall_from_shipment': (
                (u'Recall from shipment',
                 _tx(portal, u'Recall from shipment') or
                 u'Retirar del envío', 'title'),
                (u'Recall from shipment',
                 _tx(portal, u'Recall from shipment') or
                 u'Retirar del envío', 'actbox_name'),
            ),
        }
        for tid, triples in trans_map.items():
            tr = wf.transitions.get(tid)
            if not tr:
                continue
            for msgid, es_text, attr in triples:
                changed |= _maybe_set(tr, attr, es_text, msgid)

        if changed:
            try:
                wf._p_changed = True
            except Exception:
                pass

    # === ANALYSIS_WORKFLOW ===
    wf = wf_tool.getWorkflowById(ANALYSIS_WORKFLOW)
    if wf:
        changed = False
        st = wf.states.get('referred')
        if st:
            changed |= _maybe_set(st, 'title',
                                  _tx(portal, u'Referred') or u'Remitido',
                                  u'Referred')
            changed |= _maybe_set(st, 'description',
                                  _tx(portal, u'Analysis is referred to reference laboratory') or
                                  u'Análisis remitido al laboratorio de referencia',
                                  u'Analysis is referred to reference laboratory')
        tr = wf.transitions.get('refer')
        if tr:
            changed |= _maybe_set(tr, 'title',
                                  _tx(portal, u'Refer the analysis to a reference laboratory') or
                                  u'Remitir el análisis a un laboratorio de referencia',
                                  u'Refer the analysis to a reference laboratory')
            changed |= _maybe_set(tr, 'actbox_name',
                                  _tx(portal, u'Refer to reference laboratory') or
                                  u'Remitir a laboratorio de referencia',
                                  u'Refer to reference laboratory')
        if changed:
            try:
                wf._p_changed = True
            except Exception:
                pass


# --- ID formatting / catálogos / ajax ----------------------------------------

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
