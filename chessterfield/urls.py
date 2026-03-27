from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView
from django.views.decorators.csrf import ensure_csrf_cookie

index_view = ensure_csrf_cookie(TemplateView.as_view(template_name='index.html'))

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('positions.urls')),
    path('tags/', index_view, name='tags-index'),
    path('tags/<str:tag_path>/', index_view, name='tagged-index'),
    path('', index_view, name='index'),
]
