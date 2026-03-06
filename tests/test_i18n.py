from zocket.i18n import normalize_lang, tr


def test_default_lang_is_english():
    assert normalize_lang(None) == "en"
    assert tr("en", "ui.projects") == "Projects"


def test_russian_translation_available():
    assert tr("ru", "ui.projects") == "Проекты"
