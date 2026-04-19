from django.urls import path

from . import views


urlpatterns = [
    path("progress/positions/<int:pk>/", views.position_state_detail, name="position-state-detail"),
]

