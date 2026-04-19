from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm

from .models import SignupCode


class SignupForm(UserCreationForm):
    email = forms.EmailField(required=False)
    signup_code = forms.CharField(
        label="Secret code",
        max_length=64,
        help_text="Ask the site owner for a signup code.",
    )

    class Meta(UserCreationForm.Meta):
        model = get_user_model()
        fields = ("username", "email")

    def clean_signup_code(self):
        code = self.cleaned_data["signup_code"].strip()
        if not SignupCode.objects.filter(code__iexact=code, is_active=True).exists():
            raise forms.ValidationError("That signup code is not valid.")
        return code
