# -*- coding: utf-8 -*-
from plone.app.layout.viewlets.common import ViewletBase

class InfolabsaAssetsViewlet(ViewletBase):
    """Inyecta infolabsa.css + infolabsa.js en todas las páginas bajo la capa de referral."""
    def render(self):
        # Devolvemos HTML mínimo, sin quebrar la caché/bundles de SENAITE
        return u"""
<link rel="stylesheet" type="text/css" href="++plone++senaite.referral.static/infolabsa.css" />
<script type="text/javascript" src="++plone++senaite.referral.static/infolabsa.js"></script>
""".strip()
