# -*- coding: utf-8 -*-
"""
Alias y redirección del dashboard:

- /infolabsa-dashboard  -> delega a la vista real 'senaite-dashboard'
- /senaite-dashboard    -> 301 hacia /infolabsa-dashboard (misma querystring)

Compatible con SENAITE 2.6 (Py2.7, Plone 4.3.x).
"""

from Products.Five.browser import BrowserView
from zope.component import getMultiAdapter


class InfolabsaDashboardView(BrowserView):
    """Alias del dashboard oficial."""
    def __call__(self):
        base = getMultiAdapter((self.context, self.request), name='senaite-dashboard')
        return base()


class RedirectToInfolabsaDashboard(BrowserView):
    """Sobrescribe 'senaite-dashboard' para redirigir a 'infolabsa-dashboard'."""
    def __call__(self):
        req = self.request
        qs = req.get('QUERY_STRING', '')
        url = self.context.absolute_url() + '/infolabsa-dashboard'
        if qs:
            url = url + '?' + qs
        resp = req.response
        resp.redirect(url, status=301)
        return u""
