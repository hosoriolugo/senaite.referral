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

from bika.lims import api
from bika.lims.interfaces import IIdServerVariables
from senaite.core.interfaces import IIdServerTypeID
from zope.interface import implementer


SAMPLE_FROM_SHIPMENT_ID = "AnalysisRequestFromShipment"


@implementer(IIdServerVariables)
class IDServerVariablesAdapter(object):
    """An adapter for the generation of Variables for ID Server
    """

    def __init__(self, context):
        self.context = context

    def get_variables(self, **kw):
        """Returns additional variables for ID Server depending on the type of
        the current context
        """
        lab = kw.get("container") or api.get_parent(self.context)
        variables = {
            "lab_code": lab.getCode(),
        }
        return variables


@implementer(IIdServerVariables)
class IDServerSampleVariablesAdapter(object):
    """An adapter for the generation of Variables for ID Server
    """

    def __init__(self, context):
        self.context = context

    def get_variables(self, **kw):
        """Returns additional variables for ID Server depending on the type of
        the current context
        """
        shipment = self.context.getInboundShipment()
        if not shipment:
            return {}

        lab = shipment.getReferringLaboratory()
        return {
            "lab_code": lab.getCode()
        }


@implementer(IIdServerTypeID)
class IDServerSampleTypeIDAdapter(object):
    """An adapter that returns AnalysisRequestFromShipment type
    """

    def __init__(self, context):
        self.context = context

    def has_custom_type_registered(self):
        """Returns whether an entry for AnalysisRequestFromShipment portal
        type exists in ID server formatting config
        """
        bs = api.get_bika_setup()
        formatting = bs.getIDFormatting()
        for config in formatting:
            portal_type = config.get("portal_type", "")
            if portal_type.lower() == SAMPLE_FROM_SHIPMENT_ID.lower():
                return True
        return False

    def get_type_id(self, **kw):
        if self.context.hasInboundShipment():
            if self.has_custom_type_registered():
                return SAMPLE_FROM_SHIPMENT_ID
        return None
