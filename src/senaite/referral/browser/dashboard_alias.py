# -*- coding: utf-8 -*-
"""
Alias y redirección del dashboard:

- /infolabsa-dashboard  -> delega a la vista real 'senaite-dashboard'
- /senaite-dashboard    -> 301 hacia /infolabsa-dashboard (misma querystring)

Compatible con SENAITE 2.6 (Py2.7, Plone 4.3.x).
"""

import logging
from Products.Five.browser import BrowserView
from zope.component import getMultiAdapter, queryMultiAdapter

logger = logging.getLogger('senaite.referral.dashboard_alias')


class InfolabsaDashboardView(BrowserView):
    """Alias del dashboard oficial.

    Notas:
    - Intentamos resolver la vista 'senaite-dashboard'.
    - Si esa resolución apunta a nuestra redirección (esta misma app),
      evitamos el bucle. En ese caso, como último recurso, hacemos
      una redirección temporal 302 al path original para no romper UX.
    """

    def _resolve_base_view(self):
        """Obtiene la vista base 'senaite-dashboard' si no es nuestra redirección."""
        base = queryMultiAdapter((self.context, self.request), name='senaite-dashboard')
        if base is None:
            logger.warn("[infolabsa-dashboard] No se encontró la vista 'senaite-dashboard'")
            return None

        # Evita recursión si el nombre 'senaite-dashboard' fue sobrescrito por
        # nuestra propia vista de redirección.
        if base.__class__.__name__ == 'RedirectToInfolabsaDashboard':
            logger.warn("[infolabsa-dashboard] 'senaite-dashboard' resuelve a nuestra "
                        "redirección; se evita bucle.")
            return None

        return base

    def __call__(self):
        base = self._resolve_base_view()
        if base is not None:
            # Renderiza exactamente lo que entrega la vista original
            return base()

        # Fallback seguro: si no se pudo resolver la vista base (o evitar bucle),
        # redirige temporalmente al path original para no romper navegación.
        req = self.request
        qs = req.get('QUERY_STRING', '')
        url = self.context.absolute_url() + '/senaite-dashboard'
        if qs:
            url = url + '?' + qs
        # 302 temporal: no cachear
        resp = req.response
        resp.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        resp.redirect(url, status=302)
        return u""


class RedirectToInfolabsaDashboard(BrowserView):
    """Sobrescribe 'senaite-dashboard' para redirigir a 'infolabsa-dashboard'."""
    def __call__(self):
        req = self.request
        qs = req.get('QUERY_STRING', '')
        url = self.context.absolute_url() + '/infolabsa-dashboard'
        if qs:
            url = url + '?' + qs

        resp = req.response
        # 301 permanente para que los marcadores/aplicaciones actualicen URL.
        resp.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        resp.redirect(url, status=301)
        return u""
