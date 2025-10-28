# -*- coding: utf-8 -*-
from Products.Five.browser import BrowserView

class RedirectToInfolabsaDashboard(BrowserView):
    """Sobrescribe 'senaite-dashboard' para redirigir a 'infolabsa-dashboard'."""
    def __call__(self):
        req = self.request
        qs = req.get('QUERY_STRING', '')
        url = self.context.absolute_url() + '/infolabsa-dashboard'
        if qs:
            url += '?' + qs
        resp = req.response
        resp.redirect(url, status=301)
        return u""
