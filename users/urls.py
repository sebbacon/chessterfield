from django.urls import path

from . import views


urlpatterns = [
    path("me/", views.me_detail, name="me-detail"),
    path("me/settings/", views.me_settings, name="me-settings"),
]

