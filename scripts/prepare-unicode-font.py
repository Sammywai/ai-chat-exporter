"""Create the bundled static regular font from the original Noto Sans SC variable TTF.

Usage: python3 scripts/prepare-unicode-font.py INPUT_VARIABLE.ttf OUTPUT_STATIC.ttf
Requires fontTools 4.60.2; retains the existing font's OFL licensing.
"""

import sys

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont(sys.argv[1])
font = instantiateVariableFont(font, {"wght": 400}, inplace=True, updateFontNames=True)
font.save(sys.argv[2])
