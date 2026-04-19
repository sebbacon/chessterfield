import mimetypes
from pathlib import Path

from django.contrib import admin, messages
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse

from .forms import PuzzleImportReviewFormSet, PuzzleImportUploadForm
from .models import PuzzleImportBatch, PuzzleImportPage
from .puzzle_imports import import_reviewed_batch, process_puzzle_import_batch, store_uploaded_page


def _admin_context(request, **extra):
    context = admin.site.each_context(request)
    context.update(extra)
    return context


def _get_batch(batch_id: int) -> PuzzleImportBatch:
    return get_object_or_404(PuzzleImportBatch.objects.prefetch_related("pages"), pk=batch_id)


def _batch_totals(batch: PuzzleImportBatch) -> dict[str, int]:
    pages = list(batch.pages.all())
    return {
        "created": sum(page.created_count for page in pages),
        "skipped": sum(page.skipped_count for page in pages),
        "failed": sum(page.failed_count for page in pages),
    }


def puzzle_import_upload_view(request):
    if request.method == "POST":
        form = PuzzleImportUploadForm(request.POST, request.FILES)
        if form.is_valid():
            batch = PuzzleImportBatch.objects.create(created_by=request.user)
            for image in form.cleaned_data["images"]:
                page = PuzzleImportPage.objects.create(
                    batch=batch,
                    original_filename=image.name,
                    stored_upload_path="",
                )
                store_uploaded_page(page, image)
            return redirect("positions-puzzle-import-processing", batch_id=batch.id)
    else:
        form = PuzzleImportUploadForm()

    return render(
        request,
        "admin/positions/puzzle_import_upload.html",
        _admin_context(
            request,
            title="Upload puzzle pages",
            form=form,
        ),
    )


def puzzle_import_processing_view(request, batch_id: int):
    batch = _get_batch(batch_id)
    if batch.status in {PuzzleImportBatch.STATUS_READY, PuzzleImportBatch.STATUS_FAILED, PuzzleImportBatch.STATUS_IMPORTED}:
        return redirect("positions-puzzle-import-review", batch_id=batch.id)

    return render(
        request,
        "admin/positions/puzzle_import_processing.html",
        _admin_context(
            request,
            title="Processing puzzle pages",
            batch=batch,
            start_url=reverse("positions-puzzle-import-processing-start", args=[batch.id]),
            review_url=reverse("positions-puzzle-import-review", args=[batch.id]),
        ),
    )


def puzzle_import_processing_start_view(request, batch_id: int):
    if request.method != "POST":
        raise Http404

    batch = _get_batch(batch_id)
    batch = process_puzzle_import_batch(batch)
    return JsonResponse(
        {
            "status": batch.status,
            "redirect_url": reverse("positions-puzzle-import-review", args=[batch.id]),
        }
    )


def puzzle_import_review_view(request, batch_id: int):
    batch = _get_batch(batch_id)
    if batch.status in {PuzzleImportBatch.STATUS_UPLOADED, PuzzleImportBatch.STATUS_PROCESSING}:
        return redirect("positions-puzzle-import-processing", batch_id=batch.id)

    queryset = batch.pages.order_by("id")
    if request.method == "POST":
        formset = PuzzleImportReviewFormSet(request.POST, queryset=queryset)
        if formset.is_valid():
            formset.save()
            if "_import" in request.POST:
                if batch.status == PuzzleImportBatch.STATUS_IMPORTED:
                    messages.info(request, "This batch has already been imported.")
                    return redirect("positions-puzzle-import-review", batch_id=batch.id)
                try:
                    summary = import_reviewed_batch(batch)
                except ValueError as exc:
                    messages.error(request, str(exc))
                else:
                    messages.success(
                        request,
                        f"Imported puzzle pages: {summary.created} created, {summary.skipped} skipped, {summary.failed} failed.",
                    )
                    return redirect("positions-puzzle-import-review", batch_id=batch.id)
        else:
            messages.error(request, "Fix the review form errors before importing.")
    else:
        formset = PuzzleImportReviewFormSet(queryset=queryset)

    page_forms = [(form, form.instance) for form in formset.forms]
    return render(
        request,
        "admin/positions/puzzle_import_review.html",
        _admin_context(
            request,
            title="Review puzzle page import",
            batch=batch,
            formset=formset,
            page_forms=page_forms,
            totals=_batch_totals(batch),
        ),
    )


def puzzle_import_image_view(request, batch_id: int, page_id: int, kind: str):
    batch = _get_batch(batch_id)
    page = get_object_or_404(batch.pages.all(), pk=page_id)

    paths = {
        "upload": page.stored_upload_path,
        "normalized": page.normalized_image_path,
        "overlay": page.overlay_image_path,
    }
    path_value = paths.get(kind)
    if not path_value:
        raise Http404

    image_path = Path(path_value)
    if not image_path.exists():
        raise Http404

    content_type, _encoding = mimetypes.guess_type(str(image_path))
    return FileResponse(image_path.open("rb"), content_type=content_type or "application/octet-stream")
