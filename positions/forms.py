from pathlib import Path

from django import forms
from django.forms import modelformset_factory

from .models import PuzzleImportPage
from .puzzle_imports import SUPPORTED_IMAGE_SUFFIXES


class MultipleFileInput(forms.ClearableFileInput):
    allow_multiple_selected = True


class MultipleImageField(forms.FileField):
    widget = MultipleFileInput(attrs={"accept": "image/*"})

    def clean(self, data, initial=None):
        single = super().clean
        if not data:
            return []
        if isinstance(data, (list, tuple)):
            return [single(item, initial) for item in data]
        return [single(data, initial)]


class PuzzleImportUploadForm(forms.Form):
    images = MultipleImageField(
        label="Puzzle page screenshots",
        help_text="Upload between 1 and 5 images.",
    )

    def clean_images(self):
        images = self.files.getlist("images")
        if not images:
            raise forms.ValidationError("Upload at least one image.")
        if len(images) > 5:
            raise forms.ValidationError("Upload at most 5 images at a time.")

        cleaned = []
        for image in images:
            suffix = Path(image.name).suffix.lower()
            if suffix not in SUPPORTED_IMAGE_SUFFIXES:
                supported = ", ".join(sorted(SUPPORTED_IMAGE_SUFFIXES))
                raise forms.ValidationError(f"Unsupported file type for {image.name}. Supported: {supported}.")
            cleaned.append(image)
        return cleaned


class PuzzleImportReviewPageForm(forms.ModelForm):
    class Meta:
        model = PuzzleImportPage
        fields = ["stage", "theme_title", "set_name"]
        widgets = {
            "stage": forms.NumberInput(attrs={"min": 1, "style": "width: 8rem;"}),
            "theme_title": forms.TextInput(attrs={"style": "width: 24rem;"}),
            "set_name": forms.TextInput(attrs={"style": "width: 8rem;"}),
        }

    def clean_theme_title(self):
        return (self.cleaned_data.get("theme_title") or "").strip()

    def clean_set_name(self):
        return (self.cleaned_data.get("set_name") or "").strip()


PuzzleImportReviewFormSet = modelformset_factory(
    PuzzleImportPage,
    form=PuzzleImportReviewPageForm,
    extra=0,
)
