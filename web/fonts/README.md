# Bundled fonts

These seven unmodified upstream WOFF2 files retain their complete upstream glyph sets. They are bundled for local,
offline use; displaying a document does not require a font service or download. The font payloads total **1,071,668
bytes**. The four original license files total **18,062 bytes**.

All four families use the **SIL Open Font License 1.1**, which permits embedding and redistribution with the required
copyright notices and license. These fonts require no paid license fees. They remain licensed under the OFL; preserve
the original license files below when redistributing them. No subsetting, format conversion, or other font modification
was performed.

## Upstream pins

- Source Serif 4, internal version 4.005:
  [Adobe source-serif](https://github.com/adobe-fonts/source-serif/tree/80d3f8894c09c937bebfa9011247d2e1c79fd6f4).
  Original font directory: `WOFF2/TTF/`; original license: `LICENSE.md`.
- Source Sans 3 variable upright, internal version 3.052:
  [Adobe source-sans](https://github.com/adobe-fonts/source-sans/tree/87b37a2daaed80fcb8e8ccb0085c4d72ddade12e).
  Original font directory: `WOFF2/VF/`; original license: `LICENSE.md`.
- Source Code Pro, internal version 2.042:
  [Adobe source-code-pro](https://github.com/adobe-fonts/source-code-pro/tree/803b7e23ec97ae58b6232ea76519a76d428ba268).
  Original font directory: `WOFF2/TTF/`; original license: `LICENSE.md`.
- STIX Two Math, release v2.13b171 and internal version 2.13 b171:
  [STIX fonts](https://github.com/stipub/stixfonts/tree/744a22a4dd626cd14d75728aef34fc8ad7c85db0).
  Original font directory: `fonts/static_otf_woff2/`; original license: `OFL.txt`.

The Source Sans variable face has internal family name `SourceSans3VF`; the viewer uses the CSS alias `Source Sans 3`.
Its `fvar` table declares a `wght` axis from 200 through 900, with default 200. The other internal family names are
`Source Serif 4`, `Source Code Pro`, and `STIX Two Math`. STIX includes an OpenType `MATH` table, version 1.0,
with 27,408 bytes. These values were read from the downloaded files' tables.

## Font manifest

All files use media type `font/woff2`. Git blob identifiers were checked with `git hash-object --no-filters` against
their immutable upstream tree entries. SHA-256 values identify the exact bundled bytes.

- `SourceSerif4-Regular.ttf.woff2` — 76,260 bytes; 400 normal.
  Git blob: `0263fc304226d90e224e53053855ad138303b70b`.
  SHA-256: `6b053e98f0838afe81f3e784727be4583a7c13bb42f198dc5202ecffee0aaee0`.

- `SourceSerif4-Bold.ttf.woff2` — 81,540 bytes; 700 normal.
  Git blob: `181a07f63bef8f18e42a5a57463e0e60cf8e8035`.
  SHA-256: `6d4fd4c0f08798a478fe34aafea9bf5cfa1cbc6ae4b834193febaee74254d10c`.

- `SourceSerif4-It.ttf.woff2` — 59,716 bytes; 400 italic.
  Git blob: `2ae08a7bedfed08cdfea76039c1bb1fa1d6cdf67`.
  SHA-256: `ca3b17ed1e3e668ffd9e03385cfd46e1b095df783de53710d25d41241496026b`.

- `SourceSerif4-BoldIt.ttf.woff2` — 63,456 bytes; 700 italic.
  Git blob: `8fbd44298040d9483eec885432717f236d3d8f7a`.
  SHA-256: `738ded930ea75d50331c43390217282f212419e8bf0d42932771de8047c8e404`.

- `SourceSans3VF-Upright.otf.woff2` — 164,736 bytes; 200–900 normal (variable).
  Git blob: `d1537d81b4b5488baf83c1741ddc26e4046c5e65`.
  SHA-256: `f9e4eac0e8f8ffdae91cf6eff3962b96e81417cba5c728bc1c89efe9510e7653`.

- `SourceCodePro-Regular.ttf.woff2` — 74,052 bytes; 400 normal.
  Git blob: `40826f1a67950d4c2cf0e835c9862141587d43c2`.
  SHA-256: `714eee29b70d191f5bf4b3a06b68f2c50522b1303d31c7d44dcefdcc5f9defd0`.

- `STIXTwoMath-Regular.woff2` — 551,908 bytes; 400 normal.
  Git blob: `3b97c9c897e5f52c544eaf4e89ebb15c4f2c1c22`.
  SHA-256: `094191335def3f0452c81ec0713cfc2f29bb6af8cecbf79b60881fbf2db97562`.

## Original license files

The local filenames distinguish the families; the contents remain byte-for-byte copies of the upstream licenses,
including their original copyright and reserved-font-name notices.

- `SourceSerif4-LICENSE.md` — 4,491 bytes; upstream `LICENSE.md` at the corresponding pin above.
  Git blob: `5871e1f3d1b3362453b3a1f6c493fbefdbd3dcf3`.
  SHA-256: `c21d7293d87b6d7ab1d0229a2f55b77f33a7613a6a4e66f6693d68d7d8d09464`.

- `SourceSans3-LICENSE.md` — 4,486 bytes; upstream `LICENSE.md` at the corresponding pin above.
  Git blob: `22c601b82f29fc6bb801445098c9f23ffdca4f94`.
  SHA-256: `56af9b9c6715597e458284a474dc118a50a4150e9d547c70f7b4a33c3e6a9328`.

- `SourceCodePro-LICENSE.md` — 4,566 bytes; upstream `LICENSE.md` at the corresponding pin above.
  Git blob: `70288a864f8dfd1314aa0315748eece0cf80fdda`.
  SHA-256: `7c940e28a5388e9bba866cf0e408edda45fe0899ba98665b8f6ab31dc5e4b8ff`.

- `STIXTwoMath-OFL.txt` — 4,519 bytes; upstream `OFL.txt` at the corresponding pin above.
  Git blob: `11b7b8e8892a6ec8fbe709cc10fa7a12d53a4501`.
  SHA-256: `0c8825913b60d858aacdb33c4ca6660a7d64b0d6464702efbb19313f5765861a`.

## Reproduce the downloads

Run this from this directory using Bash and `curl`. The URLs use immutable commit identifiers rather than branch names.

```bash
set -euo pipefail

serif='https://raw.githubusercontent.com/adobe-fonts/source-serif'
serif+='/80d3f8894c09c937bebfa9011247d2e1c79fd6f4'
sans='https://raw.githubusercontent.com/adobe-fonts/source-sans'
sans+='/87b37a2daaed80fcb8e8ccb0085c4d72ddade12e'
code='https://raw.githubusercontent.com/adobe-fonts/source-code-pro'
code+='/803b7e23ec97ae58b6232ea76519a76d428ba268'
stix='https://raw.githubusercontent.com/stipub/stixfonts'
stix+='/744a22a4dd626cd14d75728aef34fc8ad7c85db0'

for style in Regular Bold It BoldIt; do
  name="SourceSerif4-${style}.ttf.woff2"
  curl -fL "${serif}/WOFF2/TTF/${name}" -o "${name}"
done
curl -fL "${sans}/WOFF2/VF/SourceSans3VF-Upright.otf.woff2" -o SourceSans3VF-Upright.otf.woff2
curl -fL "${code}/WOFF2/TTF/SourceCodePro-Regular.ttf.woff2" -o SourceCodePro-Regular.ttf.woff2
curl -fL "${stix}/fonts/static_otf_woff2/STIXTwoMath-Regular.woff2" -o STIXTwoMath-Regular.woff2
curl -fL "${serif}/LICENSE.md" -o SourceSerif4-LICENSE.md
curl -fL "${sans}/LICENSE.md" -o SourceSans3-LICENSE.md
curl -fL "${code}/LICENSE.md" -o SourceCodePro-LICENSE.md
curl -fL "${stix}/OFL.txt" -o STIXTwoMath-OFL.txt

# Compare the results with the manifests above.
shasum -a 256 -- *.woff2 *LICENSE.md STIXTwoMath-OFL.txt
for file in *.woff2 *LICENSE.md STIXTwoMath-OFL.txt; do
  git hash-object --no-filters "${file}"
done
```
