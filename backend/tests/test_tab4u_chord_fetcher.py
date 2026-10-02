"""Tab4U chord sheets: page parsing and matching Hebrew names (no network)."""

from guitar_player.services.source_match import accept_sheet_match
from guitar_player.services.tab4u_chord_fetcher import _candidates, parse_tab4u_page

PAGE = """
<table><tbody>
<tr><td class="song">פתיחה:&nbsp;</td></tr>
<tr><td class="tabs">e|---0---|</td></tr>
<tr><td class="chords">&nbsp;&nbsp;<span class="c_C">Am</span>&nbsp;&nbsp;&nbsp;<span class="c_C">Em</span></td></tr>
<tr><td class="chords"><span class="c_C">B4</span>&nbsp;<span class="c_C">B</span></td></tr>
<tr><td class="song">אבא,&nbsp;אני&nbsp;רוצה&nbsp;לעמוד&nbsp;מולך</td></tr>
</tbody></table>
"""


def test_chord_rows_pair_with_the_lyric_row_below_them():
    lines = parse_tab4u_page(PAGE)
    assert [(l.type, l.text, [c.chord for c in l.chords]) for l in lines] == [
        ("section", "פתיחה", []),
        ("instrumental", "", ["Am", "Em"]),
        ("lyric", "אבא, אני רוצה לעמוד מולך", ["B4", "B"]),
    ]
    assert [c.position for c in lines[1].chords] == [2, 7]


def test_search_links_give_artist_and_title():
    page = '<a href="tabs/songs/3816_%D7%90%D7%91%D7%99%D7%AA%D7%A8_%D7%91%D7%A0%D7%90%D7%99_-_%D7%90%D7%91%D7%90.html">x</a>'
    assert _candidates(page) == [("https://www.tab4u.com/tabs/songs/3816_%D7%90%D7%91%D7%99%D7%AA%D7%A8_%D7%91%D7%A0%D7%90%D7%99_-_%D7%90%D7%91%D7%90.html", "אביתר בנאי", "אבא")]


def test_an_exact_hebrew_title_matches_across_scripts():
    assert accept_sheet_match("Rafi Perski", "כמה פעמים", "רפי פרסקי", "כמה פעמים")
    assert not accept_sheet_match("Rafi Perski", "כמה פעמים", "רפי פרסקי", "טוב לי")
    assert not accept_sheet_match("Adele", "Hello", "Lionel Richie", "Hello")


def test_titles_that_differ_only_in_spacing_match():
    assert accept_sheet_match("Cat Stevens", "Moon Shadow", "Cat Stevens", "Moonshadow")


def test_ultimate_guitar_searches_try_plainer_spellings():
    from guitar_player.services.ug_chord_fetcher import _query_variants

    assert _query_variants("AC/DC", "T.N.T.") == ["AC/DC T.N.T.", "AC DC TNT"]
    assert _query_variants("Cat Stevens", "Moon Shadow") == ["Cat Stevens Moon Shadow", "Cat Stevens MoonShadow"]


def test_an_exact_title_matches_when_we_do_not_know_the_artist():
    assert accept_sheet_match("Unknown", "Ring Of Fire", "Johnny Cash", "Ring Of Fire")
    assert not accept_sheet_match("Unknown", "Ring Of Fire", "Johnny Cash", "Ring Of Fire Medley")
