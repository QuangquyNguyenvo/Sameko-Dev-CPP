"""Cut the Chinese UI font down to the characters the interface uses.

The Simplified Chinese interface uses a few hundred Han characters, so the app ships a subset of
WenYuan Rounded SC (SIL OFL 1.1, https://github.com/takushun-wu/WenYuanFonts) in two weights,
not the 45 MB font. Run it again after adding Chinese text to the locales:

    python scripts/subset-zh-font.py <path to WenYuanRoundedSCVF.ttf>

Needs fontTools and brotli (pip install fonttools brotli). The OFL forbids a modified font to
use the Reserved Font Name, so the subset is renamed "Sameko Rounded SC".
"""
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'src', 'assets', 'fonts')
NEW_NAME = 'Sameko Rounded SC'
WEIGHTS = {400: 'Regular', 700: 'Bold'}
# Everything from CJK radicals up: Han characters, CJK and full-width punctuation.
CJK = re.compile('[⺀-鿿豈-﫿︰-﹏＀-￯]')


def ui_characters():
    chars = set()
    for base in ('src/renderer', 'src'):
        folder = os.path.join(ROOT, base)
        for dirpath, _, files in os.walk(folder):
            if base == 'src' and dirpath != folder:
                continue  # only src/*.html at the top level; src/renderer is walked whole
            for name in files:
                if name.endswith(('.js', '.html')):
                    with open(os.path.join(dirpath, name), encoding='utf-8') as fh:
                        chars.update(CJK.findall(fh.read()))
    return chars


def rename(font, style):
    full = f'{NEW_NAME} {style}'
    ps = f'{NEW_NAME.replace(" ", "")}-{style}'
    table = font['name']
    for rec in list(table.names):
        if rec.nameID in (1, 4, 16):
            rec.string = NEW_NAME if rec.nameID in (1, 16) else full
        elif rec.nameID == 2 or rec.nameID == 17:
            rec.string = style
        elif rec.nameID == 3:
            rec.string = f'{ps};subset'
        elif rec.nameID == 6:
            rec.string = ps
        elif rec.nameID in (21, 22, 25):
            table.removeNames(nameID=rec.nameID)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    source = sys.argv[1]
    text = ''.join(sorted(ui_characters()))
    print(f'{len(text)} characters')
    for weight, style in WEIGHTS.items():
        font = TTFont(source)
        axes = {'wght': weight}
        if any(a.axisTag == 'ital' for a in font['fvar'].axes):
            axes['ital'] = 0
        font = instancer.instantiateVariableFont(font, axes)
        options = subset.Options()
        options.flavor = 'woff2'
        options.layout_features = ['*']
        options.name_IDs = ['*']
        options.name_languages = ['*']
        options.notdef_outline = True
        sub = subset.Subsetter(options)
        sub.populate(text=text)
        sub.subset(font)
        rename(font, style)
        if 'OS/2' in font:
            font['OS/2'].usWeightClass = weight
        out = os.path.join(OUT_DIR, f'sameko-rounded-sc-{weight}.woff2')
        font.flavor = 'woff2'
        font.save(out)
        print(f'{out}: {os.path.getsize(out) // 1024} KB')


if __name__ == '__main__':
    main()
