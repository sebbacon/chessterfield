from django.urls import path

from . import views


urlpatterns = [
    path("practice/modes/", views.practice_modes, name="practice-modes"),
    path("practice/attempts/", views.attempts_list, name="practice-attempts"),
    path("practice/attempts/<int:pk>/", views.attempt_detail, name="practice-attempt-detail"),
]

