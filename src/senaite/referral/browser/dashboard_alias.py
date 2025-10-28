# -*- coding: utf-8 -*-
"""
Alias robusto para el dashboard:
exponer .../infolabsa-dashboard delegando a la vista real 'senaite-dashboard'
sin importar su clase/ubicación interna.

Compatible con SENAITE 2.6 (Py2.7, Plone 4.3.x).
"""

from Products.Five.browser import BrowserView
from zope.component import getMultiAdapter


class InfolabsaDashboardView(BrowserView):
    """Proxy/alias del dashboard oficial.

    En lugar de heredar la clase concreta (variable entre versiones),
    resolvemos la vista por nombre ('senaite-dashboard') y le
    delegamos la ejecución. Así evitamos ImportError.
    """

    def __call__(self):
        # Obtiene la vista original registrada como 'senaite-dashboard'
        base = getMultiAdapter((self.context, self.request),
                               name='senaite-dashboard')
        # Ejecuta y retorna exactamente lo que entregaría el dashboard original
        return base()
