/** Generate native launcher and tray artwork from the shared official Pi SVG. */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const assets = join(dirname(fileURLToPath(import.meta.url)), 'assets')
const mark = await readFile(join(assets, 'pi-mark.svg'), 'utf8')
const matched = /<svg\b[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*?)<\/svg>\s*$/.exec(mark)
if (matched === null) throw new Error('The shared Pi mark must contain a viewBox')
const [, viewBox, paths] = matched
const render = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size }, shapeRendering: 1, font: { loadSystemFonts: false } }).render().asPng()
const launcher = (inset, radius, markInset) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="${inset}" y="${inset}" width="${1024 - inset * 2}" height="${1024 - inset * 2}" rx="${radius}" fill="#F6F6F6"/><svg x="${markInset}" y="${markInset}" width="${1024 - markInset * 2}" height="${1024 - markInset * 2}" viewBox="${viewBox}">${paths}</svg></svg>`
await writeFile(join(assets, 'icon-macos.png'), render(launcher(100, 180, 256), 1024))
const windows = launcher(32, 200, 192)
await writeFile(join(assets, 'icon-windows.png'), render(windows, 1024))

function ico(svg, sizes) {
  const images = sizes.map(size => render(svg, size))
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  for (let i = 0; i < sizes.length; i++) {
    const entry = 6 + i * 16
    header[entry] = header[entry + 1] = sizes[i] === 256 ? 0 : sizes[i]
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(images[i].length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += images[i].length
  }
  return Buffer.concat([header, ...images])
}
await writeFile(join(assets, 'icon-windows.ico'), ico(windows, [16, 24, 32, 48, 64, 128, 256]))
await writeFile(join(assets, 'tray.ico'), ico(mark, [16, 24, 32, 48, 64]))
console.log('Generated Pi launcher PNGs, Windows ICO and transparent tray ICO from pi-mark.svg.')
