from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView
from django.views.decorators.csrf import ensure_csrf_cookie

from positions import admin_views
from users.views import signup_view

index_view = ensure_csrf_cookie(TemplateView.as_view(template_name='index.html'))

urlpatterns = [
    path(
        'admin/positions/puzzle-import/',
        admin.site.admin_view(admin_views.puzzle_import_upload_view),
        name='positions-puzzle-import-upload',
    ),
    path(
        'admin/positions/puzzle-import/<int:batch_id>/processing/',
        admin.site.admin_view(admin_views.puzzle_import_processing_view),
        name='positions-puzzle-import-processing',
    ),
    path(
        'admin/positions/puzzle-import/<int:batch_id>/processing/start/',
        admin.site.admin_view(admin_views.puzzle_import_processing_start_view),
        name='positions-puzzle-import-processing-start',
    ),
    path(
        'admin/positions/puzzle-import/<int:batch_id>/review/',
        admin.site.admin_view(admin_views.puzzle_import_review_view),
        name='positions-puzzle-import-review',
    ),
    path(
        'admin/positions/puzzle-import/<int:batch_id>/page/<int:page_id>/<str:kind>/',
        admin.site.admin_view(admin_views.puzzle_import_image_view),
        name='positions-puzzle-import-image',
    ),
    path('admin/', admin.site.urls),
    path('api/', include('positions.urls')),
    path('api/', include('users.urls')),
    path('api/', include('progress.urls')),
    path('api/', include('practice.urls')),
    path('accounts/', include('django.contrib.auth.urls')),
    path('accounts/signup/', signup_view, name='signup'),
    path('tags/', index_view, name='tags-index'),
    path('tags/<str:tag_path>/', index_view, name='tagged-index'),
    path('', index_view, name='index'),
]
