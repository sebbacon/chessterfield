from positions.models import Tag


def apply_tags(position, tag_names):
    tags = [Tag.objects.get_or_create(name=name.strip())[0] for name in tag_names if name and name.strip()]
    position.tags.set(tags)


def clean_tag_filters(request) -> list[str]:
    tag_filters = []
    raw_tags = request.GET.getlist("tag")
    csv_tags = request.GET.get("tags", "")
    if csv_tags:
        raw_tags.extend(csv_tags.split(","))
    for tag in raw_tags:
        cleaned = tag.strip()
        if cleaned and cleaned not in tag_filters:
            tag_filters.append(cleaned)
    return tag_filters

