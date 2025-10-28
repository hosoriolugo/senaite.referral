# -*- coding: utf-8 -*-
"""
Alias limpio del dashboard estándar de SENAITE bajo la ruta
.../infolabsa-dashboard

Este módulo **no cambia** ninguna lógica ni plantilla: solo hereda
del DashboardView original para exponer la misma vista con otro nombre.
Probado para Python 2.7 en SENAITE 2.6.

Ruta sugerida del archivo:
  src/senaite/referral/browser/dashboard_alias.py
"""

# Defensivo: algunas instalaciones empaquetan el dashboard en ubicaciones distintas.
try:
    # Ubicación habitual en SENAITE 2.6
    from senaite.core.dashboard.browser.dashboard import DashboardView as _BaseDashboardView
except Exception:
    # Fallback por si el paquete expone otra ruta interna
    from senaite.core.browser.dashboard import DashboardView as _BaseDashboardView  # noqa


class InfolabsaDashboardView(_BaseDashboardView):
    """Alias del Dashboard de SENAITE.

    No sobreescribimos nada para conservar:
      - permisos
      - plantillas
      - lógica de búsqueda/estadísticas
      - recursos JS/CSS
    """
    # Sin cambios: hereda todo del dashboard original
    pass
