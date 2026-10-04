/**
 * GFM parsing for text projection and math-enabled message rendering.
 * Streaming math blocks consume their unfinished body through EOF, keeping
 * interior blank lines inside the incremental parser's unstable tail.
 */

import type { Root } from 'mdast'
import { recoverLocalImages } from './local-image-syntax.ts'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import { cjkFriendlyStrong } from './cjkFriendlyStrong.ts'
import { mathCompatibility } from './mathCompatibility.ts'

/**
 * Parse GFM markdown without interpreting TeX delimiters.
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfm(text: string): Root {
  return recoverLocalImages(fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong()],
    mdastExtensions: [gfmFromMarkdown()],
  }), text)
}

/**
 * Parse GFM markdown plus TeX math with the compatibility delimiters.
 * @param text - Markdown source.
 * @param streaming - Allow unfinished backslash display blocks through EOF;
 * inline formulas still require a closing delimiter.
 * @returns The mdast root.
 */
export function parseGfmWithMath(text: string, streaming = false): Root {
  return recoverLocalImages(fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong(), mathCompatibility(streaming), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  }), text)
}
