"""HTML-отчёт о качестве подготовки книги."""
import html
from pathlib import Path


def hms(ms: int) -> str:
    s = max(ms, 0) // 1000
    return f"{s // 3600:d}:{s // 60 % 60:02d}:{s % 60:02d}"


def write(path: Path, data: dict) -> None:
    """data: title, chapters [{title, match, run, ru_quality, duration_ms, warn}], warnings
    [{chapter, ms, context}], dict_coverage."""
    rows = ""
    for i, c in enumerate(data["chapters"]):
        cls = "warn" if c["warn"] else ""
        ru = "" if c["ru_quality"] is None else f"{c['ru_quality']:.2f}"
        rows += (f"<tr class='{cls}'><td>{i + 1}</td><td>{html.escape(c['title'])}</td>"
                 f"<td>{c['match'] * 100:.1f} %</td><td>{c['run']}</td><td>{ru}</td>"
                 f"<td>{hms(c['duration_ms'])}</td></tr>")
    warns = "".join(
        f"<li><b>{html.escape(w['chapter'])}</b>, {hms(w['ms'])}: {html.escape(w['context'])}</li>"
        for w in data["warnings"]) or "<li>Нет</li>"
    path.write_text(f"""<!doctype html><meta charset="utf-8"><title>Отчёт: {html.escape(data['title'])}</title>
<style>body{{font:15px/1.5 system-ui;margin:2rem;max-width:960px}}table{{border-collapse:collapse}}
td,th{{padding:4px 10px;border-bottom:1px solid #ddd;text-align:left}}tr.warn{{background:#fdecea}}</style>
<h1>{html.escape(data['title'])}</h1>
<p>Покрытие словаря: {data['dict_coverage'] * 100:.1f} %</p>
<table><tr><th>#</th><th>Глава</th><th>Совпало слов</th><th>Макс. серия</th><th>EN↔RU</th><th>Длительность</th></tr>
{rows}</table>
<h2>Места для проверки</h2><ul>{warns}</ul>
""", encoding="utf-8")
