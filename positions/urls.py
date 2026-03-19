from django.urls import path
from . import views

urlpatterns = [
    path('positions/', views.positions_list, name='positions-list'),
    path('positions/<int:pk>/', views.positions_detail, name='positions-detail'),
    path('tags/', views.tags_list, name='tags-list'),
]
