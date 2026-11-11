"""
Words that mark medical / clinical content (injury, disease, treatment...). Text with these
words is Wikipedia material nobody has reviewed, so it must only appear in the
"Clinical significance" section, which the app labels "Not reviewed".

Used by export_models.py (to move such paragraphs) and scan_clinical.py (to report them).
"""
import re

CLINICAL = re.compile(
    r'\b('
    r'fractur\w*|surger\w*|surgeon\w*|surgical(?!\s+neck)|operat(?:ion|ive|ed on)\w*|postoperative|'
    r'treat\w*|therap\w*|splint\w*|cast(?:ing)? immobili\w*|'
    r'syndrome\w*|disease\w*|disorder\w*|injur\w*|trauma\w*|wound\w*|lesion\w*|'
    r'diagnos\w*|prognos\w*|symptom\w*|patient\w*|clinical\w*|clinician\w*|'
    r'pain(?:ful)?(?!\s+(?:and|fibres?|fibers?|sensation|receptors?|pathways?|signals?|temperature))|'
    r'tumou?r\w*|cancer\w*|carcinoma\w*|malignan\w*|metasta\w*|'
    r'infect\w*|inflamma\w*|abscess\w*|arthritis|tendinitis|tendonitis|bursitis|osteoporo\w*|'
    r'palsy|paralys\w*|parésis|paresis|dislocat\w*|sublux\w*|ruptur\w*|tear(?:s|ing)? of|torn|'
    r'hernia\w*|aneurysm\w*|stenosis|thrombo\w*|emboli(?:sm|[sz]ation|c)?\b|embolus|ischemi\w*|ischaemi\w*|infarct\w*|'
    r'deficien\w*|amputat\w*|transplant\w*|biops\w*|an(?:a)?esthe\w*|medication\w*|drugs?|'
    r'complication\w*|mortality|morbidity|necrosis|degenerat\w*|congenital|deformit\w*'
    r')',
    re.I,
)


def clinical_words(text):
    """The clinical words found in `text`, lower-case, without duplicates."""
    return sorted({m.group(1).lower() for m in CLINICAL.finditer(text)})
